import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CentrifugoModule } from './infrastructure/centrifugo/centrifugo.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PushDevicesModule } from './modules/push-devices/push-devices.module';
import { MessagePushModule } from './modules/message-push/message-push.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}.local`, '.env'],
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    CentrifugoModule,
    NotificationsModule,
    PushDevicesModule,
    MessagePushModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
