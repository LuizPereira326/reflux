import { Controller, Get, Param, Logger } from '@nestjs/common';
import { StremioService } from '../../modules/stremio/stremio.service';
import { TvService } from '../../modules/tv/tv.service';

@Controller('catalog')
export class CatalogController {
  private readonly logger = new Logger(CatalogController.name);

  constructor(
    private readonly stremioService: StremioService,
    private readonly tvService: TvService,
  ) {}

  @Get('/:type/:id.json')
  async getCatalog(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    this.logger.log(`📦 Catalog request -> type=${type} id=${id}`);

    // TV
    if (id === 'reflux.tv') {
      this.logger.log('📺 Returning TV catalog');
      return { metas: await this.tvService.getStremioCatalog() };
    }

    // TOPFLIX - Filmes
    if (id === 'reflux.movies') {
      this.logger.log('🎬 Returning TopFlix movies');
      return this.stremioService.getCatalog('movie', 'reflux.movies');
    }

    // TOPFLIX - Séries
    if (id === 'reflux.series') {
      this.logger.log('📺 Returning TopFlix series');
      return this.stremioService.getCatalog('series', 'reflux.series');
    }

    // DORAMORE - Catálogo completo (todos os doramas)
    if (id === 'reflux.doramore') {
      this.logger.log('🎭 Fetching DoraMore complete catalog...');
      const result = await this.stremioService.getCatalog('series', 'doramore.all');
      this.logger.log(`🎭 DoraMore returned ${result.metas?.length || 0} items`);
      return result;
    }

    // DORAMORE - Por gênero
    if (id.startsWith('reflux.doramore.')) {
      const genre = id.replace('reflux.doramore.', '');
      this.logger.log(`🎭 Fetching DoraMore genre: ${genre}`);
      const result = await this.stremioService.getDoramoreCatalogByGenre(genre);
      this.logger.log(`🎭 DoraMore genre returned ${result.metas?.length || 0} items`);
      return result;
    }

    this.logger.warn(`⚠️ Unknown catalog: ${id}`);
    return { metas: [] };
  }
}
