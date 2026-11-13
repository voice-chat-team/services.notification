import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  EnqueueMessagePushRequest,
  EnqueueMessagePushResponse,
} from '@voice-chat/contracts/gen/ts/notification';
import { MessagePushService } from './message-push.service';

@Controller()
export class MessagePushController {
  constructor(private readonly push: MessagePushService) {}

  @GrpcMethod('NotificationService', 'EnqueueMessagePush')
  async enqueueMessagePush(
    request: EnqueueMessagePushRequest,
  ): Promise<EnqueueMessagePushResponse> {
    await this.push.enqueue(request);
    return { status: true };
  }
}
