import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PROTO_PATHS } from '@voice-chat/contracts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'notification.v1',
      protoPath: PROTO_PATHS.NOTIFICATION,
      url: '0.0.0.0:5056',
      loader: {
        longs: String,
        enums: String,
      },
    },
  });

  await app.startAllMicroservices();
}
bootstrap();
