import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

@Injectable()
export class TopflixScraperService {
  private readonly logger = new Logger(TopflixScraperService.name);
  private readonly BASE_URL = 'https://topflix.digital';

  async searchByImdb(imdbOrSlug: string, type: 'movie' | 'series'): Promise<string | null> {
    try {
      // Se já é um slug, retorna direto
      if (!imdbOrSlug.startsWith('tt')) {
        this.logger.log(`[Scraper] Slug fornecido diretamente: ${imdbOrSlug}`);
        return imdbOrSlug;
      }

      this.logger.log(`[Scraper] Buscando no Topflix - IMDB: ${imdbOrSlug}`);

      // Tenta buscar diretamente pela URL de busca
      const searchUrl = `${this.BASE_URL}/?s=${imdbOrSlug}`;
      
      this.logger.log(`[Scraper] URL de busca: ${searchUrl}`);

      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);

      // Procura pelo resultado que corresponde ao tipo correto
      const typeClass = type === 'movie' ? '.movies' : '.series';
      let slug: string | null = null;

      $(`${typeClass} .poster, .poster`).each((_, element) => {
        const href = $(element).find('a').attr('href');
        
        if (href) {
          // Extrai o slug da URL
          const match = href.match(/assistir-online-([^/]+)/);
          
          if (match) {
            slug = match[1];
            this.logger.log(`[Scraper] Slug encontrado: ${slug}`);
            return false; // break do loop
          }
        }
      });

      if (!slug) {
        this.logger.warn(`[Scraper] Nenhum resultado encontrado na busca para ${imdbOrSlug}`);
        slug = await this.searchInCatalog(imdbOrSlug, type);
      }

      return slug;
    } catch (error: any) {
      this.logger.error(`[Scraper] Erro na busca: ${error.message}`);
      return null;
    }
  }

  private async searchInCatalog(imdbId: string, type: 'movie' | 'series'): Promise<string | null> {
    try {
      const catalogUrl = `${this.BASE_URL}/${type === 'movie' ? 'filmes' : 'series'}/`;
      
      this.logger.log(`[Scraper] Buscando no catálogo: ${catalogUrl}`);

      const response = await axios.get(catalogUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      let slug: string | null = null;

      $('.poster').each((_, element) => {
        const dataImdb = $(element).attr('data-imdb') || $(element).find('[data-imdb]').attr('data-imdb');
        
        if (dataImdb === imdbId) {
          const href = $(element).find('a').attr('href');
          
          if (href) {
            const match = href.match(/assistir-online-([^/]+)/);
            if (match) {
              slug = match[1];
              return false;
            }
          }
        }
      });

      return slug;
    } catch (error: any) {
      this.logger.error(`[Scraper] Erro ao buscar no catálogo: ${error.message}`);
      return null;
    }
  }
}
