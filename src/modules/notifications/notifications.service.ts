/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RpcStatus } from '@voice-chat/common';
import {
  type ExpireInvitationNotificationsRequest,
  type GetNotificationsRequest,
  type Notification,
  type ReadNotificationRequest,
  type SendNotificationRequest,
  type UpdateNotificationPayloadRequest,
} from '@voice-chat/contracts/gen/ts/notification';
import { CentrifugoService } from 'src/infrastructure/centrifugo/centrifugo.service';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { NotificationModel } from 'prisma/generated/models';

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
          notificationPayload: request.notificationPayload
            ? JSON.parse(request.notificationPayload)
            : {},
          notificationType: request.notificationType as unknown as string,
          channel: request.channel,
        },
      });

      await this.centrifugoClient.publish(request.channel, {
        type: notification.notificationType as unknown as Notification['notificationType'],
        payload: notification,
      });

      return {
        ...notification,
        notificationPayload: JSON.stringify(notification.notificationPayload),
        createdAt: notification.createdAt.toISOString(),
        notificationType:
          notification.notificationType as unknown as Notification['notificationType'],
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
        notificationType:
          n.notificationType as unknown as Notification['notificationType'],
        channel: n.channel,
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

  async expireInvitationNotifications(
    request: ExpireInvitationNotificationsRequest,
  ): Promise<boolean> {
    if (request.notifications.length === 0) return true;
    if (request.notifications.length > 100) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'За один запрос можно обновить не более 100 уведомлений',
      });
    }

    try {
      const updates = Array.from(
        new Map(
          request.notifications.map(
            ({ notificationId, notificationPayload }) => [
              notificationId,
              {
                id: notificationId,
                payload: JSON.parse(notificationPayload) as unknown,
              },
            ],
          ),
        ).values(),
      );

      const notifications = await this.prismaClient.$queryRaw<
        NotificationModel[]
      >`
        UPDATE notifications AS notification
        SET notification_payload = batch.payload, is_read = true
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
          AS batch(id text, payload jsonb)
        WHERE notification.id = batch.id
          AND notification.notification_type = 'NEW_INVITE_TO_GUILD'
        RETURNING notification.id,
          notification.sender_id AS "senderId",
          notification.receiver_id AS "receiverId",
          notification.channel,
          notification.notification_payload AS "notificationPayload",
          notification.notification_type AS "notificationType",
          notification.is_read AS "isRead",
          notification.created_at AS "createdAt"
      `;

      await this.centrifugoClient.publishBatch(
        notifications.map((notification) => ({
          channel: notification.channel,
          data: { type: 'UPDATE_NOTIFICATION', payload: notification },
        })),
      );

      return true;
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Не удалось обновить уведомления истёкших приглашений',
      });
    }
  }

  async updateNotificationPayload(request: UpdateNotificationPayloadRequest) {
    try {
      const notification = await this.prismaClient.notification.update({
        where: {
          id: request.notificationId,
        },
        data: {
          notificationPayload: request.notificationPayload
            ? JSON.parse(request.notificationPayload)
            : {},
          isRead: true,
        },
      });

      await this.centrifugoClient.publishBatch([
        {
          channel: notification.channel,
          data: { type: 'UPDATE_NOTIFICATION', payload: notification },
        },
      ]);

      return {
        ...notification,
        notificationPayload: JSON.stringify(notification.notificationPayload),
        createdAt: notification.createdAt.toISOString(),
        notificationType:
          notification.notificationType as unknown as Notification['notificationType'],
      };
    } catch (error) {
      console.log(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Ошибка при обновлении уведомления',
      });
    }
  }
}
