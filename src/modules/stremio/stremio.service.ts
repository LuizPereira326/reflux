import { Injectable, Logger } from "@nestjs/common"

import { TopflixService } from "@/providers/topflix/topflix.service"
import { TopflixGetterService, MultiSourceItem } from "@/providers/topflix/services/getter.service"
import { TopflixProcessorService } from "@/providers/topflix/services/topflix.processor.service"
import { TopflixSeriesService } from "@/providers/topflix/services/topflix.series.service"

import { TmdbService } from "@/modules/tmdb/tmdb.service"
import { ContentType } from "@/modules/tmdb/types/tmdb"

import { TvService } from "@/modules/tv/tv.service"
import { RedeCanaisService } from "@/modules/rede-canais/rede-canais.service"
import { DoramoreService } from "@/modules/doramore/doramore.service"

import { hasCJK, translateEpisodeAsync } from "@/utils/episode-translator"
import { getCachedTranslation } from "@/cache/translation.cache"
import { DoramasMP4Service } from "@/modules/doramasmp4/doramasmp4.service"

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
    private readonly doramasmp4Service: DoramasMP4Service, // <-- NOVO
    private readonly topflixService: TopflixService,
    private readonly topflixGetterService: TopflixGetterService,
    private readonly topflixProcessorService: TopflixProcessorService,
    private readonly topflixSeriesService: TopflixSeriesService,
    private readonly tmdbService: TmdbService,
    private readonly tvService: TvService,
    private readonly redeCanaisService: RedeCanaisService,
    private readonly doramoreService: DoramoreService,
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

      if (id === "reflux.movies" || id === "topflix" || id === "topflix.movies") {
        const items = await this.topflixGetterService.fetchMovies(1)
        return { metas: await this.mapItemsToMeta(items, "movie") }
      }

      if (id === "reflux.series" || id === "topflix.series" || (id === "topflix" && type === "series")) {
        const items = await this.topflixGetterService.fetchSeries(1)
        return { metas: await this.mapItemsToMeta(items, "series") }
      }

      if (id === "doramore.all" || id === "doramore.series") {
        const items = await this.doramoreService.getAllCatalog()
        return { metas: items }
      }

      if (id.startsWith("doramore.genre.")) {
        const genre = id.replace("doramore.genre.", "")
        const items = await this.doramoreService.getCatalogByGenre(genre)
        return { metas: items }
      }

      return { metas: [] }
    } catch (error: any) {
      this.logger.error(`getCatalog error: ${error.message}`)
      return { metas: [] }
    }
  }

  async getDoramoreCatalogByGenre(genre: string) {
    try {
      const items = await this.doramoreService.getCatalogByGenre(genre)
      return { metas: items }
    } catch (error: any) {
      this.logger.error(`getDoramoreCatalogByGenre error: ${error.message}`)
      return { metas: [] }
    }
  }

  private async mapItemsToMeta(items: MultiSourceItem[], type: string) {
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
          id: `topflix:${type}:${item.slug}`,
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

    // 1. Tratamento para Filmes (Movies)
    if (type === "movie" || contentType === "movie") {
      
      // >>> CORREÇÃO: Lógica do DoramasMP4 para Filmes <<<
      if (provider === "doramasmp4") {
        try {
          // Nota: assumindo que getStreamsBySlug retorna um array de streams
          const streams = await this.doramasmp4Service.getStreamsBySlug(slug, "movie"); 
          return { streams };
        } catch (error: any) {
          this.logger.error(`DoramasMP4 movie error: ${error.message}`);
          return { streams: [] };
        }
      }

      if (provider === "topflix") {
        const streams = await this.topflixService.getStreams(slug, "movie").catch(() => [])
        return { streams }
      }

      if (provider === "doramore") {
        try {
          const rawStreams = await this.doramoreService.getStreamsBySlug(slug, "movie")
          return { streams: this.mapDoramoreStreams(rawStreams) }
        } catch (error: any) {
          this.logger.error(`DoraMore movie error: ${error.message}`)
          return { streams: [] }
        }
      }
    }

    // 2. Tratamento para Séries/Doramas
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

      // >>> CORREÇÃO: Lógica do DoramasMP4 para Séries (agora temos s e e) <<<
      if (provider === "doramasmp4") {
        try {
          // Passamos s e e agora que eles foram definidos acima
          const streams = await this.doramasmp4Service.getStreamsBySlug(slug, "series", s, e);
          return { streams };
        } catch (error: any) {
           this.logger.error(`DoramasMP4 series error: ${error.message}`);
           return { streams: [] };
        }
      }

      if (provider === "topflix") {
        try {
          const url = await this.topflixProcessorService.getPlayerUrl(slug, "series", s, e)
          if (url) return { streams: [{ name: "Topflix", title: "HD", url }] }
        } catch (error: any) {
          this.logger.error(`Topflix stream error: ${error.message}`)
        }
      }

      if (provider === "doramore") {
        try {
          this.logger.debug(`Calling doramoreService.getStreamsBySlug(${slug}, series, ${s}, ${e})`)
          const rawStreams = await this.doramoreService.getStreamsBySlug(slug, "series", s, e)
          return { streams: this.mapDoramoreStreams(rawStreams) }
        } catch (error: any) {
          this.logger.error(`DoraMore series error: ${error.message}`)
          return { streams: [] }
        }
      }
    }

    return { streams: [] }
  }

  /**
   * ✅ CORREÇÃO: Converte retorno do DoraMore para formato Stremio
   * Resolve loop infinito detectando externalUrl vs url
   */
  private mapDoramoreStreams(rawStreams: any[]): any[] {
    if (!rawStreams || rawStreams.length === 0) {
      this.logger.debug(`DoraMore returned 0 streams`)
      return []
    }

    this.logger.debug(`DoraMore returned ${rawStreams.length} streams`)

    return rawStreams
      .map(stream => {
        // CASO 1: externalUrl direto (já vem certo do service)
        if (stream.externalUrl) {
          this.logger.debug(`✅ External URL detected: ${stream.externalUrl}`)
          return {
            name: stream.name || "DoraMore",
            title: "🌐 Assistir no Navegador",
            externalUrl: stream.externalUrl
          }
        }
        
        // CASO 2: url como string (vídeo direto)
        if (stream.url && typeof stream.url === 'string') {
          this.logger.debug(`✅ Direct URL string: ${stream.url}`)
          return {
            name: stream.name || "DoraMore",
            title: stream.title || "HD",
            url: stream.url,
            behaviorHints: {
              notWebReady: false
            }
          }
        }

        // FALLBACK: stream inválido
        this.logger.warn(`❌ Stream inválido: ${JSON.stringify(stream)}`)
        return null
      })
      .filter(Boolean)
  }
  /* ================= META / STATS ================= */

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

      if (provider === "topflix") {
        const tmdbType = contentType === "movie" ? ContentType.MOVIE : ContentType.TV
        
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
            
            // Busca o logo oficial (PNG transparente)
            const images = await this.fetchTmdbWithCache(
              `images:${tmdbType}:${tmdbId}`,
              async () => {
                try {
                  // @ts-ignore - Acessa API privada do TmdbService
                  const { data } = await this.tmdbService['api'].get(
                    `${tmdbType === ContentType.MOVIE ? 'movie' : 'tv'}/${tmdbId}/images`
                  )
                  return data
                } catch {
                  return null
                }
              }
            )

            if (images?.logos?.length > 0) {
              // Prioriza logos em português, depois inglês
              const ptLogo = images.logos.find((l: any) => l.iso_639_1 === 'pt')
              const enLogo = images.logos.find((l: any) => l.iso_639_1 === 'en')
              const anyLogo = images.logos[0]
              
              const selectedLogo = ptLogo || enLogo || anyLogo
              if (selectedLogo?.file_path) {
                logo = `https://image.tmdb.org/t/p/original${selectedLogo.file_path}`
              }
            }
            
            if (tmdbType === ContentType.MOVIE) {
              year = details.release_date?.split("-")[0] || ""
              runtime = details.runtime ? `${details.runtime} min` : ""
            } else {
              const startYear = details.first_air_date?.split("-")[0] || ""
              const endYear = details.in_production ? "" : details.last_air_date?.split("-")[0]
              year = endYear && endYear !== startYear ? `${startYear}-${endYear}` : startYear
              
              // Runtime: tenta pegar do episode_run_time ou usa média de 45 min
              const episodeRuntime = details.episode_run_time?.[0]
              runtime = episodeRuntime ? `${episodeRuntime} min` : ""
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

      if (provider === "doramore") {
        const titleGuess = slug
          .replace(/-/g, " ")
          .split(" ")
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")

        // Busca informações do catálogo
        const catalogItem = await this.doramoreService.getAllCatalog()
          .then(items => items.find(item => item.id === id))

        // Busca detalhes completos do scraper
        let totalEpisodes = 16
        let doramaTitle = catalogItem?.name || titleGuess
        let doramaPoster = catalogItem?.poster || this.fixPoster(null)

        try {
          const details = await this.doramoreService.getDoramaDetails(slug)
          if (details) {
            totalEpisodes = details.totalEpisodes
            doramaTitle = details.title || doramaTitle
            doramaPoster = details.poster || doramaPoster
          }
        } catch (error: any) {
          this.logger.debug(`Using fallback episodes count: ${error.message}`)
        }

        // Busca metadados do TMDB
        let background = ""
        let description = "Assista online"
        let year = ""
        let runtime = ""
        let imdbRating = ""
        let genres: string[] = []
        let cast: string[] = []
        let director = ""
        let logo = ""

        try {
          const search = await this.fetchTmdbWithCache(
            `search:tv:${slug}`,
            () => this.tmdbService.searchMedia(ContentType.TV, doramaTitle, 1),
          )

          if (search?.[0]) {
            const tmdbData = search[0]
            const tmdbId = tmdbData.id

            // Busca detalhes completos
            const tmdbDetails = await this.fetchTmdbWithCache(
              `details:tv:${tmdbId}`,
              () => this.tmdbService.getSeriesDetails(tmdbId)
            )

            if (tmdbDetails) {
              background = tmdbDetails.backdrop_path
                ? `https://image.tmdb.org/t/p/original${tmdbDetails.backdrop_path}`
                : ""
              
              const posterFromTmdb = tmdbDetails.poster_path
                ? `https://image.tmdb.org/t/p/w500${tmdbDetails.poster_path}`
                : ""
              
              if (posterFromTmdb) {
                doramaPoster = posterFromTmdb
              }

              description = tmdbDetails.overview || description

              const startYear = tmdbDetails.first_air_date?.split("-")[0] || ""
              const endYear = tmdbDetails.in_production ? "" : tmdbDetails.last_air_date?.split("-")[0]
              year = endYear && endYear !== startYear ? `${startYear}-${endYear}` : startYear

              runtime = tmdbDetails.episode_run_time?.[0] ? `${tmdbDetails.episode_run_time[0]} min` : ""

              imdbRating = tmdbDetails.vote_average ? tmdbDetails.vote_average.toFixed(1) : ""

              genres = tmdbDetails.genres?.map((g: any) => g.name) || []

              // Busca créditos
              const credits = await this.fetchTmdbWithCache(
                `credits:tv:${tmdbId}`,
                () => this.tmdbService.getSeriesCredits(tmdbId)
              )

              if (credits) {
                cast = credits.cast?.slice(0, 5).map((c: any) => c.name) || []
                director = tmdbDetails.created_by?.[0]?.name || ""
              }

              // Busca logo
              const images = await this.fetchTmdbWithCache(
                `images:tv:${tmdbId}`,
                async () => {
                  try {
                    // @ts-ignore
                    const { data } = await this.tmdbService['api'].get(`tv/${tmdbId}/images`)
                    return data
                  } catch {
                    return null
                  }
                }
              )

              if (images?.logos?.length > 0) {
                const ptLogo = images.logos.find((l: any) => l.iso_639_1 === 'pt')
                const enLogo = images.logos.find((l: any) => l.iso_639_1 === 'en')
                const anyLogo = images.logos[0]
                
                const selectedLogo = ptLogo || enLogo || anyLogo
                if (selectedLogo?.file_path) {
                  logo = `https://image.tmdb.org/t/p/original${selectedLogo.file_path}`
                }
              }
            }
          }
        } catch (error: any) {
          this.logger.debug(`TMDB lookup failed for DoraMore: ${error.message}`)
        }

        // Gera lista de episódios com nomes do TMDB (se disponível)
        const videosList: any[] = []
        
        // Busca detalhes da temporada 1 do TMDB para pegar nomes dos episódios
        let tmdbEpisodes: any[] = []
        try {
          const search = await this.fetchTmdbWithCache(
            `search:tv:${slug}`,
            () => this.tmdbService.searchMedia(ContentType.TV, doramaTitle, 1),
          )

          if (search?.[0]) {
            // Busca temporada em português primeiro, depois inglês
            let seasonData = await this.fetchTmdbWithCache(
              `season:${search[0].id}:1:pt`,
              async () => {
                try {
                  // @ts-ignore
                  const { data } = await this.tmdbService['api'].get(
                    `tv/${search[0].id}/season/1`,
                    { params: { language: 'pt-BR' } }
                  )
                  return data
                } catch {
                  return null
                }
              }
            )

            // Se não tiver em PT, busca em inglês
            if (!seasonData?.episodes || seasonData.episodes.length === 0) {
              seasonData = await this.fetchTmdbWithCache(
                `season:${search[0].id}:1:en`,
                () => this.tmdbService.getSeasonDetails(search[0].id, 1)
              )
            }

            if (seasonData?.episodes) {
              tmdbEpisodes = seasonData.episodes
              this.logger.debug(`Found ${tmdbEpisodes.length} episode names from TMDB`)
            }
          }
        } catch (error: any) {
          this.logger.debug(`Could not fetch episode names: ${error.message}`)
        }
        
        for (let e = 1; e <= totalEpisodes; e++) {
          const tmdbEp = tmdbEpisodes.find(ep => ep.episode_number === e)
          
          // Usa nome do TMDB (qualquer idioma) ou fallback
          let episodeName = `Episódio ${e}`

          if (tmdbEp?.name) {
            const cached = getCachedTranslation(tmdbEp.name)

            if (cached) {
              episodeName = cached
              this.logger.debug(`Episode ${e}: Using cached translation: ${episodeName}`)
            } else if (hasCJK(tmdbEp.name)) {
              // dispara tradução em background
              translateEpisodeAsync(tmdbEp.name)
              episodeName = tmdbEp.name // Usa o nome original enquanto traduz
              this.logger.debug(`Episode ${e}: Translating CJK: ${tmdbEp.name}`)
            } else {
              // inglês / espanhol / pt
              episodeName = tmdbEp.name
              this.logger.debug(`Episode ${e}: Using TMDB name: ${episodeName}`)
            }
          } else {
            this.logger.debug(`Episode ${e}: No TMDB data, using fallback`)
          }
          
          videosList.push({
            id: `${id}:s1e${e}`,
            title: episodeName,
            season: 1,
            episode: e,
            released: tmdbEp?.air_date || undefined,
            overview: tmdbEp?.overview || undefined,
            thumbnail: tmdbEp?.still_path 
              ? `https://image.tmdb.org/t/p/w500${tmdbEp.still_path}`
              : doramaPoster
          })
        }

        metaResult = {
          meta: {
            id,
            type: contentType,
            name: doramaTitle,
            poster: doramaPoster,
            background: background || doramaPoster,
            logo: logo || undefined,
            description: description,
            releaseInfo: year || undefined,
            runtime: runtime || undefined,
            imdbRating: imdbRating || undefined,
            genres: genres.length > 0 ? genres : undefined,
            cast: cast.length > 0 ? cast : undefined,
            director: director || undefined,
            posterShape: "regular",
            videos: videosList
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
