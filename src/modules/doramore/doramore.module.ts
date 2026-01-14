import { Module } from '@nestjs/common';
import { DoramoreService } from './doramore.service';
import { DoramoreScraperService } from './services/scraper.service';
import { DoramoreProcessorService } from './services/processor.service';
import { DoramoreSeriesService } from './services/series.service';
import { DoramoreMetaService } from './services/meta.service';

import { GDriveProxyController } from './controllers/gdrive-proxy.controller';
import { ProxyController } from './controllers/proxy.controller';

import { GdriveProxyService } from './services/gdrive-proxy.service';
import { TmdbModule } from '@/modules/tmdb/tmdb.module';

@Module({
  imports: [TmdbModule],
  controllers: [
    GDriveProxyController,
    ProxyController, // ✅ ESSENCIAL
  ],
  providers: [
    DoramoreService,
    DoramoreScraperService,
    DoramoreProcessorService,
    DoramoreSeriesService,
    DoramoreMetaService,
    GdriveProxyService,
  ],
  exports: [
    DoramoreService,
    DoramoreScraperService,
    DoramoreMetaService,
    GdriveProxyService,
  ],
})
export class DoramoreModule {}

