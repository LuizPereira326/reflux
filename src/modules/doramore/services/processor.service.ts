import { Injectable, Logger } from '@nestjs/common';
import { DoramoreScraperService } from './scraper.service';
import { ConfigService } from '@nestjs/config';

export interface StreamResult {
  url?: string;
  externalUrl?: string;
  headers?: Record<string, string>;
}

@Injectable()
export class DoramoreProcessorService {
  private readonly logger = new Logger(DoramoreProcessorService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly scraperService: DoramoreScraperService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService.get<string>('BASE_URL') ||
      'http://localhost:3000';
  }

  /**
   * Verifica se uma URL é um stream de vídeo REAL (não endpoint HTML)
   */
  private isRealVideoUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    
    // URLs que são OBVIAMENTE streams reais
    const realVideoPatterns = [
      // Bunny CDN direto
      /\.b-cdn\.net\/.*\.(m3u8|mp4|ts)/i,
      // Outros CDNs diretos
      /\.(streamingverde|doflix)\.net\/.*\.(m3u8|mp4|ts)/i,
      // Google Video
      /googlevideo\.com\/videoplayback/i,
      // Extensões diretas
      /\.(m3u8|mp4|ts|m4s|mpd)(\?|$)/i,
    ];
    
    // URLs que são ENDPOINTS HTML (deve ser ignorado)
    const htmlEndpointPatterns = [
      /doramasonline\.org\/cdn9\/odacdn\/v2\//i,
      /doramasonline\.org\/cdn\//i,
      /\?id=/i, // Geralmente é endpoint, não stream direto
    ];
    
    // 1. Se for endpoint HTML, NÃO é stream real
    for (const pattern of htmlEndpointPatterns) {
      if (pattern.test(lowerUrl)) {
        return false;
      }
    }
    
    // 2. Verifica se é stream real
    for (const pattern of realVideoPatterns) {
      if (pattern.test(lowerUrl)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Filtra apenas URLs de vídeo REAL
   */
  private filterRealVideoUrls(urls: string[]): string[] {
    return urls.filter(url => this.isRealVideoUrl(url));
  }

  /**
   * Prioriza URLs: Bunny CDN > outros CDNs > outras URLs
   */
  private prioritizeUrls(urls: string[]): string[] {
    return urls.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      
      // Bunny CDN tem máxima prioridade
      if (aLower.includes('.b-cdn.net') && !bLower.includes('.b-cdn.net')) return -1;
      if (!aLower.includes('.b-cdn.net') && bLower.includes('.b-cdn.net')) return 1;
      
      // .m3u8 tem prioridade sobre .mp4
      if (aLower.includes('.m3u8') && !bLower.includes('.m3u8')) return -1;
      if (!aLower.includes('.m3u8') && bLower.includes('.m3u8')) return 1;
      
      // URLs com token têm prioridade (geralmente são válidas)
      if (aLower.includes('token=') && !bLower.includes('token=')) return -1;
      if (!aLower.includes('token=') && bLower.includes('token=')) return 1;
      
      return 0;
    });
  }

  /* ---------------- EPISÓDIOS ---------------- */

