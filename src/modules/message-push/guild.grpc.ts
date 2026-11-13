import { Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { InjectGrpcClient } from '@voice-chat/common';
import type { GuildServiceClient } from '@voice-chat/contracts/gen/ts/guilds';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class GuildPushClient {
  constructor(
    @InjectGrpcClient('GUILD_PACKAGE') private readonly client: ClientGrpc,
  ) {}

  async getRecipients(guildId: string, channelId: string): Promise<string[]> {
    const service = this.client.getService<GuildServiceClient>('GuildService');
    const { userIds } = await lastValueFrom(
      service.getChannelRecipients({ guildId, channelId }).pipe(timeout(5_000)),
    );
    return userIds;
  }
}
