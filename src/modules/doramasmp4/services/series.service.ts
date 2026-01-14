import { Injectable, Logger } from '@nestjs/common';
import { DoramasMP4ScraperService } from './scraper.service'; // Nome corrigido
import * as cheerio from 'cheerio';

export interface DoramasMP4Episode { // Nome padronizado
  number: number;
  name: string;
  url: string;
}

@Injectable()
export class DoramasMP4SeriesService { // Nome padronizado
  private readonly logger = new Logger(DoramasMP4SeriesService.name);

  constructor(private readonly scraperService: DoramasMP4ScraperService) {}

  async getSeriesEpisodes(slug: string): Promise<DoramasMP4Episode[]> {
    try {
      this.logger.log(`[SeriesService] 📋 Fetching episodes for: ${slug}`);
      
      const html = await this.scraperService.getDoramaPage(slug);
      if (!html) return [];

      const $ = cheerio.load(html);
      const episodes: DoramasMP4Episode[] = [];

      // Seletores ajustados para o site doramasmp4.io
      $('a[href*="/episodio/"], a[href*="/ep-"], .episode-link').each((index, element) => {
        const $el = $(element);
        const href = $el.attr('href');
        const text = $el.text().trim();
        
        if (!href) return;

        const epNumberMatch = text.match(/(?:ep|episódio|episodio)\s*(\d+)/i) || 
                             href.match(/ep-(\\d+)|episodio-(\\d+)/i);
        
        const episodeNumber = epNumberMatch 
          ? parseInt(epNumberMatch[1] || epNumberMatch[2]) 
          : index + 1;

        const fullUrl = href.startsWith('http') ? href : `https://doramasmp4.io${href}`;

        episodes.push({
          number: episodeNumber,
          name: text || `Episódio ${episodeNumber}`,
          url: fullUrl,
        });
      });

      return episodes.sort((a, b) => a.number - b.number);
    } catch (error: any) {
      this.logger.error(`Error in getSeriesEpisodes: ${error.message}`);
      return [];
    }
  }
}
