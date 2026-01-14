import { EnvService } from '@/modules/env/env.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { API_URL, IMAGE_URL } from '@/modules/tmdb/constants/url';
import {
  ContentType,
  Genre,
  Search,
  SearchMovie,
  SearchTv,
  TrendingType,
  TmdbSeasonResponse,
} from '@/modules/tmdb/types/tmdb';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { LRUCache } from 'lru-cache';

export type DelegateMedias = Prisma.MovieDelegate & Prisma.SeriesDelegate;
export type DelegateGenres =
  Prisma.MovieGenreDelegate & Prisma.SeriesGenreDelegate;

@Injectable()
export class TmdbService implements OnModuleInit {
  private readonly logger = new Logger(TmdbService.name);
  
  // Axios configurado corretamente para API v3 (api_key via query string)
  private readonly api = axios.create({
    baseURL: API_URL,
    params: {
      api_key: this.envService.get('TMDB_KEY'), // API KEY v3
    },
  });
  
  // Cache robusto com LRU (least recently used) para evitar crescimento infinito
  // Config: Max 100 itens, TTL de 1 hora (3600000 ms)
  private readonly cache: LRUCache<string, any> = new LRUCache({
    max: 100,
    ttl: 3600000, // 1 hora
  });
  
  public constructor(
    private readonly envService: EnvService,
    private readonly prismaService: PrismaService,
  ) {}
  
  // Inicialização limpa (TMDB não exige validação manual)
  public async onModuleInit(): Promise<void> {
    this.logger.log('TMDB Service inicializado (API v3)');
  }
  
  /* ---------------------- Helpers ---------------------- */
  public convertMediaContentType(type: ContentType): DelegateMedias {
    switch (type) {
      case 'movie':
        return this.prismaService.movie as DelegateMedias;
      case 'tv':
        return this.prismaService.series as DelegateMedias;
    }
  }
  
  public convertGenreContentType(type: ContentType): DelegateGenres {
    switch (type) {
      case 'movie':
        return this.prismaService.movieGenre as DelegateGenres;
      case 'tv':
        return this.prismaService.seriesGenre as DelegateGenres;
    }
  }
  
  /* ---------------------- TMDB API ---------------------- */
  public async listGenres(type: ContentType): Promise<{ genres: Genre[] }> {
    const cacheKey = `genres:${type}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    const { data } = await this.api.get<{ genres: Genre[] }>(
      `genre/${type}/list`,
      {
        params: {
          language: 'pt-BR',
        },
      },
    );
    
    this.cache.set(cacheKey, data);
    return data;
  }
  
  public async searchMedia(
    type: ContentType,
    query: string,
    page: number = 1,
    language: string = 'pt-BR',
  ): Promise<(SearchMovie & SearchTv)[]> {
    const cacheKey = `search:${type}:${query}:${page}:${language}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    const { data } = await this.api.get<Search<SearchMovie & SearchTv>>(
      `search/${type}`,
      {
        params: {
          query,
          page,
          language,
          include_adult: true,
        },
      },
    );
    
    const formatted = this.formatSearch(data);
    this.cache.set(cacheKey, formatted);
    return formatted;
  }
  
  public async getTrending(
    type: ContentType,
    trending: TrendingType,
    page: number = 1,
  ): Promise<(SearchMovie & SearchTv)[]> {
    const cacheKey = `trending:${type}:${trending}:${page}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    const params: Record<string, string | number | boolean> = {
      page,
      language: 'pt-BR',
      include_adult: false,
    };
    
    switch (trending) {
      case TrendingType.POPULAR:
        params.sort_by = 'popularity.desc';
        break;
      case TrendingType.TOP_RATED:
        params.sort_by = 'vote_average.desc';
        params['vote_count.gte'] = 200;
        break;
      case TrendingType.THEATHER:
        params.sort_by = 'popularity.desc';
        params.with_release_type = '2|3';
        break;
    }
    
    const { data } = await this.api.get<Search<SearchMovie & SearchTv>>(
      `discover/${type}`,
      { params },
    );
    
    const formatted = this.formatSearch(data);
    this.cache.set(cacheKey, formatted);
    return formatted;
  }
  
  /* ---------------------- IMDB ID Search ---------------------- */
  public async searchImdbId(title: string, type: 'movie' | 'tv'): Promise<string | null> {
    const cacheKey = `imdb:${type}:${title}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    try {
      // Busca o conteúdo no TMDB
      const { data } = await this.api.get<Search<SearchMovie & SearchTv>>(
        `search/${type}`,
        {
          params: {
            query: title,
            language: 'pt-BR',
            include_adult: true,
          },
        },
      );
      
      const results = data.results;
    
      if (results && results.length > 0) {
        const firstResult = results[0];
      
        // Busca os IDs externos (incluindo IMDB)
        const { data: externalIds } = await this.api.get(
          `${type}/${firstResult.id}/external_ids`
        );
        
        const imdbId = externalIds.imdb_id || null;
        this.cache.set(cacheKey, imdbId);
        return imdbId;
      }
      
      this.cache.set(cacheKey, null);
      return null;
    } catch (error: any) {
      this.logger.debug(`Erro ao buscar IMDB ID para "${title}": ${error.message}`);
      this.cache.set(cacheKey, null);
      return null;
    }
  }
  
