import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Response } from 'express';
import puppeteerExtra from 'puppeteer-extra';
import * as puppeteer from 'puppeteer';
import axios from 'axios';

const StealthPlugin = require('puppeteer-extra-plugin-stealth');

interface DownloadResult {
  url: string;
  cookies: string;
}

@Injectable()
export class GdriveProxyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GdriveProxyService.name);
  private browser: puppeteer.Browser | null = null;
  private downloadCache = new Map<string, { url: string; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000;

  async onModuleInit() {
    try {
      puppeteerExtra.use(StealthPlugin());
    } catch (error) {
      puppeteerExtra.use(StealthPlugin.default());
    }

    this.browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });

    this.logger.log('✅ Browser Puppeteer iniciado para Google Drive proxy');
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.logger.log('🛑 Browser Puppeteer encerrado');
    }
  }

  async streamVideo(fileId: string, res: Response): Promise<void> {
    try {
      this.logger.log(`📥 [Puppeteer] Iniciando streaming: ${fileId}`);

      const cached = this.downloadCache.get(fileId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.logger.log(`💾 Usando URL em cache: ${fileId}`);
        return this.streamFromUrl(cached.url, res);
      }

      const downloadData = await this.getDownloadUrl(fileId);
      
      if (!downloadData) {
        throw new Error('Não foi possível obter URL de download');
      }

      this.downloadCache.set(fileId, {
        url: downloadData.url,
        timestamp: Date.now(),
      });

      await this.streamFromUrl(downloadData.url, res, downloadData.cookies);

      this.logger.log(`✅ [Puppeteer] Streaming concluído: ${fileId}`);

    } catch (error) {
      this.logger.error(`❌ [Puppeteer] Erro no streaming: ${error.message}`);
      throw error;
    }
  }

  private async getDownloadUrl(fileId: string): Promise<DownloadResult | null> {
    if (!this.browser) {
      throw new Error('Browser não inicializado');
    }

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      );

      await page.setViewport({ width: 1920, height: 1080 });

      const driveUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;
      this.logger.debug(`🌐 Navegando para: ${driveUrl}`);

      await page.goto(driveUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Aguarda a página carregar completamente
      await new Promise(r => setTimeout(r, 3000));

      // Log do HTML para debug (primeiros 2000 caracteres)
      const html = await page.content();
      this.logger.debug(`🔍 HTML da página: ${html.substring(0, 2000)}...`);

      let downloadUrl: string | null = null;

      // Verifica se existe o elemento #uc-download-link (pode ser <a> ou <input>)
      const elementExists = await page.$('#uc-download-link');

      if (elementExists) {
        this.logger.debug('✅ Elemento #uc-download-link encontrado');

        // Extrai a URL diretamente do HTML
        downloadUrl = await page.evaluate(() => {
          const elem = document.querySelector('#uc-download-link');
          
          if (!elem) return null;

          // Se for um link <a>, pega o href
          if (elem.tagName === 'A') {
            return (elem as HTMLAnchorElement).href;
          }
          
          // Se for um input dentro de form, constrói a URL do form
          if (elem.tagName === 'INPUT') {
            const form = elem.closest('form');
            if (!form) return null;

            const action = form.getAttribute('action') || '';
            const inputs = form.querySelectorAll('input[type="hidden"]');
            
            const params = new URLSearchParams();
            inputs.forEach((input: HTMLInputElement) => {
              if (input.name) {
                params.append(input.name, input.value);
              }
            });

            // Adiciona o ID do arquivo se não estiver nos hidden inputs
            if (!params.has('id')) {
              const urlParams = new URLSearchParams(window.location.search);
              const id = urlParams.get('id');
              if (id) params.append('id', id);
            }

            // Adiciona confirm=t para bypass do aviso
            if (!params.has('confirm')) {
              params.append('confirm', 't');
            }

            return params.toString() ? `${action}?${params.toString()}` : action;
          }

          return null;
        });

        this.logger.debug(`🔗 URL extraída: ${downloadUrl?.substring(0, 100)}...`);

        // Se conseguiu extrair a URL, tenta clicar para obter a URL real do streaming
        if (downloadUrl) {
          try {
            const downloadPromise = new Promise<string>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Timeout aguardando resposta'));
              }, 20000);

              page.on('response', async (response) => {
                const url = response.url();
                const contentType = response.headers()['content-type'] || '';
                
                if (
                  contentType.includes('video/') || 
                  contentType.includes('application/octet-stream') ||
                  url.includes('googleusercontent.com/download')
                ) {
                  clearTimeout(timeout);
                  this.logger.debug(`📹 URL de vídeo capturada: ${url.substring(0, 100)}...`);
                  resolve(url);
                }
              });
            });

            await elementExists.click();
            this.logger.debug('🖱️ Clique executado, aguardando resposta...');

            const clickedUrl = await downloadPromise;
            if (clickedUrl) {
              downloadUrl = clickedUrl;
            }
          } catch (clickError) {
            this.logger.warn(`⚠️ Erro ao clicar/capturar URL: ${clickError.message}`);
            this.logger.warn('📋 Usando URL extraída do HTML');
          }
        }
      } else {
        this.logger.debug('🔍 Elemento #uc-download-link não encontrado');
      }

      // Fallback: verifica se já foi redirecionado para a URL de download
      if (!downloadUrl) {
        const currentUrl = page.url();
        this.logger.debug(`🔍 URL atual da página: ${currentUrl}`);
        
        if (currentUrl.includes('googleusercontent.com') || currentUrl !== driveUrl) {
          downloadUrl = currentUrl;
          this.logger.debug('✅ Usando URL atual como download URL');
        }
      }

      if (!downloadUrl) {
        const pageTitle = await page.title();
        throw new Error(`URL de download não encontrada. Título da página: ${pageTitle}`);
      }

      const cookies = await page.cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      this.logger.log(`✅ URL de download obtida: ${downloadUrl.substring(0, 150)}...`);

      await page.close();

      return {
        url: downloadUrl,
        cookies: cookieString,
      };

    } catch (error) {
      this.logger.error(`❌ Erro ao obter URL de download: ${error.message}`);
      await page.close();
      return null;
    }
  }

  private async streamFromUrl(
    url: string,
    res: Response,
    cookies?: string,
  ): Promise<void> {
    try {
      const headers: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      };

      if (cookies) {
        headers['Cookie'] = cookies;
      }

      // Suporte a Range Requests (para pular no vídeo)
      const range = res.req.headers.range;
      if (range) {
        headers['Range'] = range;
        this.logger.debug(`📍 Range request: ${range}`);
      }

      this.logger.debug(`🌐 Fazendo requisição para: ${url.substring(0, 100)}...`);

      const streamResponse = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: headers,
        maxRedirects: 5,
        validateStatus: () => true,
        timeout: 60000,
      });

      const contentType = streamResponse.headers['content-type'] || 'video/mp4';
      const contentLength = streamResponse.headers['content-length'];
      const contentRange = streamResponse.headers['content-range'];
      
      this.logger.log(
        `📹 Streaming iniciado: Status ${streamResponse.status}, Type: ${contentType}, Size: ${contentLength || 'unknown'}${range ? ` (Range: ${range})` : ''}`,
      );

      if (contentType.includes('text/html')) {
        throw new Error('Recebendo HTML ao invés de vídeo - possível erro de autenticação');
      }

      // Se for Range Request, retorna 206 Partial Content
      if (range && streamResponse.status === 206) {
        res.status(206);
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        }
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (streamResponse.headers['content-disposition']) {
        res.setHeader('Content-Disposition', streamResponse.headers['content-disposition']);
      }

      streamResponse.data.pipe(res);

      streamResponse.data.on('error', (error: Error) => {
        // Ignora erros de "aborted" que são normais quando o player para
        if (error.message !== 'aborted') {
          this.logger.error(`❌ Erro no streaming de dados: ${error.message}`);
        }
        if (!res.headersSent) {
          res.status(500).send('Erro durante o streaming');
        }
      });

      streamResponse.data.on('end', () => {
        this.logger.debug('✅ Stream finalizado com sucesso');
      });

    } catch (error) {
      this.logger.error(`❌ Erro ao fazer stream da URL: ${error.message}`);
      throw error;
    }
  }

  async testFile(fileId: string): Promise<{ success: boolean; error?: string; url?: string }> {
    try {
      const downloadData = await this.getDownloadUrl(fileId);
      
      if (!downloadData) {
        return { success: false, error: 'URL de download não encontrada' };
      }

      return { 
        success: true, 
        url: downloadData.url.substring(0, 200) 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
