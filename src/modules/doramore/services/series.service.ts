import { Injectable, Logger } from '@nestjs/common';
import { DoramoreScraperService } from './scraper.service';
import * as cheerio from 'cheerio';

export interface DoramoreEpisode {
  number: number;
  name: string;
  url: string;
}

@Injectable()
export class DoramoreSeriesService {
  private readonly logger = new Logger(DoramoreSeriesService.name);
  private readonly baseUrl = 'https://doramasonline.org';

  constructor(private readonly scraperService: DoramoreScraperService) {}

  async getSeriesEpisodes(slug: string): Promise<DoramoreEpisode[]> {
    try {
      this.logger.log(`[SeriesService] 📋 Fetching episodes for: ${slug}`);
      
      const html = await this.scraperService.getDoramaPage(slug);
      if (!html) return [];

      const $ = cheerio.load(html);
      const episodes: DoramoreEpisode[] = [];

      $('a[href*="/br/episodio/"], a[href*="/ep-"], .episode-link, .episodio').each((index, element) => {
        const $el = $(element);
        const href = $el.attr('href');
        const text = $el.text().trim();
        
        if (!href) return;

        // Extrai o número do episódio
        const epNumberMatch = text.match(/(?:ep|episódio|episodio)\s*(\d+)/i) || 
                             href.match(/ep-(\d+)|episodio-(\d+)/i);
        
        const episodeNumber = epNumberMatch 
          ? parseInt(epNumberMatch[1] || epNumberMatch[2]) 
          : index + 1;

        const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

        episodes.push({
          number: episodeNumber,
          name: text || `Episódio ${episodeNumber}`,
          url: fullUrl,
        });
      });

      episodes.sort((a, b) => a.number - b.number);
      
      this.logger.log(`[SeriesService] ✅ Found ${episodes.length} episodes`);
      return episodes;
    } catch (error: any) {
      this.logger.error(`[SeriesService] ❌ Error fetching episodes: ${error.message}`);
      return [];
    }
  }
}