  /* ---------------------- Formatter ---------------------- */
  private formatSearch(
    data: Search<SearchMovie & SearchTv>,
  ): (SearchMovie & SearchTv)[] {
    return data.results.map((item) => {
      // CORREÇÃO: Forçar qualidade 'original' para o background (backdrop)
      item.backdrop_path = item.backdrop_path
        ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
        : null;

      // O poster usa a constante IMAGE_URL configurada (geralmente w500 ou w780)
      item.poster_path = item.poster_path
        ? `${IMAGE_URL}${item.poster_path}`
        : null;
        
      item.popularity = Number((item.popularity ?? 0).toFixed(1));
      item.vote_average = Number((item.vote_average ?? 0).toFixed(1));
      item.genre_ids = item.genre_ids ?? [];
      return item;
    });
  }
  
  /* ---------------------- EPISODE DATA ---------------------- */
  /**
   * Busca detalhes de uma temporada específica (incluindo imagens dos episódios).
   * Útil para resolver o problema de "thumbnail ausente" no Stremio.
   */
  public async getSeasonDetails(
    tmdbId: number,
    seasonNumber: number,
  ): Promise<TmdbSeasonResponse | null> {
    const cacheKey = `season:${tmdbId}:${seasonNumber}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    try {
      const { data } = await this.api.get<TmdbSeasonResponse>(
        `tv/${tmdbId}/season/${seasonNumber}`,
        {
          params: {
            language: 'pt-BR',
          },
        },
      );
      
      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      // Se der 404 (temporada não encontrada no TMDB), loga debug e retorna null
      if (error.response?.status === 404) {
        this.logger.debug(`Temporada S${seasonNumber} não encontrada no TMDB para ID ${tmdbId}`);
        this.cache.set(cacheKey, null);
        return null;
      }
      this.logger.error(`Erro ao buscar temporada: ${error.message}`);
      this.cache.set(cacheKey, null);
      return null;
    }
  }
  
  /**
   * Busca imagens de um episódio específico (para fallback quando still_path é null).
   * Retorna a lista de stills (imagens landscape).
   */
  public async getEpisodeImages(
    seriesId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<{ stills: { file_path: string }[] } | null> {
    const cacheKey = `episode_images:${seriesId}:${seasonNumber}:${episodeNumber}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }
    
