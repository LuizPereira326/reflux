import { Audio, Quality, Provider } from '@prisma/client';

export interface DelegateMovieProperties {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  poster: string;
  rating: number;
  releasedAt: Date;
  genres: any[];
  streams: any[];
}

export interface DelegateSeriesProperties {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  poster: string;
  rating: number;
  releasedAt: Date;
  genres: any[];
  streams: any[];
}

export interface DelegateMovieProviders {
  id: string;
  title: string;
  type: string;
  poster: string;
  sourceUrl: string;
  url?: string;
  audio?: Audio;
  quality?: Quality;
}

export interface DelegateSeriesProviders {
  id: string;
  title: string;
  type: string;
  poster: string;
  sourceUrl: string;
}

export interface DelegateMovieStreams {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  poster: string;
  rating: number;
  releasedAt: Date;
  genres: any[];
  provider: any;
}

export interface DelegateSeriesStreams {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  poster: string;
  rating: number;
  releasedAt: Date;
  genres: any[];
  provider: any;
}

export interface DelegateSeriesEpisodes {
  title: string;
  season: number;
  episode: number;
  tracks?: any[];
}
