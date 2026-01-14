import { GenresRepository } from '@/modules/genres/genres.repository';
import { NlpProcessingService } from '@/modules/nlp/services/processing.service';
import { ContentType, SearchMovie, SearchTv } from '@/modules/tmdb/types/tmdb';
import { Injectable } from '@nestjs/common';
import { Movie, MovieGenre, Series, SeriesGenre } from '@prisma/client';

@Injectable()
export class NlpQueriesService {
  public constructor(
    private readonly genresRepository: GenresRepository,
    private readonly processingService: NlpProcessingService,
  ) {}

  public async search(
    type: ContentType,
    title: string,
    search: (SearchMovie & SearchTv)[],
  ): Promise<
    (Movie & { genres: MovieGenre[] }) | (Series & { genres: SeriesGenre[] })
  > {
    const titles = search.map((result) => result.name ?? result.title);

    const bestMatch = this.processingService.findBestMatch(title, titles);
    const compareMatch = this.processingService.compareBestMatch(title, titles);

    const index = bestMatch?.index ?? compareMatch?.index;
    const result = search[index];

    if (!result) {
      return null;
    }

    const genres = await this.genresRepository.getGenres(
      type,
      result.genre_ids,
    );

    return {
      id: result.id,
      title: result.name ?? result.title,
      description: result.overview,
      thumbnail: result.backdrop_path,
      poster: result.poster_path,
      rating: result.vote_average,
      genres,
      releasedAt: result.release_date
        ? new Date(result.release_date)
        : result.first_air_date
          ? new Date(result.first_air_date)
          : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
