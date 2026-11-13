import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { RpcStatus } from '@voice-chat/common';
import type { EnqueueMessagePushRequest } from '@voice-chat/contracts/gen/ts/notification';
import { randomUUID } from 'node:crypto';
import { FcmService } from '../../infrastructure/fcm/fcm.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GuildPushClient } from './guild.grpc';

const TTL_MS = 5 * 60_000;
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 500;
const INVALID_TOKENS = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);
const PERMANENT_ERRORS = new Set([
  ...INVALID_TOKENS,
  'messaging/invalid-argument',
  'messaging/invalid-recipient',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-data-payload-key',
  'messaging/invalid-options',
]);

@Injectable()
export class MessagePushService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MessagePushService.name);
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: GuildPushClient,
    private readonly fcm: FcmService,
  ) {}

  onApplicationBootstrap(): void {
    this.kick();
  }

  @Interval(1_000)
  poll(): void {
    this.kick();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.prisma.messagePushJob.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
      });
    } catch {
      this.logger.error('Failed to clean up expired push jobs');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.running;
  }

  async enqueue(request: EnqueueMessagePushRequest): Promise<void> {
    const { createdAt, ...payload } = request;
    const timestamp = Date.parse(createdAt);
    const invalid =
      !Number.isFinite(timestamp) ||
      timestamp > Date.now() + 60_000 ||
      [
        request.messageId,
        request.guildId,
        request.channelId,
        request.senderId,
      ].some(
        (id) =>
          typeof id !== 'string' ||
          !id.trim() ||
          id !== id.trim() ||
          id.length > 128,
      ) ||
      [request.senderName, request.channelName, request.body].some(
        (value) => typeof value !== 'string' || !value.trim(),
      ) ||
      Array.from(request.senderName ?? '').length > 80 ||
      Array.from(request.channelName ?? '').length > 80 ||
      Array.from(request.body ?? '').length > 200;

    if (invalid) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Invalid message push payload',
      });
    }

    const expiresAt = new Date(timestamp + TTL_MS);
    if (expiresAt.getTime() <= Date.now()) return;

    // A duplicate handoff must not reset completed devices or restart a job.
    await this.prisma.messagePushJob.createMany({
      data: { ...payload, expiresAt },
      skipDuplicates: true,
    });
    this.kick();
  }

  private kick(): void {
    if (this.stopped || this.running) return;
    this.running = this.drain()
      .catch(() => this.logger.error('Message push queue processing failed'))
      .finally(() => {
        this.running = undefined;
      });
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const leaseId = randomUUID();
      const [claimed] = await this.prisma.$queryRaw<{ messageId: string }[]>`
        UPDATE message_push_jobs
        SET next_attempt_at = (now() AT TIME ZONE 'UTC') + ${LEASE_MS}::int * interval '1 millisecond',
            lease_id = ${leaseId}, attempts = attempts + 1
        WHERE message_id = (
          SELECT message_id FROM message_push_jobs
          WHERE completed_at IS NULL
            AND next_attempt_at <= (now() AT TIME ZONE 'UTC')
            AND expires_at > (now() AT TIME ZONE 'UTC')
            AND attempts < ${MAX_ATTEMPTS}
          ORDER BY next_attempt_at
          LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING message_id AS "messageId"
      `;
      if (!claimed) return;
      await this.process(claimed.messageId, leaseId);
    }
  }

  private async process(messageId: string, leaseId: string): Promise<void> {
    const where = { messageId, leaseId };
    const job = await this.prisma.messagePushJob.findUniqueOrThrow({
      where: { messageId },
    });
    try {
      let userIds = await this.guild.getRecipients(job.guildId, job.channelId);
      const candidates = await this.prisma.pushDevice.findMany({
        where: {
          userId: { in: userIds, not: job.senderId },
          deviceId: { notIn: job.processedDeviceIds },
        },
        select: { deviceId: true },
        orderBy: { deviceId: 'asc' },
      });
      const processed = new Set(job.processedDeviceIds);
      let retryCode: string | undefined;

      for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
        if (this.stopped) return;
        if (offset > 0)
          userIds = await this.guild.getRecipients(job.guildId, job.channelId);
        const { count } = await this.prisma.messagePushJob.updateMany({
          where: { ...where, expiresAt: { gt: new Date() } },
          data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
        });
        if (!count) return;

        // Re-read ownership and token immediately before each batch. Logout,
        // account switch and token refresh can happen while the job is waiting.
        const devices = await this.prisma.pushDevice.findMany({
          where: {
            deviceId: {
              in: candidates
                .slice(offset, offset + BATCH_SIZE)
                .map((device) => device.deviceId),
            },
            userId: { in: userIds, not: job.senderId },
          },
          select: { deviceId: true, userId: true, token: true },
        });
        if (!devices.length) continue;
        const remainingMs = job.expiresAt.getTime() - Date.now();
        if (remainingMs <= 0) return;

        const result = await this.fcm.sendToDevices(
          devices.map((device) => device.token),
          {
            title: `${job.senderName} · #${job.channelName}`,
            body: job.body,
            data: {
              type: 'MESSAGE_CREATED',
              messageId,
              guildId: job.guildId,
              channelId: job.channelId,
              senderId: job.senderId,
            },
            android: { ttl: remainingMs },
            apns: {
              headers: {
                'apns-expiration': String(
                  Math.floor(job.expiresAt.getTime() / 1000),
                ),
              },
            },
          },
        );
        const byToken = new Map(
          devices.map((device) => [device.token, device]),
        );
        const invalidDevices: typeof devices = [];

        for (const delivery of result.results) {
          const device = byToken.get(delivery.token)!;
          if (
            delivery.success ||
            PERMANENT_ERRORS.has(delivery.errorCode ?? '')
          ) {
            processed.add(device.deviceId);
          } else {
            retryCode = delivery.errorCode ?? 'messaging/unknown-error';
          }
          if (INVALID_TOKENS.has(delivery.errorCode ?? ''))
            invalidDevices.push(device);
        }
        if (invalidDevices.length) {
          await this.prisma.pushDevice.deleteMany({
            where: { OR: invalidDevices },
          });
        }
        // Checkpoint each batch, including successes from a partially failed one.
        const saved = await this.prisma.messagePushJob.updateMany({
          where,
          data: { processedDeviceIds: [...processed] },
        });
        if (!saved.count) return;
        if (result.failureCount) {
          const codes = [
            ...new Set(
              result.results
                .filter((delivery) => !delivery.success)
                .map((delivery) => delivery.errorCode ?? 'unknown'),
            ),
          ];
          this.logger.warn(
            `Push ${messageId}: ${result.failureCount} device errors (${codes.join(', ')})`,
          );
        }
      }

      if (retryCode)
        throw Object.assign(new Error('Retry pending devices'), {
          code: retryCode,
        });
      await this.prisma.messagePushJob.updateMany({
        where,
        data: { completedAt: new Date(), leaseId: null, lastError: null },
      });
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'unknown';
      // A deleted/inaccessible channel is terminal; fail closed on guild errors.
      const terminal =
        code === String(RpcStatus.NOT_FOUND) ||
        code === String(RpcStatus.PERMISSION_DENIED);
      await this.prisma.messagePushJob.updateMany({
        where,
        data: {
          leaseId: null,
          completedAt: terminal ? new Date() : undefined,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(60_000 * 2 ** (job.attempts - 1), 120_000) +
              Math.random() * 5_000,
          ),
          lastError: code,
        },
      });
      // No raw SDK/Prisma errors: these can contain registration tokens.
      this.logger.warn(
        `Push ${messageId}: ${terminal ? 'skipped' : 'retry scheduled'} (${code})`,
      );
    }
  }
}
