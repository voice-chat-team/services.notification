import { Module } from '@nestjs/common';
import { GrpcModule } from '@voice-chat/common';
import { FcmModule } from '../../infrastructure/fcm/fcm.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { GuildPushClient } from './guild.grpc';
import { MessagePushController } from './message-push.controller';
import { MessagePushService } from './message-push.service';

@Module({
  imports: [PrismaModule, FcmModule, GrpcModule.register(['GUILD_PACKAGE'])],
  controllers: [MessagePushController],
  providers: [GuildPushClient, MessagePushService],
})
export class MessagePushModule {}
