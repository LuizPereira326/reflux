import { PROVIDER_URL } from './constants/url';
import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { CatalogScraper } from './scrapers/catalog.scraper';

@Injectable()
export class TopFlixApiService {
  private readonly logger = new Logger(TopFlixApiService.name);
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ 
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'] 
      });
    }
    return this.browser;
  }

  public async getCatalog(path: string, pageNumber: number = 1): Promise<any[]> {
    const finalPath = path.includes('/page/') ? path : (pageNumber === 1 ? `${path}` : `${path}page/${pageNumber}/`);
    const targetUrl = `${PROVIDER_URL}${finalPath}`;
    
    this.logger.log(`Acessando: ${targetUrl}`);

    let context: BrowserContext | null = null;
    let pageInstance: Page | null = null;

    try {
      const browser = await this.getBrowser();
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
      });
      
      pageInstance = await context.newPage();
      await pageInstance.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
      await pageInstance.waitForSelector('#dle-content', { timeout: 10000 });

      return await CatalogScraper.parse(pageInstance);

    } catch (error: any) {
      this.logger.error(`Falha: ${error.message}`);
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      throw error;
    } finally {
      if (pageInstance) await pageInstance.close();
      if (context) await context.close();
    }
  }
}
