import { Controller, Get, Query, Res, Headers, Logger, Options } from '@nestjs/common';
import { Response } from 'express';
import fetch from 'node-fetch';
import * as https from 'https';
import * as net from 'net';
import { TLSSocket } from 'tls'; // 🔥 Import para TLS

@Controller('proxy')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  private readonly BUNNY_CDN_IPS = [
    '172.67.217.10',
    '104.21.84.191',
    '172.67.129.179',
  ];

  private readonly DOMAIN_TO_IP = new Map<string, string>([
    ['doce-de-leite-vegano.b-cdn.net', '172.67.217.10'],
    ['doflix.net', '172.67.217.10'],
    ['streamingverde.com', '172.67.217.10'],
  ]);

  /**
   * ESTA É A CHAVE: Força a conexão para o IP, mas mantém o Host/SNI original
   */
  private createBypassAgent(hostname: string, targetIp: string): https.Agent {
    // 🔥 Criamos um Agent personalizado estendendo a classe Agent
    const agent = new https.Agent({
      keepAlive: true,
      rejectUnauthorized: false,
    });

    // 🔥 Sobrescreve o método createConnection
    (agent as any).createConnection = (options: https.RequestOptions, callback?: Function) => {
      // Cria uma conexão TCP direta para o IP
      const socket = net.connect({
        host: targetIp,
        port: 443,
      });

      // 🔥 Cria um socket TLS com o SNI correto
      const tlsOptions = {
        socket: socket,
        host: hostname, // Usado para SNI
        servername: hostname, // 🔥 CRUCIAL para SSL handshake
        rejectUnauthorized: false,
      };

      // @ts-ignore - Ignora erro de tipo para tlsSocket
      const tlsSocket: TLSSocket = new (require('tls').TLSSocket)(socket, tlsOptions);
      
      if (callback) {
        callback(null, tlsSocket);
      }
      
      return tlsSocket;
    };

    return agent;
  }

  @Get('stream')
  async proxyStream(
    @Query('url') encodedUrl: string,
    @Headers() clientHeaders: any,
    @Res() res: Response,
  ) {
    const requestId = Math.random().toString(36).substring(2, 8);
    
    try {
      if (!encodedUrl) {
        return res.status(400).json({ error: 'URL missing' });
      }
      
      const url = decodeURIComponent(encodedUrl);
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      const targetIp = this.DOMAIN_TO_IP.get(hostname);

      // Headers - CRUCIAL manter o Host correto
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://doramasonline.org/',
        'Origin': 'https://doramasonline.org',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Host': hostname, // 🔥 CRUCIAL para bypass funcionar
      };

      if (clientHeaders.range) {
        headers['Range'] = clientHeaders.range;
        this.logger.debug(`[${requestId}] 📦 Range: ${clientHeaders.range}`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      this.logger.log(`[${requestId}] 🚀 Request: ${hostname} (Bypass: ${targetIp || 'Não'})`);

      let response;
      let currentAgent: https.Agent;
      
      if (targetIp) {
        currentAgent = this.createBypassAgent(hostname, targetIp);
      } else {
        currentAgent = new https.Agent({ 
          rejectUnauthorized: false, 
          keepAlive: true 
        });
      }

      try {
        response = await fetch(url, {
          headers,
          agent: currentAgent,
          signal: controller.signal,
          compress: false,
        });
        
        clearTimeout(timeout);
        
      } catch (err: any) {
        clearTimeout(timeout);
        
        this.logger.error(`[${requestId}] 💥 Fetch error: ${err.message}`);
        
        // TENTA RETRY COM IPs ALTERNATIVOS SE O PRIMEIRO FALHAR
        if (targetIp) {
          this.logger.warn(`[${requestId}] 🚨 Falha no IP inicial, tentando IPs alternativos do Bunny...`);
          
          for (const altIp of this.BUNNY_CDN_IPS) {
            if (altIp === targetIp) continue;
            
            try {
              this.logger.debug(`[${requestId}] 🔄 Tentando IP: ${altIp}`);
              const altAgent = this.createBypassAgent(hostname, altIp);
              
              response = await fetch(url, {
                headers,
                agent: altAgent,
                signal: controller.signal,
                compress: false,
              });
              
              if (response && (response.ok || response.status === 206)) {
                this.logger.log(`[${requestId}] ✅ Conexão bem-sucedida com ${altIp}`);
                break;
              }
            } catch (innerErr: any) {
              this.logger.warn(`[${requestId}] ❌ Falha com IP ${altIp}: ${innerErr.message}`);
              continue;
            }
          }
        }
        
        if (!response) {
          throw err;
        }
      }

      // --- PROCESSAMENTO DA RESPOSTA (M3U8 ou Stream) ---
      
      if (!response.ok && response.status !== 206) {
        return res.status(response.status).send(`Erro Upstream: ${response.status}`);
      }

      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Copia headers
      const headersToCopy = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      headersToCopy.forEach(h => {
        const val = response.headers.get(h);
        if (val) res.setHeader(h, val);
      });

      // M3U8 processing
      const contentType = response.headers.get('content-type') || '';
      const isM3U8 = contentType.includes('mpegurl') || 
                    contentType.includes('m3u8') || 
                    url.includes('.m3u8');
      
      if (isM3U8) {
        const content = await response.text();
        
        // Reescreve URLs do M3U8 para passar pelo proxy também
        const rewritten = content.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('http')) {
            return line;
          }
          return `/proxy/stream?url=${encodeURIComponent(trimmed)}`;
        }).join('\n');
        
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(rewritten);
      }

      // Stream normal
      res.status(response.status);
      
      if (response.body) {
        response.body.pipe(res);
      } else {
        res.end();
      }

    } catch (error: any) {
      this.logger.error(`[${requestId}] 💥 Erro Final: ${error.message}`);
      
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Proxy error',
          message: error.message,
          requestId: requestId
        });
      }
    }
  }

  @Options('stream')
  handleOptions(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.status(204).end();
  }
}
