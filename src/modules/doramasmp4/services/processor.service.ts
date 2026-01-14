import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer-extra';
import * as puppeteerCore from 'puppeteer';

const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

interface StreamSource {
  url?: string;
  externalUrl?: string;
  quality?: string;
  headers?: Record<string, string>;
}

@Injectable()
export class DoramasMP4ProcessorService {
  private readonly logger = new Logger(DoramasMP4ProcessorService.name);
  private browser: puppeteerCore.Browser | null = null;

  async onModuleInit() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
    this.logger.log('✅ Browser Puppeteer iniciado para DoramasMP4');
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.logger.log('🛑 Browser Puppeteer encerrado (DoramasMP4)');
    }
  }

  // Método compatível com o service antigo
  async getPlayerUrl(pageUrl: string): Promise<StreamSource | null> {
    return this.extractStreamUrl(pageUrl);
  }

  async extractStreamUrl(pageUrl: string): Promise<StreamSource | null> {
    if (!this.browser) {
      throw new Error('Browser não inicializado');
    }

    const page = await this.browser.newPage();

    try {
      this.logger.log(`[Processor] 🎬 Acessando: ${pageUrl}`);

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      );

      await page.goto(pageUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      await new Promise(r => setTimeout(r, 2000));

      // Tenta extrair Google Drive ID
      const driveId = await page.evaluate(() => {
        // Procura por iframes do Google Drive
        const iframe = document.querySelector('iframe[src*="drive.google.com"]');
        if (iframe) {
          const src = iframe.getAttribute('src');
          const match = src?.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
          if (match) return match[1];
        }

        // Procura por links diretos do Google Drive
        const links = Array.from(document.querySelectorAll('a[href*="drive.google.com"]'));
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href;
          const match = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
          if (match) return match[1];
        }

        // Procura no código fonte da página
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const content = script.textContent || '';
          const match = content.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
          if (match) return match[1];
        }

        return null;
      });

      if (driveId) {
        const proxyUrl = `http://localhost:3000/proxy/gdrive?id=${driveId}`;
        this.logger.log(`[Processor] 🎯 Google Drive ID encontrado: ${driveId} → Proxy: ${proxyUrl}`);
        
        await page.close();
        
        return {
          url: proxyUrl,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        };
      }

      // Tenta extrair outros tipos de vídeo (MP4 direto, etc)
      const directVideo = await page.evaluate(() => {
        // Procura por elementos <video>
        const video = document.querySelector('video source, video');
        if (video) {
          const src = video.getAttribute('src');
          if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
            return src;
          }
        }

        // Procura por players conhecidos
        const playerLinks = Array.from(document.querySelectorAll('a[href*=".mp4"], a[href*=".m3u8"]'));
        if (playerLinks.length > 0) {
          return (playerLinks[0] as HTMLAnchorElement).href;
        }

        return null;
      });

      if (directVideo) {
        this.logger.log(`[Processor] 📹 Vídeo direto encontrado: ${directVideo.substring(0, 100)}...`);
        
        await page.close();
        
        return {
          url: directVideo,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': pageUrl,
          },
        };
      }

      this.logger.warn(`[Processor] ⚠️ Nenhum vídeo encontrado em: ${pageUrl}`);
      await page.close();
      return null;

    } catch (error) {
      this.logger.error(`[Processor] ❌ Erro ao processar ${pageUrl}: ${error.message}`);
      await page.close();
      return null;
    }
  }
}
