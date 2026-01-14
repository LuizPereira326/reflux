import { Controller, Get, Param, Logger } from '@nestjs/common';
import { StreamService } from './stream.service';

@Controller('stream')
export class StreamController {
  private readonly logger = new Logger(StreamController.name);

  constructor(private readonly streamService: StreamService) {}

  @Get(':type/:id.json')
  async getStream(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    try {
      this.logger.log(`[Controller] Stream requisitado - Type: ${type}, ID: ${id}`);

      const normalizedType = this.normalizeType(type);
      if (!normalizedType) {
        this.logger.error(`[Controller] Tipo inválido: ${type}`);
        return { streams: [] };
      }

      // Formato Stremio: tt1234567 ou tt1234567:season:episode
      const parts = id.split(':');
      const imdbId = parts[0];
      const season = parts.length >= 2 ? Number(parts[1]) : undefined;
      const episode = parts.length >= 3 ? Number(parts[2]) : undefined;

      this.logger.log(
        `[Controller] Processando - Type: ${normalizedType}, IMDB: ${imdbId}, S:${season}, E:${episode}`,
      );

      const result = await this.streamService.getStream(
        imdbId,
        normalizedType,
        season,
        episode,
      );

      this.logger.log(`[Controller] Retornando ${result.streams.length} streams`);
      return result;
    } catch (error: any) {
      this.logger.error(`[Controller] Erro: ${error.message}`);
      return { streams: [] };
    }
  }

  private normalizeType(type: string): 'movie' | 'series' | null {
    const lowerType = type.toLowerCase();

    if (lowerType === 'movie' || lowerType === 'movies') return 'movie';
    if (lowerType === 'series' || lowerType === 'tv') return 'series';

    return null;
  }
}

