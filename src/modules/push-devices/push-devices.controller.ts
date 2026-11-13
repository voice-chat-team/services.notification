import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  RegisterPushDeviceRequest,
  RegisterPushDeviceResponse,
  UnregisterPushDeviceRequest,
  UnregisterPushDeviceResponse,
} from '@voice-chat/contracts/gen/ts/notification';
import { PushDevicesService } from './push-devices.service';

@Controller()
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @GrpcMethod('NotificationService', 'RegisterPushDevice')
  async registerPushDevice(
    request: RegisterPushDeviceRequest,
  ): Promise<RegisterPushDeviceResponse> {
    await this.devices.register(request);
    return { status: true };
  }

  @GrpcMethod('NotificationService', 'UnregisterPushDevice')
  async unregisterPushDevice(
    request: UnregisterPushDeviceRequest,
  ): Promise<UnregisterPushDeviceResponse> {
    await this.devices.unregister(request);
    return { status: true };
  }
}
