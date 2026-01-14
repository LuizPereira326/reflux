import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import puppeteerExtra from 'puppeteer-extra';
import * as puppeteer from 'puppeteer';
import { TmdbService } from '@/modules/tmdb/tmdb.service';
import { ContentType } from '@/modules/tmdb/types/tmdb';

const StealthPlugin = require('puppeteer-extra-plugin-stealth');

interface CachedCatalog {
  data: { slug: string; title: string; poster: string; tmdbId?: number }[];
  timestamp: number;
  isComplete: boolean;
}

@Injectable()
export class DoramoreScraperService implements OnModuleDestroy {
  private readonly logger = new Logger(DoramoreScraperService.name);
  private readonly baseUrl = 'https://doramasonline.org';

  private browser: puppeteer.Browser | null = null;
  private activePages = 0;
  private readonly MAX_PAGES = 2;

  private catalogCache: CachedCatalog | null = null;
  private genreCache = new Map<string, CachedCatalog>();
  private readonly CACHE_TTL = 30 * 60 * 1000;
  private isLoadingMore = false;

  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly tmdbService: TmdbService) {}

  /* ---------------- BROWSER ---------------- */

  private async getBrowser() {
    if (!this.browser) {
      puppeteerExtra.use(StealthPlugin());
      this.browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browser;
  }

  private async getPage(): Promise<puppeteer.Page> {
    while (this.activePages >= this.MAX_PAGES) {
      await new Promise(r => setTimeout(r, 100));
    }

    const browser = await this.getBrowser();
    const page = await browser.newPage();
    this.activePages++;

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );

    page.once('close', () => {
      this.activePages--;
      this.scheduleBrowserClose();
    });

    return page;
  }

  private scheduleBrowserClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(async () => {
      if (this.browser && this.activePages === 0) {
        await this.browser.close();
        this.browser = null;
      }
    }, 60_000);
  }

  async onModuleDestroy() {
    if (this.browser) await this.browser.close();
  }

  /* ---------------- TMDB HELPERS ---------------- */

  /**
   * 🎬 Busca poster do TMDb pelo título do dorama
   */
  private async getTmdbPoster(title: string): Promise<{ poster: string | null; tmdbId: number | null }> {
    try {
      // Busca no TMDb (séries de TV)
      const results = await this.tmdbService.searchMedia(ContentType.TV, title, 1, 'pt-BR');
      
      if (results && results.length > 0) {
        const firstResult = results[0];
        
        // O TMDb service já formata as URLs dos posters
        this.logger.log(`[TMDb] ✅ Poster encontrado: ${title}`);
        return {
          poster: firstResult.poster_path || null,
          tmdbId: firstResult.id,
        };
      }

      // Tenta buscar como filme se não encontrou como série
      const movieResults = await this.tmdbService.searchMedia(ContentType.MOVIE, title, 1, 'pt-BR');
      if (movieResults && movieResults.length > 0) {
        const firstResult = movieResults[0];
        this.logger.log(`[TMDb] ✅ Poster encontrado (filme): ${title}`);
        return {
          poster: firstResult.poster_path || null,
          tmdbId: firstResult.id,
        };
      }

      this.logger.warn(`[TMDb] ⚠️ Não encontrado: ${title}`);
      return { poster: null, tmdbId: null };
    } catch (e) {
      this.logger.error(`[TMDb] ❌ Erro ao buscar ${title}: ${e.message}`);
      return { poster: null, tmdbId: null };
    }
  }

  /**
   * 🔄 Enriquece o catálogo com posters do TMDb (assíncrono)
   */
  private async enrichWithTmdbPosters(doramas: any[]) {
    // Executa em background
    setImmediate(async () => {
      for (const dorama of doramas) {
        try {
          // Se já tem poster de boa qualidade, pula
          if (dorama.poster && dorama.poster.includes('tmdb')) {
            continue;
          }

          // Busca no TMDb
          const { poster, tmdbId } = await this.getTmdbPoster(dorama.title);
          
          if (poster) {
            dorama.poster = poster;
            dorama.tmdbId = tmdbId;
            this.logger.log(`[Enrichment] 🎬 ${dorama.title}`);
          }

          // Rate limiting (TMDb permite ~40 req/10s)
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          this.logger.warn(`[Enrichment] ❌ ${dorama.title}: ${e.message}`);
        }
      }
      
      this.logger.log(`[Enrichment] ✅ Processamento concluído: ${doramas.length} doramas`);
    });
  }

  /* ---------------- CORE ---------------- */

  async searchByImdb(
    imdbId: string,
    _type: 'movie' | 'series',
  ): Promise<string | null> {
    try {
      const page = await this.getPage();
      await page.goto(`https://www.imdb.com/title/${imdbId}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await new Promise(r => setTimeout(r, 2000));

      const title = await page.evaluate(
        () =>
          document
            .querySelector('[data-testid="hero__primary-text"]')
            ?.textContent?.trim() || null,
      );

      await page.close();
      if (!title) return null;

      const metas = await this.getAllCatalog();

      const match =
        metas.find(m => m.title.toLowerCase() === title.toLowerCase()) ||
        metas.find(
          m =>
            m.title.toLowerCase().includes(title.toLowerCase()) ||
            title.toLowerCase().includes(m.title.toLowerCase()),
        );

      return match ? match.slug : null;
    } catch {
      return null;
    }
  }

  async getDoramaPage(slug: string): Promise<string | null> {
    try {
      const page = await this.getPage();
      await page.goto(`${this.baseUrl}/br/${slug}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await new Promise(r => setTimeout(r, 2000));
      const html = await page.content();
      await page.close();
      return html;
    } catch {
      return null;
    }
  }

  async discoverGenres(): Promise<string[]> {
    try {
      const page = await this.getPage();
      await page.goto(`${this.baseUrl}/br/series/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await new Promise(r => setTimeout(r, 2000));

      const genres = await page.evaluate(() => {
        const found = new Set<string>();
        document.querySelectorAll('a[href*="/br/generos/"]').forEach(el => {
          const href = (el as HTMLAnchorElement).getAttribute('href');
          const m = href?.match(/\/br\/generos\/([^/?]+)/);
          if (m) found.add(m[1]);
        });
        return Array.from(found);
      });

      await page.close();
      return genres;
    } catch {
      return [];
    }
  }

  async getCatalogByGenre(genre: string) {
    const cached = this.genreCache.get(genre);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const results: any[] = [];

    for (let page = 1; page <= 3; page++) {
      const url =
        page === 1
          ? `${this.baseUrl}/br/generos/${genre}/`
          : `${this.baseUrl}/br/generos/${genre}/page/${page}/`;

      const doramas = await this.scrapePage(url);
      if (!doramas.length) break;

      results.push(...doramas);
      await new Promise(r => setTimeout(r, 300));
    }

    const unique = Array.from(
      new Map(results.map(i => [i.slug, i])).values(),
    );

    // 🎬 Enriquece com TMDb
    this.enrichWithTmdbPosters(unique);

    this.genreCache.set(genre, {
      data: unique,
      timestamp: Date.now(),
      isComplete: false,
    });

    return unique;
  }

  async getDoramaDetails(slug: string) {
    try {
      const page = await this.getPage();
      await page.goto(`${this.baseUrl}/br/${slug}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await new Promise(r => setTimeout(r, 2000));

      const details = await page.evaluate(() => {
        const body = document.body.innerText;
        const match =
          body.match(/Episódios\s*(\d+)/i) ||
          body.match(/episódios?:\s*(\d+)/i);

        return {
          title: document.querySelector('h1')?.textContent?.trim() || '',
          poster: (document.querySelector('img') as HTMLImageElement)?.src || '',
          totalEpisodes: match ? parseInt(match[1]) : 16,
          seasons: 1,
        };
      });

      await page.close();

      // 🎬 Busca poster do TMDb
      if (!details.poster || !details.poster.includes('tmdb')) {
        const { poster, tmdbId } = await this.getTmdbPoster(details.title);
        if (poster) {
          details.poster = poster;
          details['tmdbId'] = tmdbId;
        }
      }

      return details;
    } catch {
      return null;
    }
  }

  async getAllCatalog() {
    if (
      this.catalogCache &&
      Date.now() - this.catalogCache.timestamp < this.CACHE_TTL
    ) {
      return this.catalogCache.data;
    }

    const results: any[] = [];

    // Scrape series
    for (let page = 1; page <= 5; page++) {
      results.push(
        ...(await this.scrapePage(
          page === 1
            ? `${this.baseUrl}/br/series/`
            : `${this.baseUrl}/br/series/page/${page}/`,
        )),
      );
    }

    const unique = Array.from(
      new Map(results.map(i => [i.slug, i])).values(),
    );

    this.catalogCache = {
      data: unique,
      timestamp: Date.now(),
      isComplete: false,
    };

    // 🎬 Enriquece com TMDb em background
    this.enrichWithTmdbPosters(unique);

    if (!this.isLoadingMore) this.loadRemainingPages();
    return unique;
  }

  private async loadRemainingPages() {
    this.isLoadingMore = true;

    try {
      const results = [...(this.catalogCache?.data || [])];

      // Load more series pages
      for (let page = 6; page <= 35; page++) {
        const doramas = await this.scrapePage(
          `${this.baseUrl}/br/series/page/${page}/`,
        );
        if (!doramas.length) break;

        results.push(...doramas);
        await new Promise(r => setTimeout(r, 300));
      }

      const unique = Array.from(
        new Map(results.map(i => [i.slug, i])).values(),
      );

      this.catalogCache = {
        data: unique,
        timestamp: Date.now(),
        isComplete: true,
      };

      // 🎬 Enriquece páginas restantes
      this.enrichWithTmdbPosters(unique);
    } finally {
      this.isLoadingMore = false;
    }
  }

  private async scrapePage(url: string) {
    try {
      const page = await this.getPage();
      await page.goto(url, {
        waitUntil: 'domcontentloaded', // Voltei para domcontentloaded (mais rápido)
        timeout: 30000,
      });

      await page.waitForSelector('a[href*="/br/series/"], a[href*="/br/filmes/"]', {
        timeout: 5000,
      }).catch(() => {});

      await new Promise(r => setTimeout(r, 1500));

      const data = await page.evaluate((baseUrl) => {
        const out: any[] = [];
        
        const containers = document.querySelectorAll(
          'a[href*="/br/series/"], a[href*="/br/filmes/"]'
        );
        
        containers.forEach(el => {
          const href = el.getAttribute('href');
          const title = el.getAttribute('title') || 
                       el.querySelector('h2, h3, .title')?.textContent?.trim() ||
                       el.textContent?.trim();
          
          if (!href || !title) return;

          const m = href.match(/\/br\/(series|filmes)\/([^/]+)/);
          if (!m) return;

          // Poster do site (será substituído pelo TMDb)
          let poster = '';
          const img = el.querySelector('img');
          
          if (img) {
            poster = img.getAttribute('src') || 
                    img.getAttribute('data-src') || 
                    img.getAttribute('data-lazy') || '';
            
            if (poster && !poster.startsWith('http')) {
              poster = poster.startsWith('/') 
                ? baseUrl + poster 
                : baseUrl + '/' + poster;
            }
          }

          out.push({
            slug: `${m[1]}/${m[2]}`,
            title,
            poster: poster || '', // Temporário, será substituído pelo TMDb
          });
        });
        
        return out;
      }, this.baseUrl);

      await page.close();
      
      this.logger.log(`[Scraper] 📦 ${data.length} doramas em ${url}`);
      
      return data;
    } catch (e) {
      this.logger.error(`[Scraper] ❌ Erro em ${url}: ${e.message}`);
      return [];
    }
  }

  public async acquirePage() {
    return this.getPage();
  }
}
