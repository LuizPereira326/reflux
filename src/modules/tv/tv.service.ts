import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service'; // Ajuste o caminho se necessário
import { Channel } from '@prisma/client';

@Injectable()
export class TvService {
  private readonly logger = new Logger(TvService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAllChannels() {
    return this.prisma.channel.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createChannel(data: { name: string; streamUrl: string; logo?: string; group?: string }) {
    return this.prisma.channel.create({ data });
  }

  async deleteChannel(id: string) {
    return this.prisma.channel.delete({ where: { id } });
  }
  
  // Método específico para o Stremio
  async getStremioCatalog() {
    const channels = await this.getAllChannels();
    return channels.map(ch => ({
      id: `topflix:channel:${ch.id}`,
      type: 'channel',
      name: ch.name,
      poster: ch.logo || 'https://via.placeholder.com/300x450?text=TV',
      posterShape: 'landscape', // TVs ficam melhor em landscape
      description: `Canal ao vivo: ${ch.name}`,
      genres: ch.group ? [ch.group] : ['TV'],
    }));
  }
}
