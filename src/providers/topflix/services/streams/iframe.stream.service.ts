import { Injectable, Logger } from '@nestjs/common';
import { Stream } from '@/providers/topflix/interfaces/stream.interface';

@Injectable()
export class IframeStreamService {
  private readonly logger = new Logger(IframeStreamService.name);

  /**
   * Retorna um array de Stream para o Stremio.
   * @param type tipo vindo da rota (movie/series) — pode ser ignorado aqui se id contém prefixo
   * @param id id no formato topflix:movie:slug
   */
  public async getStream(type: string, id: string): Promise<Stream[]> {
    try {
      this.logger.log(`IframeStreamService.getStream type=${type} id=${id}`);

      const parts = id.split(':');
      if (parts.length < 3 || parts[0] !== 'topflix') {
        this.logger.warn(`ID inválido para IframeStreamService: ${id}`);
        return [];
      }

      const realType = parts[1]; // 'movie' | 'series'
      const realId = parts.slice(2).join(':'); // slug (pode conter ':' se algum dia)
      const playerUrl = this.buildPlayerUrl(realType, realId);

      const stream: Stream = {
        url: playerUrl,
        name: 'TopFlix Player',
        quality: 'HD',
        type: 'iframe',
        behaviorHints: {
          notWebReady: false
        }
      };

      return [stream];
    } catch (err: any) {
      this.logger.error(`Erro em IframeStreamService.getStream: ${err?.message || err}`);
      return [];
    }
  }

  private buildPlayerUrl(type: string, id: string): string {
    // Ajuste aqui para o seu player real
    return `https://seu-dominio.com/player/${type}/${id}`;
  }
}
