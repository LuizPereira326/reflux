import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import * as http from 'http';
import * as https from 'https';
import { TOPFLIX_DOMAIN } from '../../providers/topflix/constants/url';
import { TmdbService } from '@/modules/tmdb/tmdb.service';
import { RedeCanaisService } from '@/modules/rede-canais/rede-canais.service';

export interface MultiSourceItem extends TopflixRawItem {
  sources: ('topflix' | 'redecanaishd')[];
  episodesCount?: number;
}

export interface TopflixRawItem {
  title: string;
  slug: string;
  poster: string;
  type: 'movie' | 'series';
  link: string;
  genres?: string[];
  imdbId?: string;
}

export interface Episode {
  season: number;
  episode: number;
  title: string;
  slug: string;
  source: 'topflix' | 'redecanaishd';
}

type ContentType = 'movie' | 'series';

@Injectable()
export class TopflixGetterService implements OnModuleInit {
  private readonly logger = new Logger(TopflixGetterService.name);
  private readonly axios: AxiosInstance;

  // ✅ TOPFLIX CACHES (existentes)
  private moviesCache = new Map<string, TopflixRawItem>();
  private seriesCache = new Map<string, TopflixRawItem>();
  
  // ✅ REDE CANAIS CACHES (separados)
  private redeCanaisSeriesCache = new Map<string, TopflixRawItem>();
  private redeCanaisMoviesCache = new Map<string, TopflixRawItem>();

  private moviesPage = 1;
  private seriesPage = 1;

  private httpAgent = new http.Agent({ keepAlive: true });
  private httpsAgent = new https.Agent({ keepAlive: true });

  // Controle de pausa inteligente
  private isCrawlerPaused = false;
  private lastSuccessfulFetch = Date.now();
  private readonly PAUSE_DURATION = 60 * 60 * 1000; // 1 hora
  private readonly MAX_TIME_WITHOUT_SUCCESS = 5 * 60 * 1000; // 5 minutos

