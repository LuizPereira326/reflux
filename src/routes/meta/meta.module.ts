import { Module } from '@nestjs/common';
import { ManifestModule } from '@/routes/manifest/manifest.module';
import { ManifestController } from '@/routes/manifest/manifest.controller';
import { TopflixModule } from '@/providers/topflix/topflix.module';
import { TmdbModule } from '@/modules/tmdb/tmdb.module';
import { TvModule } from '@/modules/tv/tv.module';
import { RedeCanaisModule } from '@/modules/rede-canais/rede-canais.module';
import { DoramoreModule } from '@/modules/doramore/doramore.module';
import { HttpModule } from '@nestjs/axios';
import { EnvModule } from '@/modules/env/env.module';

@Module({
  imports: [
    ManifestModule,
    TopflixModule,
    TmdbModule,
    TvModule,
    RedeCanaisModule,
    DoramoreModule,
    EnvModule,
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 10000,
        maxRedirects: 5,
      }),
    }),
  ],
  controllers: [ManifestController],
  exports: [],
})
export class MetaModule {}
