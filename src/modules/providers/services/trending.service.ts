import { EnvService } from '@/modules/env/env.service';
import {
  DelegateMovieProperties,
  DelegateSeriesProperties,
} from '@/modules/providers/types';
import { TmdbService } from '@/modules/tmdb/tmdb.service';
import {
  ContentType,
  SearchMovie,
  SearchTv,
  TrendingType,
} from '@/modules/tmdb/types/tmdb';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import PromisePool from '@supercharge/promise-pool';

export type TrendingKey = {
  type: TrendingType;
  id: number;
};

export type TrendingMovieValue = {
  type: TrendingType;
  data: DelegateMovieProperties;
};

export type TrendingSeriesValue = {
  type: TrendingType;
  data: DelegateSeriesProperties;
};

export type TrendingItem = {
  type: ContentType;
  trending: TrendingType;
  data: SearchMovie | SearchTv;
};

export const CONCURRENCY_LIMIT = 25;
export const PAGES_TO_FETCH = 100;

@Injectable()
export class ProvidersTrendingService implements OnModuleInit {
  private readonly logger = new Logger(ProvidersTrendingService.name);

  public readonly trendingMovies = new Map<TrendingKey, TrendingMovieValue>();
  public readonly trendingSeries = new Map<TrendingKey, TrendingSeriesValue>();

  public constructor(
    private readonly envService: EnvService,
    private readonly tmdbService: TmdbService,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (this.envService.get('NODE_ENV') === 'production') {
      this.logger.log('Syncing trendings with tmdb, please wait...');

      const trendings = await this.loadTrendings();
      await this.saveTrendings(trendings);

      this.logger.log('Database trendings is fully sync with tmdb.');
    }
  }

  public convertStringToContentType(type: string): ContentType {
    switch (type) {
      case 'movie':
        return ContentType.MOVIE;

      case 'series':
        return ContentType.TV;
    }
  }

  public convertStringToTrending(trending: string): TrendingType {
    switch (trending) {
      case 'ALL':
        return TrendingType.ALL;

      case 'POPULAR':
        return TrendingType.POPULAR;

      case 'TOP_RATED':
        return TrendingType.TOP_RATED;

      case 'THEATHER':
        return TrendingType.THEATHER;
    }
  }

  public convertContentTypeToString(type: ContentType): string {
    switch (type) {
      case ContentType.MOVIE:
        return 'movie';

      case ContentType.TV:
        return 'series';
    }
  }

  public convertTrendingToString(trending: TrendingType): string {
    switch (trending) {
      case TrendingType.ALL:
        return 'Todos';

      case TrendingType.POPULAR:
        return 'Em alta';

      case TrendingType.TOP_RATED:
        return 'Mais avaliados';

      case TrendingType.THEATHER:
        return 'Lançamentos';
    }
  }

  private async loadTrendings(): Promise<TrendingItem[]> {
    const size = Array.from({ length: PAGES_TO_FETCH }, (_, i) => i + 1);
    const trendings: TrendingItem[] = [];

    this.trendingMovies.clear();
    this.trendingSeries.clear();

    await new PromisePool()
      .withConcurrency(CONCURRENCY_LIMIT)
      .for(size)
      .process(async (page) => {
        const [populars, topRateds, theathers] = await Promise.all([
          Promise.all([
            this.tmdbService.getTrending(
              ContentType.MOVIE,
              TrendingType.POPULAR,
              page,
            ),
            this.tmdbService.getTrending(
              ContentType.TV,
              TrendingType.POPULAR,
              page,
            ),
          ]),
          Promise.all([
            this.tmdbService.getTrending(
              ContentType.MOVIE,
              TrendingType.TOP_RATED,
              page,
            ),
            this.tmdbService.getTrending(
              ContentType.TV,
              TrendingType.TOP_RATED,
              page,
            ),
          ]),
          Promise.all([
            this.tmdbService.getTrending(
              ContentType.MOVIE,
              TrendingType.THEATHER,
              page,
            ),
          ]),
        ]);

        const movies: TrendingItem[] = [
          ...populars[0].map((trending) => ({
            type: 'movie' as ContentType,
            trending: TrendingType.POPULAR,
            data: trending,
          })),
          ...topRateds[0].map((trending) => ({
            type: 'movie' as ContentType,
            trending: TrendingType.TOP_RATED,
            data: trending,
          })),
          ...theathers[0].map((trending) => ({
            type: 'movie' as ContentType,
            trending: TrendingType.THEATHER,
            data: trending,
          })),
        ];

        const series: TrendingItem[] = [
          ...populars[1].map((trending) => ({
            type: 'tv' as ContentType,
            trending: TrendingType.POPULAR,
            data: trending,
          })),
          ...topRateds[1].map((trending) => ({
            type: 'tv' as ContentType,
            trending: TrendingType.TOP_RATED,
            data: trending,
          })),
        ];

        trendings.push(...movies);
        trendings.push(...series);
      });

    return trendings;
  }

  private async saveTrendings(trendings: TrendingItem[]): Promise<void> {
    await new PromisePool()
      .withConcurrency(CONCURRENCY_LIMIT)
      .for(trendings)
      .process(async ({ type, trending, data }) => {
        const model = this.tmdbService.convertMediaContentType(type);
        const found = await model.findFirst({
          where: { id: data.id },
          include: { genres: true, streams: true },
        });

        if (!found) {
          return;
        }

        if (type === ContentType.MOVIE) {
          this.trendingMovies.set(
            { type: trending, id: data.id },
            { type: trending, data: found },
          );
        }

        if (type === ContentType.TV) {
          this.trendingSeries.set(
            { type: trending, id: data.id },
            { type: trending, data: found },
          );
        }
      });
  }
}
