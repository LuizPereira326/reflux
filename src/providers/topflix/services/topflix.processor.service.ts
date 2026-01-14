import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page, Request } from 'playwright';

@Injectable()
export class TopflixProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TopflixProcessorService.name);
  private readonly BASE_URL = 'https://topflix.digital';

  private browser!: Browser;
  private context!: BrowserContext;

  private cache = new Map<string, string | null>();

  async onModuleInit() {
    this.logger.log('🚀 Inicializando Playwright (Chromium)...');

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121 Safari/537.36',
      locale: 'pt-BR',
      viewport: { width: 1920, height: 1080 },
    });

    await this.context.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,css}', route => route.abort());

    this.logger.log('✅ TopflixProcessorService pronto');
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Finalizando Processador...');
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }

  async getPlayerUrl(
    slug: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
  ): Promise<string | null> {
    const path = type === 'movie' ? 'filmes' : 'series';
    const pageSlug = season && episode ? `${slug}-s${season}e${episode}` : slug;
    const pageUrl = `${this.BASE_URL}/${path}/assistir-online-${pageSlug}/`;

    if (this.cache.has(pageUrl)) return this.cache.get(pageUrl) || null;

    let page: Page | null = null;
    let capturedUrl: string | null = null;
    let requestListener: ((req: Request) => void) | null = null;

    try {
      this.logger.log(`🎯 Abrindo player: ${pageUrl}`);
      page = await this.context.newPage();

      const streamPromise = new Promise<string | null>((resolve) => {
        requestListener = (req: Request) => {
          const url = req.url();
          if (this.isStreamUrl(url)) {
            page?.off('request', requestListener!);
            resolve(url);
            capturedUrl = url;
          }
        };
        page.on('request', requestListener);
      });

      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      await this.tryActivatePlayer(page);

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 10000),
      );

      capturedUrl = await Promise.race([streamPromise, timeoutPromise]);

      if (!capturedUrl) this.logger.warn(`⏱️ Timeout: Nenhum stream encontrado para ${slug}`);
    } catch (err: any) {
      this.logger.error(`❌ Erro crítico no getPlayerUrl: ${err.message}`);
      capturedUrl = null;
    } finally {
      if (page && !page.isClosed()) {
        if (requestListener) page.off('request', requestListener);
        await page.close().catch(() => {});
      }
      this.cache.set(pageUrl, capturedUrl);
    }

    return capturedUrl;
  }

  private isStreamUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const isVideoFile = lowerUrl.includes('.m3u8') || lowerUrl.includes('.mpd');
    const isJunk =
      lowerUrl.includes('google') ||
      lowerUrl.includes('analytics') ||
      lowerUrl.includes('doubleclick') ||
      lowerUrl.includes('facebook') ||
      lowerUrl.includes('pixel');

    return isVideoFile && !isJunk;
  }

  private async tryActivatePlayer(page: Page) {
    try {
      await page.waitForTimeout(1000);
      const selectors = [
        'button[aria-label*="Play"]',
        '.jw-icon-display',
        '.video-js',
        'iframe[src*="player"]',
        '#player',
        '.plyr',
      ];

      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) {
          await el.focus().catch(() => {});
          await el.click({ timeout: 1000 }).catch(() => {});
          this.logger.log(`🖱️ Cliquei no seletor: ${sel}`);
          await page.waitForTimeout(500);
          return;
        }
      }

      await page.mouse.click(960, 540);
      await page.waitForTimeout(500);
    } catch {
      this.logger.debug(
        'Tentativa de ativar player falhou silenciosamente (não crítico)',
      );
    }
  }

  async getSeriesEpisodes(_: string): Promise<any[]> {
    this.logger.warn('[Processor] getSeriesEpisodes é legado e NÃO deve ser usado.');
    return [];
  }
}

