import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CentrifugoModule } from './infrastructure/centrifugo/centrifugo.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}.local`, '.env'],
    }),
    CentrifugoModule,
    PrismaModule,
    NotificationsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
