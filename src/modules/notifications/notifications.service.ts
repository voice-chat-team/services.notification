/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RpcStatus } from '@voice-chat/common';
import type {
  GetNotificationsRequest,
  Notification,
  ReadNotificationRequest,
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
          notificationPayload: request.notificationPayload.length
            ? JSON.parse(request.notificationPayload)
            : {},
          notificationType: NotificationTypes.INVITE_USER_TO_GUILD,
          channel: request.channel,
        },
      });

      await this.centrifugoClient.publish(request.channel, {
        type: NotificationTypes.INVITE_USER_TO_GUILD,
        payload: notification,
      });

      return {
        ...notification,
        notificationPayload: JSON.stringify(notification.notificationPayload),
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

  async getNotifications(
    request: GetNotificationsRequest,
  ): Promise<Notification[]> {
    const { receiverId, senderId } = request;
    try {
      const notifications = await this.prismaClient.notification.findMany({
        where: {
          receiverId,
          senderId,
        },
      });

      return notifications.map((n) => ({
        id: n.id,
        isRead: n.isRead,
        senderId: n.senderId,
        receiverId: n.receiverId,
        notificationPayload: JSON.stringify(n.notificationPayload),
        createdAt: n.createdAt.toISOString(),
      }));
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Ошибка при получении уведомлений',
      });
    }
  }

  async readNotification(request: ReadNotificationRequest): Promise<boolean> {
    const { notificationIds } = request;
    console.log(request);
    if (!notificationIds || !notificationIds.length) return false;

    try {
      const success = await this.prismaClient.notification.updateMany({
        where: {
          id: {
            in: notificationIds,
          },
        },
        data: {
          isRead: true,
        },
      });

      return success.count > 0;
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Не удалось прочитать уведомление',
      });
    }
  }
}