    try {
      const { data } = await this.api.get<{ stills: { file_path: string }[] }>(
        `tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}/images`,
      );
      
      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.debug(`Imagens do episódio S${seasonNumber}E${episodeNumber} não encontradas no TMDB para ID ${seriesId}`);
        this.cache.set(cacheKey, null);
        return null;
      }
      this.logger.error(`Erro ao buscar imagens do episódio: ${error.message}`);
      this.cache.set(cacheKey, null);
      return null;
    }
  }
  
  /**
   * Helper para pegar a URL completa da imagem (thumbnail) de um episódio.
   * CORREÇÃO: Padrão alterado para 'original' para garantir alta qualidade.
   */
  public getEpisodeStillUrl(
    stillPath: string | null | undefined,
    size: string = 'original', // Padrão agora é qualidade máxima
  ): string | null {
    if (!stillPath) return null;
    return `https://image.tmdb.org/t/p/${size}${stillPath}`;
  }
  
  /**
   * Helper para pegar a URL completa do backdrop (imagem landscape de fundo).
   * CORREÇÃO: Agora utiliza o parâmetro 'size' na montagem da URL.
   */
  public getBackdropUrl(
    backdropPath: string | null | undefined,
    size: string = 'original',
  ): string | null {
    if (!backdropPath) return null;
    // Monta a URL dinamicamente.
    return `https://image.tmdb.org/t/p/${size}${backdropPath}`;
  }

  /* ---------------------- CLASSIFICAÇÃO INDICATIVA ---------------------- */
  /**
   * Busca a classificação indicativa de um filme (ex: "PG-13", "R", "12", "14")
   * para um país específico (padrão: BR para Brasil).
   */
  public async getMovieCertification(
    movieId: number,
    countryCode: string = 'BR',
  ): Promise<string | null> {
    const cacheKey = `movie_cert:${movieId}:${countryCode}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`movie/${movieId}/release_dates`);
      
      // Procura pelo país específico
      const countryData = data.results?.find(
        (r: any) => r.iso_3166_1 === countryCode
      );

      if (countryData?.release_dates) {
        // Pega a primeira certificação disponível
        const cert = countryData.release_dates.find(
          (rd: any) => rd.certification && rd.certification.trim() !== ''
        );
        
        if (cert?.certification) {
          this.cache.set(cacheKey, cert.certification);
          return cert.certification;
        }
      }

      // Fallback: busca certificação dos EUA se não encontrar do país
      if (countryCode !== 'US') {
        const usCert = await this.getMovieCertification(movieId, 'US');
        this.cache.set(cacheKey, usCert);
        return usCert;
      }

      this.cache.set(cacheKey, null);
      return null;
    } catch (error: any) {
      this.logger.debug(`Erro ao buscar certificação do filme ${movieId}: ${error.message}`);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Busca a classificação indicativa de uma série (ex: "TV-14", "TV-MA")
   * para um país específico (padrão: BR para Brasil).
   */
  public async getTvCertification(
    tvId: number,
    countryCode: string = 'BR',
  ): Promise<string | null> {
    const cacheKey = `tv_cert:${tvId}:${countryCode}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`tv/${tvId}/content_ratings`);
      
      // Procura pelo país específico
      const rating = data.results?.find(
        (r: any) => r.iso_3166_1 === countryCode
      );

      if (rating?.rating) {
        this.cache.set(cacheKey, rating.rating);
        return rating.rating;
      }

      // Fallback: busca certificação dos EUA se não encontrar do país
      if (countryCode !== 'US') {
        const usRating = await this.getTvCertification(tvId, 'US');
        this.cache.set(cacheKey, usRating);
        return usRating;
      }

      this.cache.set(cacheKey, null);
      return null;
    } catch (error: any) {
      this.logger.debug(`Erro ao buscar certificação da série ${tvId}: ${error.message}`);
      this.cache.set(cacheKey, null);
      return null;
    }
  }
  /* ---------------------- DETALHES COMPLETOS ---------------------- */
  
  /**
   * Busca detalhes completos de um filme (incluindo gêneros, runtime, etc)
   */
  public async getMovieDetails(movieId: number): Promise<any> {
    const cacheKey = `movie_details:${movieId}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`movie/${movieId}`, {
        params: {
          language: 'pt-BR',
          append_to_response: 'videos,credits',
        },
      });

      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar detalhes do filme ${movieId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca detalhes completos de uma série (incluindo gêneros, runtime, etc)
   */
  public async getSeriesDetails(seriesId: number): Promise<any> {
    const cacheKey = `series_details:${seriesId}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`tv/${seriesId}`, {
        params: {
          language: 'pt-BR',
          append_to_response: 'videos,credits',
        },
      });

      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar detalhes da série ${seriesId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca créditos (elenco e equipe) de um filme
   */
  public async getMovieCredits(movieId: number): Promise<any> {
    const cacheKey = `movie_credits:${movieId}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`movie/${movieId}/credits`, {
        params: {
          language: 'pt-BR',
        },
      });

      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar créditos do filme ${movieId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca créditos (elenco e equipe) de uma série
   */
  public async getSeriesCredits(seriesId: number): Promise<any> {
    const cacheKey = `series_credits:${seriesId}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`tv/${seriesId}/credits`, {
        params: {
          language: 'pt-BR',
        },
      });

      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar créditos da série ${seriesId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca vídeos (trailers, teasers) de um filme
   */
  public async getMovieVideos(movieId: number): Promise<any> {
    const cacheKey = `movie_videos:${movieId}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`movie/${movieId}/videos`, {
        params: {
          language: 'pt-BR',
        },
      });

      // Se não tiver vídeos em PT-BR, busca em inglês
      if (!data.results || data.results.length === 0) {
        const { data: enData } = await this.api.get(`movie/${movieId}/videos`, {
          params: {
            language: 'en-US',
          },
        });
        this.cache.set(cacheKey, enData);
        return enData;
      }

      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar vídeos do filme ${movieId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca vídeos (trailers, teasers) de uma série
   */
  public async getSeriesVideos(seriesId: number): Promise<any> {
    const cacheKey = `series_videos:${seriesId}`;
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return this.cache.get(cacheKey);
    }

    try {
      const { data } = await this.api.get(`tv/${seriesId}/videos`, {
        params: {
          language: 'pt-BR',
        },
      });

      // Se não tiver vídeos em PT-BR, busca em inglês
      if (!data.results || data.results.length === 0) {
        const { data: enData } = await this.api.get(`tv/${seriesId}/videos`, {
          params: {
            language: 'en-US',
          },
        });
        this.cache.set(cacheKey, enData);
        return enData;
      }

      this.cache.set(cacheKey, data);
      return data;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar vídeos da série ${seriesId}: ${error.message}`);
      return null;
    }
  }
}
