import { NotificationsService } from './notifications.service';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  SendNotificationRequest,
  SendNotificationResponse,
} from '@voice-chat/contracts/gen/notification';

export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @GrpcMethod('NotificationsService', 'SendNotification')
  async sendNotification(
    request: SendNotificationRequest,
  ): Promise<SendNotificationResponse> {
    const notification =
      await this.notificationsService.sendNotification(request);

    return { notification };
  }
}
