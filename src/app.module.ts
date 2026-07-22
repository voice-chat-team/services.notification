import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CentrifugoModule } from './infrastructure/centrifugo/centrifugo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}.local`, '.env'],
    }),
    CentrifugoModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
