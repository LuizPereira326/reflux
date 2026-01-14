import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { TOPFLIX_DOMAIN } from '@/providers/topflix/constants/url';

@Injectable()
export class SearchService {
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  /**
   * Busca via POST simulando o formulário do site
   */
  async search(query: string) {
    if (!query) return { query, results: [] };

    try {
      // O site usa DLE e exige esses campos no corpo do POST
      const body = new URLSearchParams();
      body.append('do', 'search');
      body.append('subaction', 'search');
      body.append('story', query);

      // A busca deve ser feita na raiz (/) ou em /index.php?do=search
      const { data } = await this.axios.post(`${TOPFLIX_DOMAIN}/index.php?do=search`, body.toString());
      
      const $ = cheerio.load(data);
      const results: any[] = [];

      // Seletores baseados no seu HTML: .poster.grid-item
      $('.poster.grid-item').each((_, element) => {
        const $el = $(element);
        const $link = $el.find('.poster__title a');

        const title = $link.find('span').text().trim() || $link.text().trim();
        const href = $link.attr('href');
        const poster = $el.find('.poster__img img').attr('src');
        const year = $el.find('.bslide__meta span').first().text().trim();

        if (href && title && !href.includes('javascript:')) {
          const type = href.includes('/series/') ? 'series' : 'movie';
          const slugMatch = href.match(/assistir-online-([^/]+)/);
          const slug = slugMatch ? slugMatch[1] : href.split('/').filter(Boolean).pop();

          results.push({
            id: `topflix:${type}:${slug}`,
            name: title,
            type: type,
            poster: poster || '',
            description: year ? `Ano: ${year}` : '',
          });
        }
      });

      return { query, results };
    } catch (error: any) {
      console.error('[SearchService] Erro na busca TopFlix:', error.message);
      return { query, results: [] };
    }
  }
}
