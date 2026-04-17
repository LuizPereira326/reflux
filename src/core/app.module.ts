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

import { CatalogModule } from '@/routes/catalog/catalog.module';
import { ManifestModule } from '@/routes/manifest/manifest.module';
import { MetaModule } from '@/routes/meta/meta.module';
import { StreamModule } from '@/routes/stream/stream.module';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    GenresModule,
    SearchModule,
    StremioModule,
    TvModule,

    RedeCanaisModule,

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

