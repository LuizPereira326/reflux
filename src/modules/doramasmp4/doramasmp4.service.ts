import { Injectable, Logger } from '@nestjs/common'
import { DoramasMP4ScraperService } from './services/scraper.service'
import { DoramasMP4ProcessorService } from './services/processor.service'
import { TmdbService } from '@/modules/tmdb/tmdb.service'

@Injectable()
export class DoramasMP4Service {
  private readonly logger = new Logger(DoramasMP4Service.name)

  constructor(
    private readonly scraperService: DoramasMP4ScraperService,
    private readonly processorService: DoramasMP4ProcessorService,
    private readonly tmdbService: TmdbService,
  ) {}

  async getStreams(
    imdbId: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
  ) {
    try {
      // Busca o slug usando o ID do IMDB
      const slug = await this.scraperService.searchByImdb(imdbId, type)
      if (!slug) return []

      // Reutiliza a lógica do getStreamsBySlug para evitar duplicação de código
      return this.getStreamsBySlug(slug, type, season, episode);

    } catch (error) {
      this.logger.error(`Error in getStreams: ${error}`)
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
      this.logger.debug(`Getting streams for slug: ${slug}, S${season}E${episode}`)

      // Ajuste da URL base para DoramasMP4 (Baseado no seu upload anterior)
      // Se for série e tiver episódio, monta a URL específica
      const episodeUrl =
        type === 'series' && episode
          ? `https://doramasmp4.io/doramas/${slug}-${episode}` // Ajuste se a estrutura do site for diferente
          : `https://doramasmp4.io/doramas/${slug}`

      this.logger.debug(`Constructed URL: ${episodeUrl}`)

      const result = await this.processorService.getPlayerUrl(episodeUrl)

      if (!result) {
        this.logger.warn(`No URL found for ${slug}`)
        return []
      }

      this.logger.debug(`Found stream result:`, JSON.stringify(result))

      // ✅ DETECTA se é { externalUrl } ou { url }
      if (result.externalUrl) {
        this.logger.debug(`✅ Returning externalUrl: ${result.externalUrl}`)
        return [{
          name: 'DoramasMP4',
          title: '🌐 Assistir no Navegador',
          externalUrl: result.externalUrl,
          behaviorHints: {
            notWebReady: true,
            bingeGroup: 'doramasmp4',
          },
        }]
      }

      if (result.url) {
        this.logger.debug(`✅ Returning direct URL: ${result.url}`)
        return [{
          name: 'DoramasMP4',
          title: '🎥 HD Direto',
          url: result.url,
          behaviorHints: {
            notWebReady: false,
            bingeGroup: 'doramasmp4',
          },
        }]
      }

      this.logger.warn(`Invalid result structure: ${JSON.stringify(result)}`)
      return []

    } catch (error: any) {
      this.logger.error(`Error getting streams for ${slug}: ${error.message}`)
      return []
    }
  }

  async getCatalogByGenre(genre: string) {
    try {
      const items = await this.scraperService.getCatalogByGenre(genre)
      return items.map(item => ({
        id: `doramasmp4:series:${item.slug}`, // Prefixo corrigido
        type: 'series',
        name: item.title,
        poster: item.poster,
        posterShape: 'regular',
      }))
    } catch (error: any) {
      this.logger.error(`Error in getCatalogByGenre: ${error.message}`)
      return []
    }
  }

  async getAllCatalog() {
    try {
      const items = await this.scraperService.getAllCatalog()
      return items.map(item => ({
        id: `doramasmp4:series:${item.slug}`, // Prefixo corrigido
        type: 'series',
        name: item.title,
        poster: item.poster,
        posterShape: 'regular',
      }))
    } catch (error: any) {
      this.logger.error(`Error in getAllCatalog: ${error.message}`)
      return []
    }
  }

  async getDoramaDetails(slug: string) {
    try {
      const details = await this.scraperService.getDoramaDetails(slug)
      if (!details) return null

      return {
        title: details.title,
        poster: details.poster,
        totalEpisodes: details.totalEpisodes,
        seasons: details.seasons || 1,
      }
    } catch (error: any) {
      this.logger.error(`Error getting dorama details: ${error.message}`)
      return null
    }
  }

  async getEnrichedCatalog() {
    try {
      const items = await this.scraperService.getAllCatalog()

      const enriched = await Promise.allSettled(
        items.slice(0, 20).map(async item => {
          try {
            // Tenta buscar metadados no TMDB para melhorar a exibição
            const search = await this.tmdbService.searchMedia('tv' as any, item.title, 1)
            if (search?.[0]) {
              return {
                id: `doramasmp4:series:${item.slug}`, // Prefixo corrigido
                type: 'series',
                name: item.title,
                poster: item.poster,
                posterShape: 'regular',
                description: search[0].overview || undefined,
                releaseInfo: search[0].first_air_date?.substring(0, 4) || undefined,
              }
            }
          } catch {
            // Ignore errors e usa o básico
          }

          return {
            id: `doramasmp4:series:${item.slug}`,
            type: 'series',
            name: item.title,
            poster: item.poster,
            posterShape: 'regular',
          }
        })
      )

      const enrichedResults = enriched
        .filter(r => r.status === 'fulfilled')
        .map((r: any) => r.value)

      // Adiciona o restante dos itens sem enriquecimento (para não estourar limite da API do TMDB)
      const remaining = items.slice(20).map(item => ({
        id: `doramasmp4:series:${item.slug}`,
        type: 'series',
        name: item.title,
        poster: item.poster,
        posterShape: 'regular',
      }))

      return [...enrichedResults, ...remaining]
    } catch (error: any) {
      this.logger.error(`Error in getEnrichedCatalog: ${error.message}`)
      return []
    }
  }
}
