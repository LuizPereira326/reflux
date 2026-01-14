import { Module } from '@nestjs/common';
import { DoramasMP4Service } from './doramasmp4.service';
import { DoramasMP4ScraperService } from './services/scraper.service';
import { DoramasMP4ProcessorService } from './services/processor.service';
import { DoramasMP4MetaService } from './services/meta.service';
import { DoramasMP4SeriesService } from './services/series.service';
import { GdriveProxyService } from './services/gdrive-proxy.service';
import { GDriveProxyController } from './controllers/gdrive-proxy.controller';
import { TmdbModule } from '../tmdb/tmdb.module';

@Module({
  imports: [TmdbModule],
  controllers: [GDriveProxyController],
  providers: [
    DoramasMP4Service, 
    DoramasMP4ScraperService, 
    DoramasMP4ProcessorService,
    DoramasMP4MetaService,
    DoramasMP4SeriesService,
    GdriveProxyService,
  ],
  exports: [
    DoramasMP4Service,
    DoramasMP4ScraperService, // <-- ADICIONE AQUI
  ],
})
export class DoramasMP4Module {}
