import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private browser: puppeteer.Browser | null = null;
  private pagePool: puppeteer.Page[] = [];

  async onModuleInit() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async onModuleDestroy() {
    for (const page of this.pagePool) {
      await page.close();
    }

    if (this.browser) {
      await this.browser.close();
    }
  }

  async getPage(): Promise<puppeteer.Page> {
    if (!this.browser) {
      throw new Error('Browser não inicializado');
    }

    if (this.pagePool.length > 0) {
      return this.pagePool.pop() as puppeteer.Page;
    }

    return await this.browser.newPage();
  }

  async releasePage(page: puppeteer.Page) {
    this.pagePool.push(page);
  }
}
