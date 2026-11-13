import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RpcStatus } from '@voice-chat/common';
import type {
  RegisterPushDeviceRequest,
  UnregisterPushDeviceRequest,
} from '@voice-chat/contracts/gen/ts/notification';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PushDevicesService {
  private readonly logger = new Logger(PushDevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(request: RegisterPushDeviceRequest): Promise<void> {
    this.validateIdentity(request);
    if (!['android', 'ios'].includes(request.platform)) {
      this.invalidArgument('platform must be android or ios');
    }

    // A token belongs to one installation and one current user. The transaction
    // also handles token migration when the client installation ID is reset.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await tx.pushDevice.deleteMany({
              where: {
                token: request.token,
                deviceId: { not: request.deviceId },
              },
            });
            const data = {
              userId: request.userId,
              token: request.token,
              platform: request.platform,
            };
            await tx.pushDevice.upsert({
              where: { deviceId: request.deviceId },
              create: { deviceId: request.deviceId, ...data },
              update: data,
            });
          },
          { isolationLevel: 'Serializable' },
        );
        return;
      } catch (error: unknown) {
        const code = this.errorCode(error);
        if (attempt < 2 && (code === 'P2034' || code === 'P2002')) continue;
        this.databaseError('register', code);
      }
    }
  }

  async unregister(request: UnregisterPushDeviceRequest): Promise<void> {
    this.validateIdentity(request);
    try {
      await this.prisma.pushDevice.deleteMany({
        where: {
          deviceId: request.deviceId,
          userId: request.userId,
          token: request.token,
        },
      });
    } catch (error: unknown) {
      this.databaseError('unregister', this.errorCode(error));
    }
  }

  async getTokensByUserId(userId: string): Promise<string[]> {
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId },
      select: { token: true },
    });
    return devices.map(({ token }) => token);
  }

  async removeInvalidTokens(
    userId: string,
    tokens: readonly string[],
  ): Promise<void> {
    if (!tokens.length) return;
    await this.prisma.pushDevice.deleteMany({
      where: { userId, token: { in: [...new Set(tokens)] } },
    });
  }

  private validateIdentity(request: UnregisterPushDeviceRequest): void {
    if (
      typeof request.userId !== 'string' ||
      !request.userId.trim() ||
      request.userId !== request.userId.trim() ||
      request.userId.length > 128
    )
      this.invalidArgument(
        'userId must be a non-empty string of at most 128 characters',
      );
    if (typeof request.deviceId !== 'string' || !UUID.test(request.deviceId)) {
      this.invalidArgument('deviceId must be a UUID');
    }
    if (
      typeof request.token !== 'string' ||
      !request.token ||
      request.token.length > 4096 ||
      /\s/.test(request.token)
    )
      this.invalidArgument(
        'token must contain 1 to 4096 characters without whitespace',
      );
  }

  private invalidArgument(details: string): never {
    throw new RpcException({ code: RpcStatus.INVALID_ARGUMENT, details });
  }

  private errorCode(error: unknown): string | undefined {
    return typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
      ? error.code
      : undefined;
  }

  private databaseError(operation: string, code?: string): never {
    // Never log Prisma errors or requests: they can contain device tokens.
    this.logger.error(`Push device ${operation} failed (${code ?? 'unknown'})`);
    throw new RpcException({
      code: RpcStatus.INTERNAL,
      details: 'Failed to update push device registration',
    });
  }
}