  private userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ];

  private currentUserAgentIndex = 0;

  constructor(
    private readonly tmdb: TmdbService,
    private readonly redeCanais: RedeCanaisService
  ) {
    this.axios = axios.create({
      timeout: 30000,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    });
  }

  async onModuleInit() {
    this.logger.log('🔄 Iniciando carregamento MULTI-SOURCE (Topflix + Rede Canais)...');
    
    await this.sleep(2000);
    
    // ✅ Carrega Topflix (principal) + Rede Canais (séries + filmes)
    await Promise.all([
      this.fetchMovies(5), 
      this.fetchSeries(5),
      this.fetchRedeCanaisSeries(10),
      this.fetchRedeCanaisMovies(10)
    ]);
    
    this.logger.log(
      `✅ Cache inicializado: ` +
      `${this.moviesCache.size} filmes Topflix | ` +
      `${this.seriesCache.size} séries Topflix | ` +
      `${this.redeCanaisSeriesCache.size} séries Rede Canais | ` +
      `${this.redeCanaisMoviesCache.size} filmes Rede Canais`
    );

    await this.sleep(5000);
    this.startBackgroundCrawler();
  }

  /* ================= CATÁLOGO MULTI-SOURCE ================= */

  async fetchMovies(pages = 10) {
    await this.loadPages('movie', this.moviesPage, pages);
    return [...this.moviesCache.values()];
  }

  async fetchSeries(pages = 10) {
    await this.loadPages('series', this.seriesPage, pages);
    return [...this.seriesCache.values()];
  }

  // ✅ Busca popular Séries Rede Canais (mantive a intenção original)
  async fetchRedeCanaisSeries(limit = 20) {
    try {
      this.logger.log('📺 Buscando séries no Rede Canais...');
      const series = await this.redeCanais.getPopularSeries();
      series.slice(0, limit).forEach(item => {
        const slug = item.slug;
        if (!this.redeCanaisSeriesCache.has(slug)) {
          this.redeCanaisSeriesCache.set(slug, {
            title: item.title,
            slug,
            poster: item.poster || '',
            type: 'series' as const,
            link: item.url || item.poster || '',
            genres: item.genres
          });
        }
      });
      this.logger.debug(`✅ ${series.length} séries Rede Canais no cache`);
    } catch (e) {
      this.logger.warn('⚠️ Falha ao carregar séries do Rede Canais');
    }
  }

  // ✅ NOVO: Busca popular Filmes Rede Canais
  async fetchRedeCanaisMovies(limit = 20) {
    try {
      this.logger.log('🎬 Buscando filmes no Rede Canais...');
      const movies = await this.redeCanais.getPopularMovies();
      movies.slice(0, limit).forEach(item => {
        const slug = item.slug;
        if (!this.redeCanaisMoviesCache.has(slug)) {
          this.redeCanaisMoviesCache.set(slug, {
            title: item.title,
            slug,
            poster: item.poster || '',
            type: 'movie' as const,
            link: item.url || item.poster || '',
            genres: item.genres
          });
        }
      });
      this.logger.debug(`✅ ${movies.length} filmes Rede Canais no cache`);
    } catch (e) {
      this.logger.warn('⚠️ Falha ao carregar filmes do Rede Canais');
    }
  }

  // ✅ MÉTODO UNIFICADO: Busca em TODAS as fontes
  async searchAllSources(query: string): Promise<MultiSourceItem[]> {
    const [topflixMovies, topflixSeries, redeSeries, redeMovies] = await Promise.all([
      this.searchTopflix(query, 'movie'),
      this.searchTopflix(query, 'series'),
      this.redeCanais.searchSeries(query),
      this.redeCanais.searchMovies(query)
    ]);

    const allResults: MultiSourceItem[] = [];

    // Topflix Movies
    topflixMovies.forEach(item => {
      allResults.push({
        ...item,
        sources: ['topflix']
      });
    });

    // Topflix Series
    topflixSeries.forEach(item => {
      allResults.push({
        ...item,
        sources: ['topflix']
      });
    });

    // Rede Canais (series)
    redeSeries.forEach(item => {
      const topflixMatch = this.findSeriesByTitle(item.title) || this.findMovieByTitle(item.title);
      const sources: ('topflix' | 'redecanaishd')[] = topflixMatch ? ['topflix', 'redecanaishd'] : ['redecanaishd'];
      allResults.push({
        title: item.title,
        slug: item.slug,
        poster: item.poster || '',
        type: 'series',
        link: item.url || item.poster || '',
        sources,
        genres: item.genres
      });
    });

    // Rede Canais (movies)
    redeMovies.forEach(item => {
      const topflixMatch = this.findMovieByTitle(item.title) || this.findSeriesByTitle(item.title);
      const sources: ('topflix' | 'redecanaishd')[] = topflixMatch ? ['topflix', 'redecanaishd'] : ['redecanaishd'];
      allResults.push({
        title: item.title,
        slug: item.slug,
        poster: item.poster || '',
        type: 'movie',
        link: item.url || item.poster || '',
        sources,
        genres: item.genres
      });
    });

    // Remove duplicatas por título (mantém fontes)
    const uniqueByTitle = new Map<string, MultiSourceItem>();
    allResults.forEach(item => {
      const key = item.title.toLowerCase();
      const existing = uniqueByTitle.get(key);
      
      if (!existing) {
        uniqueByTitle.set(key, item);
      } else {
        existing.sources = [...new Set([...existing.sources, ...item.sources])];
      }
    });

    return Array.from(uniqueByTitle.values()).slice(0, 50);
  }

  // ✅ BUSCA TOPFLIX MELHORADA (case-insensitive + fuzzy match)
  private searchTopflix(query: string, type: ContentType): TopflixRawItem[] {
    const cache = type === 'movie' ? this.moviesCache : this.seriesCache;
    const lowerQuery = query.toLowerCase().trim();
    
    return Array.from(cache.values()).filter(item => {
      const lowerTitle = item.title.toLowerCase();
      
      // Match exato
      if (lowerTitle.includes(lowerQuery)) return true;
      
      // Match fuzzy: remove acentos e caracteres especiais
      const normalizedQuery = this.normalize(lowerQuery);
      const normalizedTitle = this.normalize(lowerTitle);
      
      return normalizedTitle.includes(normalizedQuery);
    }).slice(0, 20);
  }

  // ✅ Normaliza strings para busca fuzzy
  private normalize(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^a-z0-9\s]/g, '') // Remove caracteres especiais
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ✅ Busca por título (helper)
  private findSeriesByTitle(title: string): TopflixRawItem | undefined {
    const normalized = this.normalize(title.toLowerCase());
    return Array.from(this.seriesCache.values()).find(item => 
      this.normalize(item.title.toLowerCase()) === normalized
    );
  }

  private findMovieByTitle(title: string): TopflixRawItem | undefined {
    const normalized = this.normalize(title.toLowerCase());
    return Array.from(this.moviesCache.values()).find(item => 
      this.normalize(item.title.toLowerCase()) === normalized
    );
  }

  /* ================= LOAD PAGES ================= */
  private async loadPages(type: ContentType, startPage: number, totalPagesToLoad: number) {
    const endPage = startPage + totalPagesToLoad;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 3;

    for (let i = startPage; i < endPage; i++) {
      const hasItems = await this.loadPage(type, i);
      
      if (!hasItems && i > 1) {
        consecutiveFailures++;
        this.logger.warn(`⚠️ Página ${i} (${type}) vazia ou bloqueada. Falhas consecutivas: ${consecutiveFailures}/${maxConsecutiveFailures}`);
        
        if (consecutiveFailures >= maxConsecutiveFailures) {
          this.logger.warn(`🛑 ${maxConsecutiveFailures} falhas consecutivas em ${type}. Parando na página ${i}.`);
          if (type === 'movie') this.moviesPage = i;
          if (type === 'series') this.seriesPage = i;
          return;
        }
        
        await this.sleep(5000 * consecutiveFailures);
        continue;
      }

      if (hasItems) {
        consecutiveFailures = 0;
        this.lastSuccessfulFetch = Date.now();
      }

      if (type === 'movie') this.moviesPage = i + 1;
      if (type === 'series') this.seriesPage = i + 1;

      await this.sleep(this.getRandomDelay(3000, 6000));
    }
  }

  /* ================= BACKGROUND CRAWLER ================= */
  private startBackgroundCrawler() {
    this.logger.log('🚀 Iniciando Crawler MULTI-SOURCE Infinito...');

    setInterval(async () => {
      if (this.shouldPause()) {
        if (!this.isCrawlerPaused) this.pauseCrawler();
        return;
      }

      if (this.isCrawlerPaused && this.shouldResume()) {
        this.resumeCrawler();
      }

      if (this.isCrawlerPaused) return;

      try {
        // ✅ Crawler Topflix + Rede Canais (séries + filmes)
        await Promise.all([
          this.fetchMovies(1),
          this.fetchSeries(1),
          this.fetchRedeCanaisSeries(5),
          this.fetchRedeCanaisMovies(5)
        ]);
      } catch (err: any) {
        this.logger.error(`Erro crawler: ${err.message}`);
      }
    }, 15000);
  }

  /* ================= LOAD PAGE ================= */
  private async loadPage(type: ContentType, page: number): Promise<boolean> {
    const path = type === 'movie' ? 'filmes' : 'series';
    const url = `${TOPFLIX_DOMAIN}/${path}/page/${page}/`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const html = await this.getHtml(url);
      
      if (!html) {
        if (attempt < 2) {
          this.logger.debug(`Tentativa ${attempt}/2 falhou para ${url}`);
          await this.sleep(this.getRandomDelay(5000, 8000));
          this.rotateUserAgent();
          continue;
        }
        return false;
      }

      if (this.isBlockedResponse(html)) {
        this.logger.warn(`🚫 Página ${page} (${type}) bloqueada`);
        if (attempt < 2) {
          await this.sleep(this.getRandomDelay(8000, 12000));
          this.rotateUserAgent();
          continue;
        }
        return false;
      }

      const $ = cheerio.load(html);
      let count = 0;

      $('.poster, article, .item').each((_, el) => {
        try {
          const a = $(el).find('a[href*="assistir-online-"]').first();
          const href = a.attr('href');
          if (!href) return;

          const slugMatch = href.match(/assistir-online-([^/]+)/);
          if (!slugMatch) return;

          let slug = slugMatch[1];
          slug = this.normalizeSlug(slug);

          let title = $(el).find('.poster__title').text().trim() ||
                     $(el).find('img').attr('alt') || '';
          
          title = title.replace(/\s+/g, ' ').trim();
          if (!title) return;

          const poster = $(el).find('img').attr('data-src') ||
                        $(el).find('img').attr('src') || '';

          const item: TopflixRawItem = {
            title, slug, poster: this.normalizeUrl(poster),
            type, link: this.normalizeUrl(href)
          };

          const cache = type === 'movie' ? this.moviesCache : this.seriesCache;
          if (!cache.has(slug)) {
            cache.set(slug, item);
            count++;
          }
        } catch (err) {
          this.logger.debug(`Erro item: ${err}`);
        }
      });

      if (count > 0) {
        this.logger.debug(`✓ Página ${page} (${type}): ${count} novos. Total: ${type === 'movie' ? this.moviesCache.size : this.seriesCache.size}`);
        return true;
      }

      if (html.length > 1000 && !this.isBlockedResponse(html)) {
        this.logger.debug(`Página ${page} (${type}) fim catálogo`);
        return false;
      }

      if (attempt < 2) await this.sleep(this.getRandomDelay(5000, 8000));
    }
    return false;
  }

  /* ================= GETTERS MULTI-SOURCE ================= */
  getAllMovies() { return [...this.moviesCache.values()]; }
  getAllSeries() { return [...this.seriesCache.values()]; }
  // Retorna ambos (se necessário)
  getAllRedeCanaisSeries() { return [...this.redeCanaisSeriesCache.values()]; }
  getAllRedeCanaisMovies() { return [...this.redeCanaisMoviesCache.values()]; }

  // ✅ Busca unificada por slug
  findItem(slug: string): MultiSourceItem | null {
    const topflixMovie = this.moviesCache.get(slug);
    const topflixSeries = this.seriesCache.get(slug);
    const redeSeries = this.redeCanaisSeriesCache.get(slug);
    const redeMovies = this.redeCanaisMoviesCache.get(slug);
    const redeSeriesAlt = this.redeCanaisSeriesCache.get(`rc-${slug}`);
    const redeMoviesAlt = this.redeCanaisMoviesCache.get(`rc-${slug}`);

    if (topflixMovie) {
      return { ...topflixMovie, sources: ['topflix'] };
    }
    if (topflixSeries) {
      return { ...topflixSeries, sources: ['topflix'] };
    }
    if (redeSeries) {
      return { ...redeSeries, sources: ['redecanaishd'] };
    }
    if (redeMovies) {
      return { ...redeMovies, sources: ['redecanaishd'] };
    }
    if (redeSeriesAlt) {
      return { ...redeSeriesAlt, sources: ['redecanaishd'] };
    }
    if (redeMoviesAlt) {
      return { ...redeMoviesAlt, sources: ['redecanaishd'] };
    }
    return null;
  }

  // ✅ Conta episódios multi-source
  async getEpisodeCount(slug: string, title?: string): Promise<number> {
    try {
      let total = 0;
      
      // Tenta Topflix (placeholder - implementar se tiver método)
      const topflixItem = this.findSeries(slug);
      if (topflixItem) {
        total += 12; // Placeholder - substituir por contagem real
      }
      
      // Tenta Rede Canais
      if (title) {
        const redeEpisodes = await this.redeCanais.searchEpisodes(title);
        total += redeEpisodes.length;
      }
      
      return total;
    } catch {
      return 0;
    }
  }

  /* ================= UTIL ================= */
  private shouldPause() {
    return Date.now() - this.lastSuccessfulFetch > this.MAX_TIME_WITHOUT_SUCCESS;
  }

  private shouldResume() { return true; }

  private pauseCrawler() {
    this.isCrawlerPaused = true;
    const nextResumeTime = new Date(Date.now() + this.PAUSE_DURATION);
    this.logger.warn(
      `⏸️ CRAWLER PAUSADO. Retomará: ${nextResumeTime.toLocaleTimeString('pt-BR')}`
    );
    setTimeout(() => this.resumeCrawler(), this.PAUSE_DURATION);
  }

  private resumeCrawler() {
    this.isCrawlerPaused = false;
    this.lastSuccessfulFetch = Date.now();
    this.logger.log('▶️ CRAWLER RETOMADO');
  }

  private isBlockedResponse(html: string): boolean {
    const lower = html.toLowerCase();
    const indicators = [
      'checking your browser', 'just a moment', 'enable javascript',
      'attention required', 'cloudflare ray id'
    ];
    if (indicators.some(i => lower.includes(i))) return true;
    if (lower.includes('cloudflare') && lower.includes('challenge')) return true;
    if (html.length < 500) return true;
    const expected = lower.includes('poster') || lower.includes('article') || lower.includes('assistir');
    return !expected;
  }

  private rotateUserAgent() {
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
  }

  private getRandomDelay(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private normalizeUrl(url: string) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    return `${TOPFLIX_DOMAIN}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private normalizeSlug(slug: string): string {
    return slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  }

  private async getHtml(url: string): Promise<string | null> {
    try {
      const { data, status } = await this.axios.get(url, {
        headers: {
          'User-Agent': this.userAgents[this.currentUserAgentIndex],
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Referer': `${TOPFLIX_DOMAIN}/`,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Cache-Control': 'no-cache',
        },
      });
      return status === 200 ? data : null;
    } catch (error: any) {
      this.logger.debug(`Falha ${url}: ${error.message}`);
      return null;
    }
  }

  private sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  findMovie(slug: string) { return this.moviesCache.get(slug); }
  findSeries(slug: string) { return this.seriesCache.get(slug); }

  getCrawlerStatus() {
    return {
      paused: this.isCrawlerPaused,
      lastSuccess: new Date(this.lastSuccessfulFetch),
      moviesCount: this.moviesCache.size,
      seriesCount: this.seriesCache.size,
      redeCanaisSeriesCount: this.redeCanaisSeriesCache.size,
      redeCanaisMoviesCount: this.redeCanaisMoviesCache.size,
      currentPage: { movies: this.moviesPage, series: this.seriesPage }
    };
  }
}

