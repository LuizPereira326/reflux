import { Controller, Get, Param } from '@nestjs/common';
import { StremioService } from '@/modules/stremio/stremio.service';

@Controller('meta')
export class MetaController {
  constructor(
    private readonly stremioService: StremioService,
  ) {}

  @Get('/:type/:id.json')
  async getMeta(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    // aceita movie, series e channel
    if (!['movie', 'series', 'channel'].includes(type)) {
      return { meta: {} };
    }

    return this.stremioService.getMeta(type, id);
  }
}

