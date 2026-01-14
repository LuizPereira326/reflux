import { Injectable, Logger } from '@nestjs/common';
import { TopflixGetterService } from '@/providers/topflix/services/getter.service';
import { TopflixService } from '@/providers/topflix/topflix.service';
import { DoramoreService } from '@/modules/doramore/doramore.service';

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  constructor(
    private readonly topflixGetterService: TopflixGetterService,
    private readonly topflixService: TopflixService,
    private readonly doramoreService: DoramoreService,
  ) {}

  async getStream(
    imdbId: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
  ) {
    try {
      this.logger.log(
        `[StreamService] Buscando stream - IMDB: ${imdbId}, Type: ${type}, S:${season}, E:${episode}`,
      );

      const [topflixStreams, doramoreStreams] = await Promise.all([
        this.topflixService.getStreams(imdbId, type, season, episode),
        this.doramoreService.getStreams(imdbId, type, season, episode),
      ]);

      return {
        streams: [
          ...doramoreStreams,
          ...topflixStreams,
        ],
      };
    } catch (error: any) {
      this.logger.error(`[StreamService] Erro: ${error.message}`);
      return { streams: [] };
    }
  }

  async getCatalog(type: string, page: number = 1) {
    try {
      let items = [];

      if (type === 'movie') {
        items = await this.topflixGetterService.fetchMovies(page);
      } else if (type === 'series') {
        items = await this.topflixGetterService.fetchSeries(page);
      }

      return items;
    } catch (error: any) {
      this.logger.error(`[StreamService] Erro ao buscar catálogo: ${error.message}`);
      return [];
    }
  }
}

