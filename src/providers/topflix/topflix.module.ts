import { Module } from '@nestjs/common';
import { TopflixService } from './topflix.service';
import { TopflixGetterService } from './services/getter.service';
import { TopflixScraperService } from './services/scraper.service';
import { TopflixProcessorService } from './services/topflix.processor.service';
import { TopflixSeriesService } from './services/topflix.series.service';
import { BrowserPoolService } from './services/browser-pool.service'; // ✅ IMPORTAR
import { TmdbModule } from '@/modules/tmdb/tmdb.module';
import { RedeCanaisModule } from '@/modules/rede-canais/rede-canais.module';
import { EventEmitterModule } from '@nestjs/event-emitter'; // ✅ IMPORTAR

@Module({
  imports: [
    EventEmitterModule.forRoot(), // 👈 ISSO RESOLVE
    TmdbModule,
    RedeCanaisModule,
  ],
  providers: [
    // Serviços Principais
    TopflixService,
    
    // Serviços Especializados
    TopflixGetterService,
    TopflixScraperService,
    
    // 📍 CRÍTICOS: Processador de Stream e Lógica de Séries
    TopflixProcessorService,
    TopflixSeriesService,
    BrowserPoolService, // ✅ ADICIONAR AQUI PARA RESOLVER A DEPENDÊNCIA
  ],
  exports: [
    TopflixService,
    TopflixGetterService,
    TopflixScraperService,
    TopflixProcessorService,
    TopflixSeriesService,
    BrowserPoolService, // ✅ Sugestão: exportar também se outros precisarem do pool
  ],
})
export class TopflixModule {}
