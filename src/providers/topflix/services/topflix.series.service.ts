import { Injectable, Logger } from "@nestjs/common"
import { BrowserPoolService } from "./browser-pool.service"

interface Episode {
  season: number
  number: number
  name: string
  slug: string
}

@Injectable()
export class TopflixSeriesService {
  private readonly logger = new Logger(TopflixSeriesService.name)
  private readonly BASE_URL = "https://topflix.digital"
  private selectorCache: string | null = null

  constructor(private readonly browserPool: BrowserPoolService) {}

  async getSeriesEpisodes(slug: string, seasonNumber = 1): Promise<Episode[]> {
    const cleanSlug = slug.replace(/---\d+$/, "")
    const url = `${this.BASE_URL}/series/assistir-online-${cleanSlug}/`

    this.logger.log(`Buscando S${seasonNumber} de ${cleanSlug}`)

    let page
    try {
      page = await this.browserPool.getPage()

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 })

      const possibleSelectors = [
        ".epi-link",
        ".episodio",
        ".episode",
        'a[href*="episodio"]',
        '[class*="episode"]',
        '[class*="episodio"]',
        ".item-episodio",
        ".video-item",
      ]

      // Reorganiza seletores: coloca o do cache no início
      if (this.selectorCache) {
        const cacheIndex = possibleSelectors.indexOf(this.selectorCache)
        if (cacheIndex > 0) {
          possibleSelectors.splice(cacheIndex, 1)
          possibleSelectors.unshift(this.selectorCache)
        }
      }

      let foundSelector = null
      for (const selector of possibleSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 800 })
          foundSelector = selector
          if (!this.selectorCache) {
            this.selectorCache = selector
          }
          break
        } catch (e) {
          continue
        }
      }

      if (!foundSelector) {
        this.logger.error(`Seletores não encontrados: ${url}`)
        throw new Error("Seletores de episódios não encontrados")
      }

      // Seleciona a temporada específica (se necessário)
      if (seasonNumber > 1) {
        try {
          await page.waitForSelector(".season-dropdown", { timeout: 5000 })
          await page.click(".season-dropdown")
          await page.waitForSelector(`.season-option[data-season="${seasonNumber}"]`, { timeout: 3000 })
          await page.click(`.season-option[data-season="${seasonNumber}"]`)
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 })
        } catch (err) {
          this.logger.warn(`Temporada ${seasonNumber} não selecionável`)
        }
      }

      // Extrai episódios usando o seletor que funcionou
      const episodes: Episode[] = await page.evaluate(
        (season, selector) => {
          const episodeElements = document.querySelectorAll(selector)
          const eps: { season: number; number: number; name: string; slug: string }[] = []

          episodeElements.forEach((el, index) => {
            const fullText = el.textContent?.replace(/\s+/g, " ").trim() || ""

            if (!fullText) {
              eps.push({
                season: season,
                number: index + 1,
                name: `Episódio ${index + 1}`,
                slug: "",
              })
              return
            }

            // ===== EXTRAÇÃO DO NÚMERO DO EPISÓDIO =====
            let episodeNum = index + 1

            const numberPatterns = [
              /Epis[óo]dio\s+(\d+)/i,
              /Ep\.?\s*(\d+)/i,
              /S\d+\s*E(\d+)/i,
              /(\d+)x(\d+)/i,
              /^\s*(\d+)\s*[-.]/,
            ]

            for (const pattern of numberPatterns) {
              const match = fullText.match(pattern)
              if (match) {
                if (pattern.source.includes("x")) {
                  episodeNum = Number.parseInt(match[2], 10)
                } else {
                  episodeNum = Number.parseInt(match[1], 10)
                }
                if (!isNaN(episodeNum)) break
              }
            }

            // ===== EXTRAÇÃO DO TÍTULO =====
            let name = fullText
              .replace(/^\d+\.\s*/, "")
              .replace(/^Epis[óo]dio\s+\d+\s*[-:]\s*/i, "")
              .replace(/^Ep\.?\s*\d+\s*[-:]\s*/i, "")
              .replace(/^S\d+\s*E\d+\s*[-:]\s*/i, "")
              .replace(/^\d+x\d+\s*[-:]\s*/i, "")
              .replace(/\s*\d+\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+\d{4}$/i, "")
              .trim()

            if (!name || name.length < 2) {
              name = `Episódio ${episodeNum}`
            }

            eps.push({
              season: season,
              number: episodeNum,
              name: name,
              slug: "",
            })
          })

          return eps
        },
        seasonNumber,
        foundSelector,
      )

      if (episodes.length === 0) {
        this.logger.warn(`S${seasonNumber} sem episódios`)
        return []
      }

      episodes.sort((a, b) => a.number - b.number)

      this.logger.log(`✓ ${episodes.length} episódios S${seasonNumber}`)

      return episodes
    } catch (err: any) {
      this.logger.error(`Erro S${seasonNumber} ${slug}: ${err.message}`)
      return []
    } finally {
      if (page) {
        await this.browserPool.releasePage(page).catch((e) => {
          this.logger.error(`Erro ao liberar página: ${e.message}`)
        })
      }
    }
  }
}

