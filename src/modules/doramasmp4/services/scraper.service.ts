import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import puppeteerExtra from 'puppeteer-extra';
import * as puppeteer from 'puppeteer';

// Use dynamic require to handle the CommonJS module properly
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

interface CachedCatalog {
  data: { slug: string; title: string; poster: string }[];
  timestamp: number;
  isComplete: boolean;
}

@Injectable()
export class DoramasMP4ScraperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DoramasMP4ScraperService.name);
  // URL base corrigida conforme seu HTML anterior
  private readonly baseUrl = 'https://doramasmp4.io'; 
  private browser: puppeteer.Browser | null = null;

  private catalogCache: CachedCatalog | null = null;
  private genreCache = new Map<string, CachedCatalog>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutos
  private isLoadingMore = false;

  async onModuleInit() {
    try {
      puppeteerExtra.use(StealthPlugin());
    } catch (error) {
      // Fallback para .default se necessário
      puppeteerExtra.use(StealthPlugin.default());
    }

    this.browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Adicionado para evitar crash em containers Docker/Linux
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
    });

    // Inicia o carregamento do catálogo em background
    this.preloadCatalog();
  }

  async onModuleDestroy() {
    if (this.browser) await this.browser.close();
  }

  private async getPage(): Promise<puppeteer.Page> {
    if (!this.browser) throw new Error('Browser not initialized');
    const page = await this.browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
    return page;
  }

  async searchByImdb(imdbId: string, _type: 'movie' | 'series'): Promise<string | null> {
    let page: puppeteer.Page | null = null;
    try {
      page = await this.getPage();
      // Otimização: bloquear imagens e fontes no IMDB para carregar mais rápido
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(`https://www.imdb.com/title/${imdbId}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      
      const title = await page.evaluate(
        () =>
          document
            .querySelector('[data-testid="hero__primary-text"]')
            ?.textContent?.trim() || null,
      );

      if (!title) return null;

      // Busca no catálogo interno
      const metas = await this.getAllCatalog();
      
      // Lógica de match mais robusta
      const match =
        metas.find(m => m.title.toLowerCase() === title.toLowerCase()) ||
        metas.find(
          m =>
            m.title.toLowerCase().includes(title.toLowerCase()) ||
            title.toLowerCase().includes(m.title.toLowerCase()),
        );

      return match ? match.slug : null;
    } catch (error) {
      this.logger.error(`Error searching IMDB: ${error}`);
      return null;
    } finally {
      if (page) await page.close();
    }
  }

  async getDoramaPage(slug: string): Promise<string | null> {
    let page: puppeteer.Page | null = null;
    try {
      page = await this.getPage();
      await page.goto(`${this.baseUrl}/dorama/${slug}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      // Espera um pouco para garantir que scripts rodem (se houver proteção)
      await new Promise(r => setTimeout(r, 1000));
      const html = await page.content();
      return html;
    } catch {
      return null;
    } finally {
      if (page) await page.close();
    }
  }

  async getCatalogByGenre(genre: string) {
    const cached = this.genreCache.get(genre);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const results: { slug: string; title: string; poster: string }[] = [];
    for (let pageNum = 1; pageNum <= 3; pageNum++) {
      const url =
        pageNum === 1
          ? `${this.baseUrl}/genero/${genre}`
          : `${this.baseUrl}/genero/${genre}?page=${pageNum}`;
      const doramas = await this.scrapePage(url);
      if (doramas.length === 0) break;
      results.push(...doramas);
    }

    const unique = Array.from(new Map(results.map(i => [i.slug, i])).values());
    this.genreCache.set(genre, {
      data: unique,
      timestamp: Date.now(),
      isComplete: false,
    });

    return unique;
  }

  async discoverGenres(): Promise<string[]> {
    let page: puppeteer.Page | null = null;
    try {
      page = await this.getPage();
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const genres = await page.evaluate(() => {
        const found = new Set<string>();
        document.querySelectorAll('a[href*="/genero/"]').forEach(el => {
          const href = (el as HTMLAnchorElement).getAttribute('href');
          const match = href?.match(/\/genero\/([^/?]+)/);
          if (match) found.add(match[1]);
        });
        return Array.from(found);
      });

      return genres;
    } catch {
      return [];
    } finally {
      if (page) await page.close();
    }
  }

  async getDoramaDetails(slug: string) {
    let page: puppeteer.Page | null = null;
    try {
      page = await this.getPage();
      await page.goto(`${this.baseUrl}/dorama/${slug}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      
      const details = await page.evaluate(() => {
        const body = document.body.innerText;
        // Tenta capturar episódios via regex no texto da página
        const match =
          body.match(/(\d+)\s*episódios?/i) ||
          body.match(/episódios?:\s*(\d+)/i);
          
        return {
          title: document.querySelector('h1')?.textContent?.trim() || '',
          poster: (document.querySelector('img.poster') as HTMLImageElement)?.src || 
                  (document.querySelector('img') as HTMLImageElement)?.src || '',
          totalEpisodes: match ? parseInt(match[1]) : 16, // Fallback padrão
          seasons: 1,
        };
      });

      return details;
    } catch {
      return null;
    } finally {
      if (page) await page.close();
    }
  }

  async getAllCatalog() {
    if (this.catalogCache && Date.now() - this.catalogCache.timestamp < this.CACHE_TTL) {
      return this.catalogCache.data;
    }

    const results: { slug: string; title: string; poster: string }[] = [];
    
    // Scrape das primeiras 5 páginas para resposta rápida
    for (let pageNum = 1; pageNum <= 5; pageNum++) {
      const url =
        pageNum === 1
          ? `${this.baseUrl}/doramas`
          : `${this.baseUrl}/doramas?page=${pageNum}`;
      
      const pageResults = await this.scrapePage(url);
      if (pageResults.length === 0) break;
      results.push(...pageResults);
    }

    const unique = Array.from(new Map(results.map(i => [i.slug, i])).values());
    this.catalogCache = {
      data: unique,
      timestamp: Date.now(),
      isComplete: false,
    };

    // Continua carregando o resto em background
    if (!this.isLoadingMore) this.loadRemainingPages();
    
    return unique;
  }

  private async preloadCatalog() {
    if (this.catalogCache) return;
    await this.getAllCatalog();
  }

  private async loadRemainingPages() {
    this.isLoadingMore = true;
    try {
      const results = [...(this.catalogCache?.data || [])];
      // Aumentei o limite para garantir mais itens
      for (let pageNum = 6; pageNum <= 50; pageNum++) {
        const doramas = await this.scrapePage(`${this.baseUrl}/doramas?page=${pageNum}`);
        if (doramas.length === 0) break;
        results.push(...doramas);
        
        // Pequena pausa para não sobrecarregar o site alvo
        await new Promise(r => setTimeout(r, 500));
      }
      
      const unique = Array.from(new Map(results.map(i => [i.slug, i])).values());
      this.catalogCache = {
        data: unique,
        timestamp: Date.now(),
        isComplete: true,
      };
      this.logger.log(`Catalog full loaded: ${unique.length} items`);
    } catch (e) {
      this.logger.error(`Error loading remaining pages: ${e}`);
    } finally {
      this.isLoadingMore = false;
    }
  }

  private async scrapePage(url: string) {
    let page: puppeteer.Page | null = null;
    try {
      page = await this.getPage();
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Seletor genérico para links de dorama
      await page.waitForSelector('a[href*="/dorama/"]', { timeout: 5000 }).catch(() => {});

      const data = await page.evaluate(() => {
        const out: any[] = [];
        // Seleciona todos os links que contenham /dorama/ ou /doramas/
        document.querySelectorAll('a[href*="/dorama/"], a[href*="/doramas/"]').forEach(el => {
          const href = (el as HTMLAnchorElement).getAttribute('href');
          
          // Pega o título do atributo title ou do próprio texto
          const title =
            (el as HTMLAnchorElement).getAttribute('title') ||
            el.querySelector('.title')?.textContent || // Tenta classe title comum
            el.textContent?.trim();

          if (!href || !title || title.length < 2) return;

          // Regex para extrair slug
          const m = href.match(/\/dorama\/([^/]+)/) || href.match(/\/doramas\/([^/]+)/);
          
          if (!m) return;
          
          // Busca poster dentro do elemento A ou próximo
          const img = el.querySelector('img');
          const poster = img ? img.src : '';

          out.push({
            slug: m[1],
            title: title.trim(),
            poster: poster,
          });
        });
        return out;
      });

      return data;
    } catch (error) {
      this.logger.error(`Error scraping page ${url}: ${error}`);
      return [];
    } finally {
      // ✅ ESSENCIAL: Fecha a página aconteça o que acontecer
      if (page) await page.close();
    }
  }
}
