import { Injectable, Logger } from '@nestjs/common';
import { TmdbService } from '@/modules/tmdb/tmdb.service';
import { ContentType } from '@/modules/tmdb/types/tmdb';
import { DoramoreScraperService } from './scraper.service';

@Injectable()
export class DoramoreMetaService {
  private readonly logger = new Logger(DoramoreMetaService.name);

  constructor(
    private readonly tmdbService: TmdbService,
    private readonly scraperService: DoramoreScraperService,
  ) {}

  async getMetadata(slug: string) {
    try {
      this.logger.log(`🔍 Getting metadata for: ${slug}`);

      const allDoramas = await this.scraperService.getAllCatalog();
      const dorama = allDoramas.find(d => d.slug === slug);

      if (!dorama) {
        this.logger.warn(`Dorama not found: ${slug}`);
        return null;
      }

      // Busca no TMDB
      try {
        const tmdbResults = await this.tmdbService.searchMedia(
          ContentType.TV,
          dorama.title,
          1
        );

        const tmdbData = tmdbResults?.[0];

        return {
          id: `doramore:series:${slug}`,
          type: 'series',
          name: dorama.title,
          poster: dorama.poster,
          posterShape: 'regular',
          background: tmdbData?.backdrop_path 
            ? this.tmdbService.getBackdropUrl(tmdbData.backdrop_path)
            : dorama.poster,
          description: tmdbData?.overview || `Assista ${dorama.title} online`,
          releaseInfo: tmdbData?.first_air_date ? tmdbData.first_air_date.substring(0, 4) : undefined,
        };
      } catch (tmdbError: any) {
        this.logger.warn(`TMDB search failed, using basic info: ${tmdbError.message}`);
        
        // Fallback se TMDB falhar
        return {
          id: `doramore:series:${slug}`,
          type: 'series',
          name: dorama.title,
          poster: dorama.poster,
          posterShape: 'regular',
          background: dorama.poster,
          description: `Assista ${dorama.title} online`,
        };
      }
    } catch (error: any) {
      this.logger.error(`Error getting metadata: ${error.message}`);
      return null;
    }
  }
}
