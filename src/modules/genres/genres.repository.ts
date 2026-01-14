import { TmdbService } from '@/modules/tmdb/tmdb.service';
import { ContentType } from '@/modules/tmdb/types/tmdb';
import { Injectable } from '@nestjs/common';
import { MovieGenre, SeriesGenre } from '@prisma/client';

@Injectable()
export class GenresRepository {
  public constructor(private readonly tmdbService: TmdbService) {}

  public async getGenres(
    type: ContentType,
    genreIds: number[],
  ): Promise<MovieGenre[] | SeriesGenre[]> {
    const model = this.tmdbService.convertGenreContentType(type);
    const genres = await model.findMany({
      where: { id: { in: genreIds } },
    });

    return genres;
  }
}
