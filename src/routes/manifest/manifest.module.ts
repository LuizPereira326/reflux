import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ManifestService } from './manifest.service';
import { ManifestController } from './manifest.controller';
import { TopflixModule } from '@/providers/topflix/topflix.module';
import { EnvModule } from '@/modules/env/env.module';
import { TvModule } from '@/modules/tv/tv.module';
import { DoramoreModule } from '@/modules/doramore/doramore.module';
import { DoramasMP4Module } from '@/modules/doramasmp4/doramasmp4.module'; // <-- ADICIONE

@Module({
  imports: [
    DoramoreModule,
    DoramasMP4Module, // <-- ADICIONE
    HttpModule,
    TopflixModule,
    EnvModule,
    TvModule,
  ],
  providers: [ManifestService],
  controllers: [ManifestController],
  exports: [ManifestService],
})
export class ManifestModule {}
