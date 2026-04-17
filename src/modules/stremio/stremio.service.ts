import { Injectable, Logger } from "@nestjs/common"

import { TmdbService } from "@/modules/tmdb/tmdb.service"
import { ContentType } from "@/modules/tmdb/types/tmdb"

import { TvService } from "@/modules/tv/tv.service"
import { RedeCanaisService } from "@/modules/rede-canais/rede-canais.service"

interface TmdbCacheEntry {
  data: any
  timestamp: number
}

interface MetaCache {
  [key: string]: {
    meta: any
    timestamp: number
  }
}

@Injectable()
export class StremioService {
  private readonly logger = new Logger(StremioService.name)
  private readonly tmdbCache = new Map<string, TmdbCacheEntry>()
  private readonly metaCache: MetaCache = {}
  private readonly CACHE_TTL = 5 * 60 * 1000
  private readonly META_CACHE_TTL = 30 * 60 * 1000
  private readonly TMDB_TIMEOUT = 3000

  constructor(
    private readonly tmdbService: TmdbService,
    private readonly tvService: TvService,
    private readonly redeCanaisService: RedeCanaisService,
  ) {
    setInterval(() => this.cleanExpiredCache(), 10 * 60 * 1000)
  }

  /* ================= CACHE ================= */

  private cleanExpiredCache() {
    const now = Date.now()

    for (const [k, v] of this.tmdbCache.entries()) {
      if (now - v.timestamp > this.CACHE_TTL) {
        this.tmdbCache.delete(k)
      }
    }

    for (const [k, v] of Object.entries(this.metaCache)) {
      if (now - v.timestamp > this.META_CACHE_TTL) {
        delete this.metaCache[k]
      }
    }
  }

  private async fetchTmdbWithCache<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const cached = this.tmdbCache.get(key)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data as T
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("TMDB_TIMEOUT")), this.TMDB_TIMEOUT),
        ),
      ])

      if (result) {
        this.tmdbCache.set(key, { data: result, timestamp: Date.now() })
      }

      return result as T
    } catch {
      return null
    }
  }

  /* ================= CATALOG ================= */

  async getCatalog(type: string, id: string): Promise<any> {
    try {
      if (type === "channel") return { metas: [] }

      // Apenas Rede Canais permanece
      if (id === "redecanais.movies" || id === "redecanais") {
        const items = await this.redeCanaisService.getMovies()
        return { metas: await this.mapRedeCanaisItemsToMeta(items, "movie") }
      }

      if (id === "redecanais.series") {
        const items = await this.redeCanaisService.getSeries()
        return { metas: await this.mapRedeCanaisItemsToMeta(items, "series") }
      }

      return { metas: [] }
    } catch (error: any) {
      this.logger.error(`getCatalog error: ${error.message}`)
      return { metas: [] }
    }
  }

  private async mapRedeCanaisItemsToMeta(items: any[], type: string) {
    const results = await Promise.allSettled(
      items.map(async (item, i) => {
        let background = ""
        let description = ""

        if (i < 15) {
          const tmdbType = type === "movie" ? ContentType.MOVIE : ContentType.TV

          const search = await this.fetchTmdbWithCache(
            `search:${tmdbType}:${item.title}`,
            () => this.tmdbService.searchMedia(tmdbType, item.title, 1),
          )

          if (search?.[0]) {
            background = search[0].backdrop_path
              ? this.tmdbService.getBackdropUrl(search[0].backdrop_path)
              : ""
            description = search[0].overview || ""
          }
        }

        return {
          id: `redecanais:${type}:${item.slug}`,
          type,
          name: item.title,
          poster: this.fixPoster(item.poster),
          background: background || this.fixPoster(item.poster),
          description: description || "",
          posterShape: "regular",
        }
      }),
    )

    return results
      .filter(r => r.status === "fulfilled")
      .map((r: any) => r.value)
  }

