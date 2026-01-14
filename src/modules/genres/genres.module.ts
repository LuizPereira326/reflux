import { GenresRepository } from '@/modules/genres/genres.repository';
import { GenresService } from '@/modules/genres/genres.service';
import { TmdbModule } from '@/modules/tmdb/tmdb.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [TmdbModule],
  providers: [GenresService, GenresRepository],
  exports: [GenresService, GenresRepository],
})
export class GenresModule {}
