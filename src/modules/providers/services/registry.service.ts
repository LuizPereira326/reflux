import {
  DelegateMovieProperties,
  DelegateMovieProviders,
  DelegateSeriesEpisodes,
  DelegateSeriesProperties,
  DelegateSeriesProviders,
} from '@/modules/providers/types';
import { Injectable } from '@nestjs/common';
import { Audio, Provider, Quality } from '@prisma/client';

@Injectable()
export class ProvidersRegistryService {
  public static readonly providers: Map<Provider, ProvidersRegistryService> =
    new Map();

  public type: Provider;

  public movies: DelegateMovieProperties[] = [];
  public series: DelegateSeriesProperties[] = [];

  public constructor() {}

  public register(provider: Provider): void {
    this.type = provider;
    ProvidersRegistryService.providers.set(provider, this);
  }

  public async fetchMovies(): Promise<DelegateMovieProviders[]> {
    return [];
  }

  public async fetchSeries(): Promise<DelegateSeriesProviders[]> {
    return [];
  }

  public async indexMovies(movies: DelegateMovieProviders[]): Promise<void> {}

  public async indexSeries(series: DelegateSeriesProviders[]): Promise<void> {}

  public async refreshMovieUrl(
    movie: DelegateMovieProperties,
    audio: Audio,
    quality: Quality,
  ): Promise<string> {
    return '';
  }

  public async refreshSeriesUrl(
    series: DelegateSeriesProperties,
    season: number,
    episode: number,
    audio: Audio,
  ): Promise<string> {
    return '';
  }

  public async getSeriesEpisodes(
    series: DelegateSeriesProperties,
  ): Promise<DelegateSeriesEpisodes[]> {
    return [];
  }
}
