import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

const SCRAPERS_DISABLED = process.env.DISABLE_SCRAPERS === 'true';

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private browser: puppeteer.Browser | null = null;
  private pagePool: puppeteer.Page[] = [];
  private readonly MAX_PAGES = 5;
  private initPromise: Promise<void> | null = null;

  async onModuleInit() {
    if (SCRAPERS_DISABLED) {
      this.logger.warn('🚫 Puppeteer desativado por ENV (DISABLE_SCRAPERS=true)');
      return;
    }

    this.initPromise = this.initBrowser();
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async initBrowser() {
    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
        ],
      });

      this.logger.log('✅ Browser pool inicializado');
    } catch (error) {
      this.logger.error('❌ Erro ao inicializar browser:', error);
      throw error;
    }
  }

  async getPage(): Promise<puppeteer.Page> {
    if (SCRAPERS_DISABLED) {
      throw new Error('Scrapers desativados por ENV');
    }

    if (this.initPromise) {
      await this.initPromise;
    }

    if (!this.browser) {
      throw new Error('Browser não inicializado');
    }

    if (this.pagePool.length > 0) {
      return this.pagePool.pop()!;
    }

    const pages = await this.browser.pages();
    if (pages.length < this.MAX_PAGES) {
      const page = await this.browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      );
      return page;
    }

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.pagePool.length > 0) {
          clearInterval(checkInterval);
          resolve(this.pagePool.pop()!);
        }
      }, 100);
    });
  }

  async releasePage(page: puppeteer.Page) {
    try {
      await page.goto('about:blank');
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

      this.pagePool.push(page);
    } catch (error) {
      await page.close().catch(() => {});
    }
  }
}
