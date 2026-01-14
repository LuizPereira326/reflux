import { Module } from '@nestjs/common';
import { StremioController } from './stremio.controller';
import { StremioService } from './stremio.service';
import { ManifestController } from '@/routes/manifest/manifest.controller';
import { ManifestService } from '@/routes/manifest/manifest.service';
import { TopflixModule } from '@/providers/topflix/topflix.module';
import { TmdbModule } from '@/modules/tmdb/tmdb.module';
import { HttpModule } from '@nestjs/axios';
import { EnvModule } from '@/modules/env/env.module';
import { TvModule } from '@/modules/tv/tv.module';
import { RedeCanaisModule } from '@/modules/rede-canais/rede-canais.module';
import { DoramoreModule } from '@/modules/doramore/doramore.module';
import { DoramasMP4Module } from '@/modules/doramasmp4/doramasmp4.module'; // <-- ADICIONE

@Module({
  imports: [
    TopflixModule,
    TmdbModule,
    TvModule,
    RedeCanaisModule,
    DoramoreModule,
    DoramasMP4Module, // <-- ADICIONE
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 10000,
        maxRedirects: 5,
      }),
    }),
    EnvModule,
  ],
  controllers: [StremioController, ManifestController],
  providers: [StremioService, ManifestService],
  exports: [StremioService],
})
export class StremioModule {}
