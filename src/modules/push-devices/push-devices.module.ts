import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PushDevicesController } from './push-devices.controller';
import { PushDevicesService } from './push-devices.service';

@Module({
  imports: [PrismaModule],
  controllers: [PushDevicesController],
  providers: [PushDevicesService],
  exports: [PushDevicesService],
})
export class PushDevicesModule {}
