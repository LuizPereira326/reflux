export enum ContentType {
  MOVIE = 'movie',
  TV = 'tv',
}

export enum TrendingType {
  ALL = 'ALL',
  POPULAR = 'POPULAR',
  TOP_RATED = 'TOP_RATED',
  THEATHER = 'THEATHER',
}

export interface Search<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface Genre {
  id: number;
  name: string;
}

export interface SearchMovie {
  adult: boolean;
  backdrop_path: string;
  genre_ids: number[];
  id: number;
  original_language: string;
  original_title: string;
  overview: string;
  popularity: number;
  poster_path: string;
  release_date: string;
  title: string;
  video: boolean;
  vote_average: number;
  vote_count: number;
}

export interface SearchTv {
  adult: boolean;
  backdrop_path: string;
  genre_ids: number[];
  id: number;
  origin_country: string[];
  original_language: string;
  original_name: string;
  overview: string;
  popularity: number;
  poster_path: string;
  first_air_date: string;
  name: string;
  vote_average: number;
  vote_count: number;
}

export interface TmdbEpisode {
  id: number;
  name: string; // Título do episódio
  overview: string; // Sinopse do episódio
  vote_average: number;
  vote_count: number;
  air_date: string;
  episode_number: number;
  season_number: number;
  still_path: string | null; // ⚠️ CAMPO CHAVE: É a thumbnail que precisamos pro Stremio
}

export interface TmdbSeason {
  _id: string;
  air_date: string;
  episode_count: number;
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  season_number: number;
}

export interface TmdbSeasonResponse {
  _id: string;
  air_date: string;
  episodes: TmdbEpisode[]; // Aqui está a lista de episódios com as imagens
  name: string;
  overview: string;
  id: number;
  poster_path: string | null;
  season_number: number;
}
