import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CentrifugoModule } from './infrastructure/centrifugo/centrifugo.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PushDevicesModule } from './modules/push-devices/push-devices.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}.local`, '.env'],
    }),
    PrismaModule,
    CentrifugoModule,
    NotificationsModule,
    PushDevicesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
