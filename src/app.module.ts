import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { createZodValidationPipe } from 'nestjs-zod';

import { EnvModule } from '@/modules/env/env.module';
import { GenresModule } from '@/modules/genres/genres.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { SearchModule } from '@/modules/search/search.module';
import { StremioModule } from '@/modules/stremio/stremio.module';
import { TvModule } from '@/modules/tv/tv.module';
import { RedeCanaisModule } from '@/modules/rede-canais/rede-canais.module';
import { DoramoreModule } from '@/modules/doramore/doramore.module';

import { CatalogModule } from '@/routes/catalog/catalog.module';
import { ManifestModule } from '@/routes/manifest/manifest.module';
import { MetaModule } from '@/routes/meta/meta.module';
import { StreamModule } from '@/routes/stream/stream.module';

import { TopflixModule } from '@/providers/topflix/topflix.module';
import { DoramasMP4Module } from './modules/doramasmp4/doramasmp4.module';

@Module({
  imports: [
    DoramasMP4Module,
    EnvModule,
    PrismaModule,
    GenresModule,
    SearchModule,
    StremioModule,
    TvModule,

    RedeCanaisModule,
    DoramoreModule,

    TopflixModule,

    CatalogModule,
    ManifestModule,
    MetaModule,
    StreamModule,

    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/',
    }),
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: createZodValidationPipe(),
    },
  ],
})
export class AppModule {}

