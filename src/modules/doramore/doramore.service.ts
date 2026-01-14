import { Injectable, Logger } from '@nestjs/common'
import { DoramoreScraperService } from './services/scraper.service'
import { DoramoreProcessorService } from './services/processor.service'
import { TmdbService } from '@/modules/tmdb/tmdb.service'

@Injectable()
export class DoramoreService {
  private readonly logger = new Logger(DoramoreService.name)
  private readonly baseUrl = 'https://doramasonline.org/br'
  private readonly apiBase = process.env.BASE_URL!

  constructor(
    private readonly scraperService: DoramoreScraperService,
    private readonly processorService: DoramoreProcessorService,
    private readonly tmdbService: TmdbService,
  ) {}

  // =========================
  // 🎬 STREAMS
  // =========================

  async getStreams(
    imdbId: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
  ) {
    try {
      const slug = await this.scraperService.searchByImdb(imdbId, type)
      if (!slug) return []

      return this.getStreamsBySlug(slug, type, season, episode)
    } catch (e: any) {
      this.logger.error(e?.message)
      return []
    }
  }

  async getStreamsBySlug(
    slug: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
  ) {
    try {
      const [_, name] = slug.split('/')

      const episodeUrl =
        type === 'movie'
          ? `${this.baseUrl}/${slug}/`
          : `${this.baseUrl}/episodio/${name}-temporada-${season || 1}-episodio-${episode}/`

      const result = await this.processorService.getPlayerUrl(episodeUrl)
      if (!result) return []

      // 🌐 externo
      if (result.externalUrl) {
        return [{
          name: 'DoraMore',
          title: '🌐 Assistir no Navegador',
          externalUrl: result.externalUrl,
          behaviorHints: {
            notWebReady: true,
            bingeGroup: 'doramore',
          },
        }]
      }

      // 🎬 SEMPRE VIA PROXY
      if (result.url) {
        const proxyUrl =
          `${this.apiBase}/proxy/stream?url=${encodeURIComponent(result.url)}`

        return [{
          name: 'DoraMore',
          title: '🎭 Dublado HD',
          url: proxyUrl,
          behaviorHints: {
            notWebReady: false,
            bingeGroup: 'doramore',
          },
        }]
      }

      return []
    } catch (e: any) {
      this.logger.error(e?.message)
      return []
    }
  }

  // =========================
  // 📚 CATÁLOGO
  // =========================

  async getCatalogByGenre(genre: string) {
    try {
      const items = await this.scraperService.getCatalogByGenre(genre)

      return items.map(item => {
        const [category] = item.slug.split('/')
        const type = category === 'filmes' ? 'movie' : 'series'

        return {
          id: `doramore:${type}:${item.slug}`,
          type,
          name: item.title,
          poster: item.poster,
          posterShape: 'regular',
        }
      })
    } catch (e: any) {
      this.logger.error(e?.message)
      return []
    }
  }

  async getAllCatalog() {
    try {
      const items = await this.scraperService.getAllCatalog()

      return items.map(item => {
        const [category] = item.slug.split('/')
        const type = category === 'filmes' ? 'movie' : 'series'

        return {
          id: `doramore:${type}:${item.slug}`,
          type,
          name: item.title,
          poster: item.poster,
          posterShape: 'regular',
        }
      })
    } catch (e: any) {
      this.logger.error(e?.message)
      return []
    }
  }

  // =========================
  // 📖 DETALHES
  // =========================

  async getDoramaDetails(slug: string) {
    try {
      const details = await this.scraperService.getDoramaDetails(slug)
      if (!details) return null

      const [category] = slug.split('/')
      const isMovie = category === 'filmes'

      return {
        title: details.title,
        poster: details.poster,
        totalEpisodes: isMovie ? 1 : details.totalEpisodes || 16,
        seasons: isMovie ? undefined : details.seasons || 1,
      }
    } catch (e: any) {
      this.logger.error(e?.message)
      return null
    }
  }

  // =========================
  // ✨ ENRIQUECIDO (TMDB)
  // =========================

  async getEnrichedCatalog() {
    try {
      const items = await this.scraperService.getAllCatalog()

      const enriched = await Promise.allSettled(
        items.slice(0, 20).map(async item => {
          const [category] = item.slug.split('/')
          const tmdbType = category === 'filmes' ? 'movie' : 'tv'

          try {
            const search = await this.tmdbService.searchMedia(
              tmdbType as any,
              item.title,
              1,
            )

            if (search?.[0]) {
              return {
                id: `doramore:${tmdbType}:${item.slug}`,
                type: tmdbType,
                name: item.title,
                poster: item.poster,
                posterShape: 'regular',
                description: search[0].overview,
                releaseInfo:
                  (tmdbType === 'movie'
                    ? search[0].release_date
                    : search[0].first_air_date
                  )?.substring(0, 4),
              }
            }
          } catch {}

          const type = category === 'filmes' ? 'movie' : 'series'

          return {
            id: `doramore:${type}:${item.slug}`,
            type,
            name: item.title,
            poster: item.poster,
            posterShape: 'regular',
          }
        })
      )

      return enriched
        .filter(r => r.status === 'fulfilled')
        .map((r: any) => r.value)
    } catch (e: any) {
      this.logger.error(e?.message)
      return []
    }
  }
}

