import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RpcStatus } from '@voice-chat/common';
import type {
  Notification,
  SendNotificationRequest,
} from '@voice-chat/contracts/gen/notification';
import { NotificationTypes } from 'prisma/generated/enums';
import { CentrifugoService } from 'src/infrastructure/centrifugo/centrifugo.service';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prismaClient: PrismaService,
    private readonly centrifugoClient: CentrifugoService,
  ) {}

  async sendNotification(
    request: SendNotificationRequest,
  ): Promise<Notification> {
    try {
      const notification = await this.prismaClient.notification.create({
        data: {
          receiverId: request.receiverId,
          senderId: request.senderId,
          notificationPayload: request.notificationPayload,
          notificationType: NotificationTypes.INVITE_USER_TO_GUILD,
        },
      });

      await this.centrifugoClient.publish(
        `personal:#${notification.receiverId}`,
        {
          type: NotificationTypes.INVITE_USER_TO_GUILD,
          payload: notification,
        },
      );

      return {
        ...notification,
        createdAt: notification.createdAt.toISOString(),
      };
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Ошибка при отправке уведомление',
      });
    }
  }
}
