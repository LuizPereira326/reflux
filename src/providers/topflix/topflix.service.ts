import { Injectable, Logger } from '@nestjs/common';
import { TopflixScraperService } from './services/scraper.service';
import { TopflixProcessorService } from './services/topflix.processor.service';
import { TopflixSeriesService } from './services/topflix.series.service';
import { TmdbService } from '@/modules/tmdb/tmdb.service';

export interface StreamResponse {
  name: string;
  title: string;
  url: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
  };
}

@Injectable()
export class TopflixService {
  private readonly logger = new Logger(TopflixService.name);

  constructor(
    private readonly scraperService: TopflixScraperService,
    private readonly processorService: TopflixProcessorService,
    private readonly seriesService: TopflixSeriesService,
    private readonly tmdbService: TmdbService,
  ) {}

  async getStreams(
    imdbId: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
  ): Promise<StreamResponse[]> {
    try {
      const episodeInfo = season && episode ? ` S${season}E${episode}` : '';
      this.logger.log(
        `[Service] 🎬 Buscando streams - IMDB: ${imdbId}, Type: ${type}${episodeInfo}`,
      );

      const slug = await this.scraperService.searchByImdb(imdbId, type);
      if (!slug) return [];

      const playerUrl =
        type === 'series' && season && episode
          ? await this.processorService.getPlayerUrl(slug, type, season, episode)
          : await this.processorService.getPlayerUrl(slug, type);

      if (!playerUrl) return [];

      const streamTitle =
        type === 'series' && season && episode
          ? `🎬 Topflix - S${season}E${episode} Dublado`
          : '🎬 Topflix - Dublado';

      return [
        {
          name: 'Topflix',
          title: streamTitle,
          url: playerUrl,
          behaviorHints: {
            notWebReady: true,
            bingeGroup: 'topflix',
          },
        },
      ];
    } catch (error: any) {
      this.logger.error(`[Service] ❌ Erro fatal ao buscar streams: ${error.message}`);
      return [];
    }
  }

  async getEpisodesMeta(
    tmdbId: number,
    seasonNumber: number,
    imdbId: string,
  ) {
    try {
      const slug = await this.scraperService.searchByImdb(imdbId, 'series');
      if (!slug) return [];

      const rawEpisodes = await this.seriesService.getSeriesEpisodes(slug);
      if (!rawEpisodes?.length) return [];

      const tmdbSeasonData = await this.tmdbService.getSeasonDetails(
        tmdbId,
        seasonNumber,
      );

      return rawEpisodes.map((ep: any) => {
        const tmdbEp = tmdbSeasonData?.episodes?.find(
          (e) => e.episode_number === ep.number,
        );

        return {
          id: `${tmdbId}:${seasonNumber}:${ep.number}`,
          episode: ep.number,
          name: tmdbEp?.name || ep.name,
          released: tmdbEp?.air_date || null,
          thumbnail: tmdbEp
            ? this.tmdbService.getEpisodeStillUrl(tmdbEp.still_path, 'w780')
            : null,
        };
      });
    } catch (error: any) {
      this.logger.error(
        `[Service] ❌ Erro ao gerar metadados de episódios: ${error.message}`,
      );
      return [];
    }
  }
}

