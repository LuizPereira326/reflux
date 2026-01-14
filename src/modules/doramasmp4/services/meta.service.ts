import { Injectable, Logger } from '@nestjs/common';
import { TmdbService } from '@/modules/tmdb/tmdb.service';
import { ContentType } from '@/modules/tmdb/types/tmdb';
import { DoramasMP4ScraperService } from './scraper.service'; // Nome corrigido

@Injectable()
export class DoramasMP4MetaService { // Nome da classe padronizado
  private readonly logger = new Logger(DoramasMP4MetaService.name);

  constructor(
    private readonly tmdbService: TmdbService,
    private readonly scraperService: DoramasMP4ScraperService, // Injeção corrigida
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

      try {
        const tmdbResults = await this.tmdbService.searchMedia(
          ContentType.TV,
          dorama.title,
          1
        );

        const tmdbData = tmdbResults?.[0];

        return {
          id: `doramasmp4:series:${slug}`, // ID padronizado
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
        this.logger.warn(`TMDB search failed: ${tmdbError.message}`);
        return {
          id: `doramasmp4:series:${slug}`,
          type: 'series',
          name: dorama.title,
          poster: dorama.poster,
          posterShape: 'regular',
          background: dorama.poster,
          description: `Assista ${dorama.title} online`,
        };
      }
    } catch (error: any) {
      this.logger.error(`Error in getMetadata: ${error.message}`);
      return null;
    }
  }
}
