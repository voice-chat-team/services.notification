import { Controller } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  GetNotificationsRequest,
  GetNotificationsResponse,
  ReadNotificationRequest,
  ReadNotificationResponse,
  SendNotificationRequest,
  SendNotificationResponse,
  UpdateNotificationPayloadRequest,
  UpdateNotificationPayloadResponse,
} from '@voice-chat/contracts/gen/notification';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @GrpcMethod('NotificationService', 'SendNotification')
  async SendNotification(
    request: SendNotificationRequest,
  ): Promise<SendNotificationResponse> {
    const notification =
      await this.notificationsService.sendNotification(request);

    return { notification };
  }

  @GrpcMethod('NotificationService', 'GetNotifications')
  async getNotifications(
    request: GetNotificationsRequest,
  ): Promise<GetNotificationsResponse> {
    const notifications =
      await this.notificationsService.getNotifications(request);

    return { notifications };
  }

  @GrpcMethod('NotificationService', 'ReadNotification')
  async readNotification(
    request: ReadNotificationRequest,
  ): Promise<ReadNotificationResponse> {
    const status = await this.notificationsService.readNotification(request);

    return { status };
  }

  @GrpcMethod('NotificationService', 'UpdateNotificationPayload')
  async updateNotificationPayload(
    request: UpdateNotificationPayloadRequest,
  ): Promise<UpdateNotificationPayloadResponse> {
    const notification =
      await this.notificationsService.updateNotificationPayload(request);

    return { notification };
  }
}