/* ================= STREAM ================= */

  async getStream(type: string, id: string): Promise<{ streams: any[] }> {
    const parts = id.split(":")
    const provider = parts[0]
    const contentType = parts[1]
    const slug = parts[2]

    this.logger.debug(`getStream: provider=${provider}, type=${contentType}, slug=${slug}, fullId=${id}`)

    // 1. Tratamento para Filmes (Movies) - Apenas Rede Canais
    if (type === "movie" || contentType === "movie") {
      if (provider === "redecanais") {
        try {
          const streams = await this.redeCanaisService.getStreams(slug, "movie")
          return { streams }
        } catch (error: any) {
          this.logger.error(`RedeCanais movie error: ${error.message}`)
          return { streams: [] }
        }
      }
    }

    // 2. Tratamento para Séries - Apenas Rede Canais
    if (type === "series" || contentType === "series") {
      const seasonEpisode = parts[3] || id.split(":").pop()
      const match = seasonEpisode?.match(/s(\d+)e(\d+)/)

      this.logger.debug(`Parsing season/episode: input="${seasonEpisode}", match=${!!match}`)

      if (!match) {
        this.logger.warn(`Failed to parse season/episode from: ${id}`)
        return { streams: [] }
      }

      const s = Number(match[1]) // season
      const e = Number(match[2]) // episode

      this.logger.debug(`Extracted: season=${s}, episode=${e}`)

      if (provider === "redecanais") {
        try {
          const streams = await this.redeCanaisService.getStreams(slug, "series", s, e)
          return { streams }
        } catch (error: any) {
          this.logger.error(`RedeCanais series error: ${error.message}`)
          return { streams: [] }
        }
      }
    }

    return { streams: [] }
  }

  /* ================= META ================= */

  async getMeta(type: string, id: string) {
    try {
      const cached = this.metaCache[id]
      if (cached && Date.now() - cached.timestamp < this.META_CACHE_TTL) {
        return cached
      }

      const parts = id.split(":")
      const provider = parts[0]
      const contentType = parts[1]
      const slug = parts[2]

      let metaResult = null

      if (provider === "redecanais") {
        const titleGuess = slug
          .replace(/-/g, " ")
          .split(" ")
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")

        let background = ""
        let description = ""
        let poster = ""
        let logo = ""
        let year = ""
        let runtime = ""
        let imdbRating = ""
        let genres: string[] = []
        let cast: string[] = []
        let director = ""
        let trailerStreams: any[] = []
        let videosList: any[] = []

        const tmdbType = contentType === "movie" ? ContentType.MOVIE : ContentType.TV

        const search = await this.fetchTmdbWithCache(
          `search:${tmdbType}:${slug}`,
          () => this.tmdbService.searchMedia(tmdbType, titleGuess, 1),
        )

        if (search?.[0]) {
          const tmdbData = search[0]
          const tmdbId = tmdbData.id

          const details = await this.fetchTmdbWithCache(
            `details:${tmdbType}:${tmdbId}`,
            async () => {
              if (tmdbType === ContentType.MOVIE) {
                return await this.tmdbService.getMovieDetails(tmdbId)
              } else {
                return await this.tmdbService.getSeriesDetails(tmdbId)
              }
            }
          )

          if (details) {
            background = details.backdrop_path
              ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
              : ""
            poster = details.poster_path
              ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
              : ""

            description = details.overview || ""

            if (tmdbType === ContentType.MOVIE) {
              year = details.release_date?.split("-")[0] || ""
              runtime = details.runtime ? `${details.runtime} min` : ""
            } else {
              const startYear = details.first_air_date?.split("-")[0] || ""
              const endYear = details.in_production ? "" : details.last_air_date?.split("-")[0]
              year = endYear && endYear !== startYear ? `${startYear}-${endYear}` : startYear
              runtime = details.episode_run_time?.[0] ? `${details.episode_run_time[0]} min` : ""
            }

            imdbRating = details.vote_average ? details.vote_average.toFixed(1) : ""
            genres = details.genres?.map((g: any) => g.name) || []

            const credits = await this.fetchTmdbWithCache(
              `credits:${tmdbType}:${tmdbId}`,
              async () => {
                if (tmdbType === ContentType.MOVIE) {
                  return await this.tmdbService.getMovieCredits(tmdbId)
                } else {
                  return await this.tmdbService.getSeriesCredits(tmdbId)
                }
              }
            )

            if (credits) {
              cast = credits.cast?.slice(0, 5).map((c: any) => c.name) || []
              if (tmdbType === ContentType.MOVIE) {
                const dir = credits.crew?.find((c: any) => c.job === "Director")
                director = dir?.name || ""
              } else {
                director = details.created_by?.[0]?.name || ""
              }
            }

            const videos = await this.fetchTmdbWithCache(
              `videos:${tmdbType}:${tmdbId}`,
              async () => {
                if (tmdbType === ContentType.MOVIE) {
                  return await this.tmdbService.getMovieVideos(tmdbId)
                } else {
                  return await this.tmdbService.getSeriesVideos(tmdbId)
                }
              }
            )

            if (videos?.results) {
              const trailer = videos.results.find((v: any) =>
                v.type === "Trailer" && v.site === "YouTube"
              )
              if (trailer) {
                trailerStreams = [{
                  title: "Trailer",
                  ytId: trailer.key
                }]
              }
            }

            if (contentType === "series") {
              const numberOfSeasons = details.number_of_seasons || 0
              for (let s = 1; s <= Math.min(numberOfSeasons, 10); s++) {
                const seasonData = await this.fetchTmdbWithCache(
                  `season:${tmdbId}:${s}`,
                  () => this.tmdbService.getSeasonDetails(tmdbId, s)
                )
                if (seasonData?.episodes) {
                  seasonData.episodes.forEach((ep: any) => {
                    videosList.push({
                      id: `${id}:s${s}e${ep.episode_number}`,
                      title: ep.name || `Episódio ${ep.episode_number}`,
                      season: s,
                      episode: ep.episode_number,
                      released: ep.air_date || undefined,
                      overview: ep.overview || undefined,
                      thumbnail: ep.still_path
                        ? `https://image.tmdb.org/t/p/w500${ep.still_path}`
                        : undefined
                    })
                  })
                }
              }
            }
          }
        }

        metaResult = {
          meta: {
            id,
            type: contentType,
            name: titleGuess,
            poster: poster || this.fixPoster(null),
            background: background || undefined,
            logo: logo || undefined,
            description: description || "Sem descrição disponível",
            releaseInfo: year || undefined,
            runtime: runtime || undefined,
            imdbRating: imdbRating || undefined,
            genres: genres.length > 0 ? genres : undefined,
            cast: cast.length > 0 ? cast : undefined,
            director: director || undefined,
            trailerStreams: trailerStreams.length > 0 ? trailerStreams : undefined,
            posterShape: "regular",
            videos: contentType === "series" && videosList.length > 0 ? videosList : undefined
          }
        }
      }

      if (metaResult?.meta) {
        this.metaCache[id] = {
          ...metaResult,
          timestamp: Date.now()
        }
        return metaResult
      }

      return { meta: null }
    } catch (error: any) {
      this.logger.error(`getMeta error: ${error.message}`)
      return { meta: null }
    }
  }

  async getStats() {
    return {
      addons: 1,
      catalogs: 1,
      streams: 1,
    }
  }

  /* ================= UTILS ================= */

  private fixPoster(url?: string | null): string {
    return url
      ? url.replace(/^http:\/\//i, "https://")
      : "https://via.placeholder.com/300x450/1a1a1a/ffffff?text=Sem+Poster"
  }
}
