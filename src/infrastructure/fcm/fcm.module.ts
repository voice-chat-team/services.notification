import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FcmService } from './fcm.service';

@Module({
  imports: [ConfigModule],
  providers: [FcmService],
  exports: [FcmService],
})
export class FcmModule {}
