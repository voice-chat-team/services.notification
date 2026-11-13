import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  applicationDefault,
  cert,
  deleteApp,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type {
  FcmDeliveryResult,
  FcmMulticastResult,
  FcmNotification,
} from './fcm.types';

const BATCH_SIZE = 500;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

@Injectable()
export class FcmService implements OnModuleDestroy {
  private app?: App;
  private messaging?: Messaging;

  constructor(private readonly configService: ConfigService) {}

  async sendToDevice(
    token: string,
    notification: FcmNotification,
    dryRun = false,
  ): Promise<string> {
    this.validateToken(token);
    const message = this.buildMessage(notification);
    return this.getClient().send({ ...message, token }, dryRun);
  }

  /** Results follow the order of unique input tokens. */
  async sendToDevices(
    tokens: readonly string[],
    notification: FcmNotification,
    dryRun = false,
  ): Promise<FcmMulticastResult> {
    tokens.forEach((token) => this.validateToken(token));
    const uniqueTokens = [...new Set(tokens)];
    const results: FcmDeliveryResult[] = [];

    if (uniqueTokens.length > 0) {
      const message = this.buildMessage(notification);
      const client = this.getClient();

      for (let offset = 0; offset < uniqueTokens.length; offset += BATCH_SIZE) {
        const batch = uniqueTokens.slice(offset, offset + BATCH_SIZE);
        const response = await client.sendEachForMulticast(
          { ...message, tokens: batch },
          dryRun,
        );
        results.push(
          ...response.responses.map((delivery, index) => ({
            token: batch[index],
            success: delivery.success,
            messageId: delivery.messageId,
            errorCode: delivery.error?.code,
          })),
        );
      }
    }

    const successCount = results.filter((result) => result.success).length;
    return {
      successCount,
      failureCount: results.length - successCount,
      results,
      invalidTokens: results
        .filter(
          (result) =>
            !result.success &&
            result.errorCode &&
            INVALID_TOKEN_CODES.has(result.errorCode),
        )
        .map((result) => result.token),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app);
      this.app = undefined;
      this.messaging = undefined;
    }
  }

  private getClient(): Messaging {
    if (this.messaging) return this.messaging;

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (
      (clientEmail || privateKey) &&
      !(projectId && clientEmail && privateKey)
    ) {
      throw new Error(
        'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be configured together',
      );
    }

    this.app = initializeApp(
      {
        projectId,
        credential:
          clientEmail && privateKey && projectId
            ? cert({
                projectId,
                clientEmail,
                privateKey: privateKey.replace(/\\n/g, '\n'),
              })
            : applicationDefault(),
      },
      `fcm-${randomUUID()}`,
    );
    this.messaging = getMessaging(this.app);
    return this.messaging;
  }

  private buildMessage({ title, body, data, android, apns }: FcmNotification) {
    if (!title?.trim() || !body?.trim()) {
      throw new Error('FCM notification title and body must not be empty');
    }

    return {
      notification: { title, body },
      data,
      android: {
        priority: 'high' as const,
        ...android,
        notification: { sound: 'default', ...android?.notification },
      },
      apns: {
        ...apns,
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          ...apns?.headers,
        },
        payload: {
          ...apns?.payload,
          aps: { sound: 'default', ...apns?.payload?.aps },
        },
      },
    };
  }

  private validateToken(token: string): void {
    if (typeof token !== 'string' || !token.trim() || token !== token.trim()) {
      throw new Error('FCM token must be a non-empty string without padding');
    }
  }
}