  async getEpisodeList(doramaUrl: string): Promise<string[]> {
    let page: any = null;

    try {
      page = await this.scraperService.acquirePage();

      await page.goto(doramaUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const links = await page.$$eval(
        'a[href*="/episodio/"], a[href*="/assistir/"]',
        anchors =>
          [
            ...new Set(
              anchors
                .map(a => (a as HTMLAnchorElement).href)
                .filter(h => h && !h.includes('#')),
            ),
          ],
      );

      return links;
    } catch (e: any) {
      this.logger.error(
        `[Processor] Erro ao listar episódios: ${e.message}`,
      );
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /* ---------------- PLAYER ---------------- */

  async getPlayerUrl(
    url: string,
    allowExternalUrl = false,
  ): Promise<StreamResult | null> {
    let page: any = null;

    try {
      page = await this.scraperService.acquirePage();
      this.logger.log(`[Processor] 🎬 Abrindo player: ${url}`);

      const capturedUrls: string[] = [];

      // 🔴 SNIFFER INTELIGENTE: captura TODAS as URLs primeiro
      await page.setRequestInterception(true);
      
      const requestHandler = (request) => {
        const requestUrl = request.url();
        capturedUrls.push(requestUrl);
        
        // Log apenas para URLs interessantes
        if (requestUrl.includes('.m3u8') || requestUrl.includes('.mp4')) {
          this.logger.debug(`[Processor] 📡 Capturado: ${requestUrl.substring(0, 80)}...`);
        }
        
        request.continue().catch(() => {});
      };
      
      page.on('request', requestHandler);

      // Carrega a página
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // 🎭 CLICAR NO PLAYER DUBLADO
      try {
        const clicked = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('ul.opcao li, .player-option li, li'));
          const dubButton = items.find(el => {
            const text = el.textContent?.trim().toUpperCase();
            return text === 'DUBLADO' || text?.includes('DUBLADO');
          });
          
          if (dubButton) {
            (dubButton as HTMLElement).click();
            return true;
          }
          return false;
        });
        
        if (clicked) {
          this.logger.log(`[Processor] 🎭 Player DUBLADO selecionado`);
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {
        this.logger.warn(`[Processor] ⚠️ Erro ao selecionar DUBLADO: ${e.message}`);
      }

      // Espera para requests tardios
      await new Promise(r => setTimeout(r, 2000));

      // 🔍 ANALISA AS URLs CAPTURADAS
      this.logger.log(`[Processor] 📊 Analisando ${capturedUrls.length} URLs capturadas...`);
      
      // 1️⃣ FILTRA APENAS URLs DE VÍDEO REAL
      const realVideoUrls = this.filterRealVideoUrls(capturedUrls);
      
      if (realVideoUrls.length > 0) {
        this.logger.log(`[Processor] ✅ ${realVideoUrls.length} URLs de vídeo real encontradas`);
        
        // 2️⃣ PRIORIZA AS URLs
        const prioritizedUrls = this.prioritizeUrls(realVideoUrls);
        const bestUrl = prioritizedUrls[0];
        
        this.logger.log(`[Processor] 🎯 URL ESCOLHIDA: ${bestUrl.substring(0, 100)}...`);
        this.logger.debug(`[Processor] 📋 Todas as URLs de vídeo:`, prioritizedUrls.map(u => u.substring(0, 80)));
        
        return {
          url: bestUrl,
          headers: {
            'Referer': 'https://doramasonline.org/',
            'Origin': 'https://doramasonline.org',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        };
      }

      // 3️⃣ SE NÃO ENCONTROU URLs REAIS, VERIFICA ENDPOINTS
      this.logger.warn(`[Processor] ⚠️ Nenhuma URL de vídeo real encontrada, verificando endpoints...`);
      
      const endpoints = capturedUrls.filter(u => 
        u.includes('/cdn9/odacdn/v2/') || 
        u.includes('doramasonline.org/cdn/')
      );
      
      if (endpoints.length > 0) {
        this.logger.log(`[Processor] 🔄 Explorando ${endpoints.length} endpoint(s)...`);
        
        for (const endpoint of endpoints.slice(0, 3)) { // Limita a 3 endpoints
          try {
            this.logger.log(`[Processor] 🧭 Acessando endpoint: ${endpoint.substring(0, 80)}...`);
            
            // Limpa as URLs capturadas para o próximo ciclo
            const previousCount = capturedUrls.length;
            
            await page.goto(endpoint, {
              waitUntil: 'networkidle0',
              timeout: 10000,
            });
            
            await new Promise(r => setTimeout(r, 3000));
            
            // Verifica se capturou novas URLs
            const newUrls = capturedUrls.slice(previousCount);
            const newRealUrls = this.filterRealVideoUrls(newUrls);
            
            if (newRealUrls.length > 0) {
              const prioritized = this.prioritizeUrls(newRealUrls);
              const foundUrl = prioritized[0];
              
              this.logger.log(`[Processor] 🎯 URL encontrada via endpoint: ${foundUrl.substring(0, 100)}...`);
              
              return {
                url: foundUrl,
                headers: {
                  'Referer': 'https://doramasonline.org/',
                  'Origin': 'https://doramasonline.org',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              };
            }
          } catch (e) {
            this.logger.warn(`[Processor] ⚠️ Erro ao explorar endpoint: ${e.message}`);
          }
        }
      }

      // 4️⃣ BUSCA NO HTML DA PÁGINA (FALLBACK)
      this.logger.log(`[Processor] 🔍 Buscando URLs no HTML da página...`);
      
      const pageUrls = await page.evaluate(() => {
        const urls: string[] = [];
        
        // Procura em todos os elementos possíveis
        const elements = [
          ...document.querySelectorAll('script'),
          ...document.querySelectorAll('iframe'),
          ...document.querySelectorAll('source'),
          ...document.querySelectorAll('video'),
          ...document.querySelectorAll('[data-src]'),
          ...document.querySelectorAll('[data-url]'),
          ...document.querySelectorAll('[onclick*=".m3u8"], [onclick*=".mp4"]'),
        ];
        
        elements.forEach(el => {
          // Obtém URL de diferentes atributos
          const attributes = ['src', 'data-src', 'data-url', 'href'];
          for (const attr of attributes) {
            const value = el.getAttribute(attr);
            if (value && (value.includes('.m3u8') || value.includes('.mp4'))) {
              urls.push(value);
            }
          }
          
          // Verifica conteúdo do elemento
          const content = el.textContent || '';
          if (content.includes('.m3u8') || content.includes('.mp4')) {
            const matches = content.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
            if (matches) {
              urls.push(...matches);
            }
          }
        });
        
        return [...new Set(urls)];
      });
      
      const filteredPageUrls = this.filterRealVideoUrls(pageUrls);
      if (filteredPageUrls.length > 0) {
        const prioritized = this.prioritizeUrls(filteredPageUrls);
        const bestPageUrl = prioritized[0];
        
        this.logger.log(`[Processor] ✅ URL encontrada no HTML: ${bestPageUrl.substring(0, 100)}...`);
        
        return {
          url: bestPageUrl,
          headers: {
            'Referer': 'https://doramasonline.org/',
            'Origin': 'https://doramasonline.org',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        };
      }

      // 5️⃣ FALLBACK: IFRAMES
      const iframeSrcs = await page.$$eval(
        'iframe',
        frames =>
          frames
            .map(f => (f as HTMLIFrameElement).src)
            .filter(Boolean)
            .filter(src => src.includes('.m3u8') || src.includes('.mp4'))
      );

      if (iframeSrcs.length > 0 && allowExternalUrl) {
        this.logger.warn(`[Processor] ⚠️ Fallback para iframe externo`);
        return { externalUrl: iframeSrcs[0] };
      }

      // 6️⃣ NADA ENCONTRADO
      this.logger.error(`[Processor] ❌ Nenhuma fonte de vídeo encontrada`);
      this.logger.debug(`[Processor] 📋 Últimas URLs capturadas:`, capturedUrls.slice(-10));
      
      return null;
      
    } catch (e: any) {
      this.logger.error(`[Processor] 💥 Erro: ${e.message}`);
      return null;
    } finally {
      if (page) {
        // Limpar listeners antes de fechar
        await page.setRequestInterception(false).catch(() => {});
        await page.close().catch(() => {});
      }
    }
  }
}
