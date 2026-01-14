import { Controller, Get, Param, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { StremioService } from './stremio.service';
import { TvService } from '../tv/tv.service';

@Controller()
export class StremioController {
  private readonly logger = new Logger(StremioController.name);

  constructor(
    private readonly stremioService: StremioService,
    private readonly tvService: TvService,
  ) {}

  @Get('catalog/:type/:id*.json')
  async getCatalog(
    @Param('type') type: string,
    @Param('id') fullPath: string,
    @Req() request: Request,
  ) {
    const url = request.url.split('?')[0];
    this.logger.log(`📚 Full URL: ${request.url}`);
    
    const match = url.match(/\/catalog\/([^\/]+)\/([^\/]+?)(?:\/([^\.]+))?\.json$/);
    
    let catalogId = fullPath.split('/')[0];
    let extraParams: Record<string, string> = {};
    
    if (match) {
      catalogId = match[2];
      const extraString = match[3];
      
      if (extraString) {
        extraString.split('&').forEach(pair => {
          const [key, value] = pair.split('=');
          if (key && value) {
            extraParams[key] = decodeURIComponent(value);
          }
        });
      }
    }

    this.logger.log(`📚 Parsed -> catalogId="${catalogId}", extra=${JSON.stringify(extraParams)}`);

    if (catalogId === 'topflix.tv' || catalogId === 'reflux.tv') {
      const channels = await this.tvService.getStremioCatalog();
      return { metas: channels };
    }

    if (catalogId === 'topflix.movies' || catalogId === 'reflux.movies') {
      this.logger.log('🎬 TopFlix Movies');
      return this.stremioService.getCatalog('movie', 'reflux.movies');
    }

    if (catalogId === 'topflix.series' || catalogId === 'reflux.series') {
      this.logger.log('📺 TopFlix Series');
      return this.stremioService.getCatalog('series', 'reflux.series');
    }

    if (catalogId === 'doramore.series' || catalogId === 'reflux.doramore') {
      const genre = extraParams.genre || 'Todos';
      const skip = parseInt(extraParams.skip || '0');
      
      this.logger.log(`🎭 DoraMore: genre="${genre}", skip=${skip}`);

      if (genre === 'Todos') {
        const result = await this.stremioService.getCatalog('series', 'doramore.all');
        this.logger.log(`🎭 All returned ${result.metas?.length || 0} items`);
        return result;
      }

      const genreSlug = genre.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-');

      this.logger.log(`🎭 Fetching genre slug: "${genreSlug}"`);
      
      const result = await this.stremioService.getDoramoreCatalogByGenre(genreSlug);
      this.logger.log(`🎭 Genre "${genre}" returned ${result.metas?.length || 0} items`);
      return result;
    }

    return await this.stremioService.getCatalog(type, catalogId);
  }

  @Get('meta/:type/:id.json')
  async getMeta(@Param('type') type: string, @Param('id') id: string) {
    this.logger.log(`🎬 Meta: type="${type}", id="${id}"`);

    if (type === 'channel' && id.startsWith('topflix:channel:')) {
      const channels = await this.tvService.getStremioCatalog();
      const meta = channels.find(c => c.id === id);
      return { meta };
    }

    // CORRIGIDO: Deixa o StremioService.getMeta() lidar com tudo
    return await this.stremioService.getMeta(type, id);
  }

  @Get('stream/:type/:id.json')
  async getStream(@Param('type') type: string, @Param('id') id: string) {
    this.logger.log(`🎥 Stream: type="${type}", id="${id}"`);

    if (type === 'channel' && id.startsWith('topflix:channel:')) {
      const channelId = id.split(':').pop();
      const allChannels = await this.tvService.getAllChannels();
      const channel = allChannels.find(c => c.id === channelId);
      
      if (channel) {
        return { streams: [{ title: channel.name, url: channel.streamUrl }] };
      }
    }

    // CORRIGIDO: Deixa o StremioService.getStream() lidar com tudo
    return await this.stremioService.getStream(type, id);
  }

  @Get('health')
  async health() {
    this.logger.log('💚 Health');
    const stats = await this.stremioService.getStats();
    return { status: 'ok', timestamp: new Date().toISOString(), stats };
  }
}
