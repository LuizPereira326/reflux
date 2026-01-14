import { Injectable, Logger, type OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import axios, { type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import * as http from "http";
import * as https from "https";
import { TOPFLIX_DOMAIN } from "@/providers/topflix/constants/url";
import { RedeCanaisService } from "@/modules/rede-canais/rede-canais.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { LRUCache } from 'lru-cache';

export interface TopflixRawItem {
  title: string;
  slug: string;
  poster: string;
  type: "movie" | "series";
  link: string;
  genres?: string[];
  imdbId?: string;
}

export interface MultiSourceItem extends TopflixRawItem {
  sources: ("topflix" | "redecanaishd")[];
  popularity?: number;
  addedAt?: Date;
  publishedAt?: Date;
  hitCount?: number;
  streamVerified?: boolean;
  lastHit?: Date;
}

export type ContentType = "movie" | "series";

class OptimizedLimitPromise {
  private queue: Array<() => void> = [];
  private activeCount = 0;
  private readonly maxQueueSize: number;
  
  constructor(private limit: number, maxQueueSize = 100) {
    this.maxQueueSize = maxQueueSize;
  }
  
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Rejeita se fila muito cheia
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("Queue limit exceeded");
    }
    
    while (this.activeCount >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
  
  getStats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxQueue: this.maxQueueSize,
    };
  }
}

@Injectable()
export class TopflixGetterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TopflixGetterService.name);
  private readonly axios: AxiosInstance;

  // 🔥 LRU Cache otimizado para produção
  private readonly topflixMoviesCache = new LRUCache<string, MultiSourceItem>({
    max: 5000,
    ttl: 1000 * 60 * 60 * 24, // 24 horas
    updateAgeOnGet: true,
    allowStale: false,
  });

  private readonly topflixSeriesCache = new LRUCache<string, MultiSourceItem>({
    max: 5000,
    ttl: 1000 * 60 * 60 * 24,
    updateAgeOnGet: true,
    allowStale: false,
  });

  private readonly rcMoviesCache = new LRUCache<string, MultiSourceItem>({
    max: 2000,
    ttl: 1000 * 60 * 60 * 12, // 12 horas
    updateAgeOnGet: true,
    allowStale: false,
  });

  private readonly rcSeriesCache = new LRUCache<string, MultiSourceItem>({
    max: 2000,
    ttl: 1000 * 60 * 60 * 12,
    updateAgeOnGet: true,
    allowStale: false,
  });

  // 🔥 Cache de normalização
private readonly normalizedCache = new LRUCache<string, string>({
  max: 10000,
  ttl: 1000 * 60 * 60 * 6,
});


  
  private moviesPage = 1;
  private seriesPage = 1;
  private isProcessing = false;
  private isInitialized = false;
  
  // 🔥 Agents otimizados para alta concorrência
  private readonly httpAgent = new http.Agent({ 
    keepAlive: true, 
    maxSockets: 100,
    maxFreeSockets: 50,
    timeout: 30000,
    keepAliveMsecs: 1000,
  });
  
  private readonly httpsAgent = new https.Agent({ 
    keepAlive: true, 
    maxSockets: 100,
    maxFreeSockets: 50,
    timeout: 30000,
    keepAliveMsecs: 1000,
    rejectUnauthorized: false, // Importante para alguns sites
  });
  
  // 🔥 Limiters hierárquicos para controle fino
  private readonly pageLoaderLimiter = new OptimizedLimitPromise(3); // 3 páginas simultâneas
  private readonly requestLimiter = new OptimizedLimitPromise(10); // 10 requests HTTP simultâneos
  private readonly redeCanaisLimiter = new OptimizedLimitPromise(2); // 2 requests RedeCanais simultâneos
  
  private readonly userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  ];
  
  // 🔥 Configurações otimizadas para produção
  private readonly FAST_INTERVAL_MS = Number(process.env.FAST_INTERVAL_MS) || 10 * 60 * 1000; // 10 minutos
  private readonly FULL_INTERVAL_MS = Number(process.env.FULL_INTERVAL_MS) || 2 * 60 * 60 * 1000; // 2 horas
  private readonly BATCH_SIZE = Number(process.env.BATCH_SIZE) || 15;
  private readonly PUBLISH_WINDOW_MS = Number(process.env.PUBLISH_WINDOW_MS) || 15 * 60 * 1000; // 15 minutos
  private readonly INITIAL_PAGES = Number(process.env.INITIAL_PAGES) || 10; // Reduzido para inicialização rápida
  private readonly MAX_PAGES_PER_BATCH = 5;
  private readonly REQUEST_TIMEOUT = 5000; // 5 segundos
  private readonly REDE_CANAIS_TIMEOUT = 10000; // 10 segundos para RedeCanais
  
  private fastScheduler?: NodeJS.Timeout;
  private fullScheduler?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;

  constructor(
    private readonly redeCanais: RedeCanaisService, 
    private readonly eventEmitter: EventEmitter2
  ) {
    // 🔥 Axios otimizado para produção
    this.axios = axios.create({ 
      timeout: this.REQUEST_TIMEOUT,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      maxRedirects: 3,
      maxContentLength: 50 * 1024 * 1024, // 50MB
      validateStatus: (status) => status < 500,
    });
    
    // 🔥 Interceptor para rate limiting automático
    this.axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 429 || error.code === 'ECONNRESET') {
          await this.sleep(2000);
          throw error; // Deixa o caller decidir se tenta novamente
        }
        throw error;
      }
    );
  }

  async onModuleInit() {
    this.logger.log('🚀 Initializing Production-Optimized TopflixGetterService...');
    
    // 🔥 Inicialização assíncrona não-bloqueante
    setTimeout(async () => {
      try {
        await this.initializeService();
      } catch (error) {
        this.logger.error(`Initialization failed: ${error.message}`);
      }
    }, 0);
    
    this.startSchedulers();
    this.startStatsLogger();
  }

  private async initializeService() {
    if (this.isInitialized) return;
    
    this.isInitialized = true;
    const startTime = Date.now();
    
    try {
      // 🔥 Carrega apenas páginas essenciais inicialmente
      await Promise.allSettled([
        this.pageLoaderLimiter.run(() => this.loadPages("movie", 1, Math.min(5, this.INITIAL_PAGES))),
        this.pageLoaderLimiter.run(() => this.loadPages("series", 1, Math.min(5, this.INITIAL_PAGES))),
      ]);
      
      const stats = this.getCacheStats();
      const duration = Date.now() - startTime;
      this.logger.log(`📊 Initial cache loaded in ${duration}ms: ${JSON.stringify(stats)}`);
      
      // 🔥 Carrega RedeCanais em background com prioridade baixa
      setTimeout(() => {
        this.loadRedeCanaisBackground().catch(err => 
          this.logger.warn(`Background RedeCanais load failed: ${err.message}`)
        );
      }, 5000);
      
    } catch (error) {
      this.logger.error(`Initialization error: ${error.message}`);
    }
  }

  private async loadRedeCanaisBackground() {
    try {
      await Promise.allSettled([
        this.redeCanaisLimiter.run(() => this.fetchRedeCanaisTrendingMovies()),
        this.redeCanaisLimiter.run(() => this.fetchRedeCanaisPopularMovies(30)),
        this.redeCanaisLimiter.run(() => this.fetchRedeCanaisPopularSeries(30)),
      ]);
      
      const stats = this.getCacheStats();
      this.logger.log(`📊 Cache updated with RedeCanais: ${JSON.stringify(stats)}`);
    } catch (error) {
      this.logger.warn(`RedeCanais background load failed: ${error.message}`);
    }
  }

  private startSchedulers() {
    // 🔥 Scheduler rápido para conteúdo trending
    this.fastScheduler = setInterval(() => {
      if (!this.isProcessing) {
        this.pushNewContentToCatalog("fast").catch((err) => 
          this.logger.error(`Fast catalog push failed: ${err.message}`)
        );
      }
    }, this.FAST_INTERVAL_MS);
    
    // 🔥 Scheduler completo para limpeza e atualização
    this.fullScheduler = setInterval(() => {
      if (!this.isProcessing) {
        this.pushNewContentToCatalog("full").catch((err) => 
          this.logger.error(`Full catalog push failed: ${err.message}`)
        );
      }
    }, this.FULL_INTERVAL_MS);
    
    this.logger.log(`⏰ Schedulers started (fast: ${this.FAST_INTERVAL_MS/60000}min, full: ${this.FULL_INTERVAL_MS/3600000}h)`);
  }

  private startStatsLogger() {
    this.statsTimer = setInterval(() => {
      const stats = this.getCacheStats();
      const limiterStats = {
        pageLoader: this.pageLoaderLimiter.getStats(),
        request: this.requestLimiter.getStats(),
        redeCanais: this.redeCanaisLimiter.getStats(),
      };
      
      this.logger.debug(`📈 Stats: ${JSON.stringify(stats)} | Limiters: ${JSON.stringify(limiterStats)}`);
    }, 5 * 60 * 1000); // A cada 5 minutos
  }

  private async pushNewContentToCatalog(mode: "fast" | "full") {
    if (this.isProcessing) {
      this.logger.debug(`⏳ Skipping ${mode} push: already processing`);
      return;
    }
    
    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      this.logger.log(`🔄 Starting ${mode} catalog push`);
      
      if (mode === "fast") {
        // 🔥 Modo rápido: só conteúdo trending
        await Promise.allSettled([
          this.redeCanaisLimiter.run(() => this.fetchRedeCanaisTrendingMovies()),
          this.pageLoaderLimiter.run(() => this.loadPages("movie", this.moviesPage, 2)),
          this.pageLoaderLimiter.run(() => this.loadPages("series", this.seriesPage, 2)),
        ]);
      } else {
        // 🔥 Modo completo: atualização completa
        await Promise.allSettled([
          this.pageLoaderLimiter.run(() => this.loadPages("movie", this.moviesPage, this.MAX_PAGES_PER_BATCH)),
          this.pageLoaderLimiter.run(() => this.loadPages("series", this.seriesPage, this.MAX_PAGES_PER_BATCH)),
          this.redeCanaisLimiter.run(() => this.fetchRedeCanaisPopularMovies(50)),
          this.redeCanaisLimiter.run(() => this.fetchRedeCanaisPopularSeries(50)),
          this.redeCanaisLimiter.run(() => this.fetchRedeCanaisTrendingMovies()),
        ]);
        
        this.cleanOldCacheEntries();
      }
      
      // 🔥 Publica novos conteúdos
      const published = await this.publishNewContent(mode);
      
      const duration = Date.now() - startTime;
      this.logger.log(`✅ ${mode.toUpperCase()} push complete: ${published} published in ${duration}ms`);
      
    } catch (error: any) {
      this.logger.error(`❌ ${mode} catalog push error: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async publishNewContent(mode: "fast" | "full"): Promise<number> {
    const now = Date.now();
    const allItems = [
      ...this.topflixMoviesCache.values(),
      ...this.topflixSeriesCache.values(),
      ...this.rcMoviesCache.values(),
      ...this.rcSeriesCache.values(),
    ];
    
    // 🔥 Filtra candidatos para publicação
    const candidates = allItems
      .filter(item => {
        if (!this.isValidItem(item)) return false;
        if (item.publishedAt && now - item.publishedAt.getTime() < this.PUBLISH_WINDOW_MS) return false;
        
        if (mode === "fast") {
          const isRecent = item.addedAt && now - item.addedAt.getTime() < 2 * 60 * 60 * 1000;
          const isPopular = (item.popularity ?? 0) > 50 || (item.hitCount ?? 0) > 5;
          const isTrending = item.popularity && item.popularity > 90;
          return isRecent || isPopular || isTrending;
        }
        return true;
      })
      .sort((a, b) => this.calculateScore(b) - this.calculateScore(a));
    
    if (candidates.length === 0) {
      this.logger.debug(`ℹ️ No new content to publish in ${mode} mode`);
      return 0;
    }
    
    const limit = mode === "fast" ? Math.floor(this.BATCH_SIZE / 2) : this.BATCH_SIZE;
    const toPublish = candidates.slice(0, limit);
    
    let published = 0;
    for (let i = 0; i < toPublish.length; i += this.BATCH_SIZE) {
      const batch = toPublish.slice(i, i + this.BATCH_SIZE);
      
      try {
        await this.publishBatch(batch);
        published += batch.length;
        
        // 🔥 Atualiza timestamps
        batch.forEach((item) => {
          item.publishedAt = new Date();
          item.lastHit = new Date();
        });
        
        // 🔥 Rate limiting entre batches
        if (i + this.BATCH_SIZE < toPublish.length) {
          await this.sleep(300);
        }
        
      } catch (error: any) {
        this.logger.warn(`Batch publish failed: ${error.message}`);
        if (error.response?.status === 429) {
          await this.sleep(2000);
        }
      }
    }
    
    return published;
  }

  private calculateScore(item: MultiSourceItem): number {
    let score = 0;
    score += (item.popularity ?? 0) * 2;
    score += (item.hitCount ?? 0) * 1.5;
    score += item.addedAt ? 10 : 0;
    score += item.streamVerified ? 20 : 0;
    score += item.sources.length * 5;
    score += item.lastHit ? 5 : 0;
    
    // 🔥 Penaliza itens muito antigos
    if (item.addedAt) {
      const ageDays = (Date.now() - item.addedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 30) score -= ageDays * 2;
    }
    
    return Math.max(0, score);
  }

  private isValidItem(item: MultiSourceItem): boolean {
    return Boolean(
      item && 
      item.title && 
      item.title.length > 1 && 
      item.slug && 
      item.slug.length > 1 && 
      item.type
    );
  }

  private cleanOldCacheEntries() {
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 dias
    let removed = 0;
    
    const caches = [
      this.topflixMoviesCache,
      this.topflixSeriesCache, 
      this.rcMoviesCache,
      this.rcSeriesCache
    ];
    
    caches.forEach(cache => {
      for (const [key, item] of cache.entries()) {
        if (item.addedAt && now - item.addedAt.getTime() > maxAge) {
          cache.delete(key);
          removed++;
        }
      }
    });
    
    if (removed > 0) {
      this.logger.log(`🧹 Cleaned ${removed} old cache entries`);
    }
  }

  private async publishBatch(batch: MultiSourceItem[]) {
    const validItems = batch.filter(item => this.isValidItem(item));
    if (validItems.length === 0) return;
    
    // 🔥 Emite evento para atualização do catálogo
    this.eventEmitter.emit("catalog.update", {
      items: validItems.map(item => ({
        id: item.slug,
        type: item.type,
        name: item.title,
        poster: item.poster,
        genres: item.genres || [],
        sources: item.sources,
        streamVerified: item.streamVerified ?? false,
        popularity: item.popularity ?? 0,
      })),
      timestamp: new Date(),
      source: "topflix-getter",
    });
  }

  public async getCatalogBatch(type?: ContentType, limit = 50): Promise<MultiSourceItem[]> {
    const items = type 
      ? type === "movie" 
        ? [...this.topflixMoviesCache.values(), ...this.rcMoviesCache.values()]
        : [...this.topflixSeriesCache.values(), ...this.rcSeriesCache.values()]
      : [
          ...this.topflixMoviesCache.values(),
          ...this.topflixSeriesCache.values(),
          ...this.rcMoviesCache.values(),
          ...this.rcSeriesCache.values(),
        ];
    
    return items
      .filter(item => this.isValidItem(item))
      .sort((a, b) => this.calculateScore(b) - this.calculateScore(a))
      .slice(0, limit);
  }

  async fetchMovies(pages = 5): Promise<MultiSourceItem[]> {
    await this.loadPages("movie", this.moviesPage, Math.min(pages, this.MAX_PAGES_PER_BATCH));
    return [...this.topflixMoviesCache.values(), ...this.rcMoviesCache.values()];
  }

  async fetchSeries(pages = 5): Promise<MultiSourceItem[]> {
    await this.loadPages("series", this.seriesPage, Math.min(pages, this.MAX_PAGES_PER_BATCH));
    return [...this.topflixSeriesCache.values(), ...this.rcSeriesCache.values()];
  }

  async getSingle(type: ContentType, slug: string): Promise<MultiSourceItem | null> {
    const normalizedSlug = this.normalizeSlug(slug);
    
    // 🔥 Tenta cache primeiro
    const caches = type === "movie" 
      ? [this.topflixMoviesCache, this.rcMoviesCache] 
      : [this.topflixSeriesCache, this.rcSeriesCache];
    
    for (const cache of caches) {
      for (const item of cache.values()) {
        if (this.normalizeSlug(item.slug) === normalizedSlug) {
          item.hitCount = (item.hitCount ?? 0) + 1;
          item.lastHit = new Date();
          return item;
        }
      }
    }
    
    // 🔥 Busca nas fontes
    const [topflixResult, rcResult] = await Promise.allSettled([
      this.requestLimiter.run(() => this.fetchSingleFromTopflix(type, normalizedSlug)),
      this.redeCanaisLimiter.run(() => this.fetchSingleFromRedeCanais(type, normalizedSlug)),
    ]);
    
    let item: MultiSourceItem | null = null;
    
    if (topflixResult.status === "fulfilled" && topflixResult.value) {
      item = topflixResult.value;
      this.addToCache(item, type, "topflix");
      return item;
    }
    
    if (rcResult.status === "fulfilled" && rcResult.value) {
      item = rcResult.value;
      this.addToCache(item, type, "redecanais");
      return item;
    }
    
    return null;
  }

  async searchAllSources(query: string): Promise<MultiSourceItem[]> {
    if (!query || query.trim().length < 2) return [];
    
    const q = this.normalize(query);
    const merged = new Map<string, MultiSourceItem>();
    
    // 🔥 Busca no cache local
    const localItems = [
      ...this.topflixMoviesCache.values(),
      ...this.topflixSeriesCache.values(),
      ...this.rcMoviesCache.values(),
      ...this.rcSeriesCache.values(),
    ].filter(item => this.normalize(item.title).includes(q));
    
    localItems.forEach(item => {
      const key = `${item.type}:${this.normalize(item.title)}`;
      if (!merged.has(key)) {
        merged.set(key, { ...item });
      } else {
        const existing = merged.get(key)!;
        existing.sources = [...new Set([...existing.sources, ...item.sources])];
        existing.popularity = Math.max(existing.popularity ?? 0, item.popularity ?? 0);
      }
    });
    
    // 🔥 Busca no RedeCanais (com fallback)
    try {
      const [rcMovies, rcSeries] = await Promise.allSettled([
        this.withTimeout(this.redeCanais.searchMovies(query), this.REDE_CANAIS_TIMEOUT, []),
        this.withTimeout(this.redeCanais.searchSeries(query), this.REDE_CANAIS_TIMEOUT, []),
      ]);
      
      const rcItems = [
        ...(rcMovies.status === "fulfilled" ? rcMovies.value.map(i => this.mapRcToMulti(i, "movie")) : []),
        ...(rcSeries.status === "fulfilled" ? rcSeries.value.map(i => this.mapRcToMulti(i, "series")) : []),
      ];
      
      rcItems.forEach(item => {
        const key = `${item.type}:${this.normalize(item.title)}`;
        if (!merged.has(key)) {
          merged.set(key, item);
        } else {
          const existing = merged.get(key)!;
          existing.sources = [...new Set([...existing.sources, ...item.sources])];
          existing.popularity = Math.max(existing.popularity ?? 0, item.popularity ?? 0);
        }
      });
      
    } catch (error: any) {
      this.logger.debug(`Search error: ${error.message}`);
    }
    
    return Array.from(merged.values())
      .filter(item => this.isValidItem(item))
      .sort((a, b) => this.calculateScore(b) - this.calculateScore(a));
  }

  private async loadPages(type: ContentType, start: number, total: number): Promise<void> {
    const promises = [];
    for (let i = 0; i < Math.min(total, this.MAX_PAGES_PER_BATCH); i++) {
      const page = start + i;
      promises.push(() => this.loadPage(type, page));
    }
    
    const results = await Promise.allSettled(
      promises.map(p => this.pageLoaderLimiter.run(p))
    );
    
    let successCount = 0;
    results.forEach((result, index) => {
      const page = start + index;
      if (result.status === "fulfilled" && result.value) {
        if (type === "movie") {
          this.moviesPage = Math.max(this.moviesPage, page + 1);
        } else {
          this.seriesPage = Math.max(this.seriesPage, page + 1);
        }
        successCount++;
      }
    });
    
    if (successCount > 0) {
      this.logger.debug(`Batch ${type}: ${successCount}/${promises.length} pages loaded`);
    }
  }

  private async loadPage(type: ContentType, page: number): Promise<boolean> {
    return this.requestLimiter.run(async () => {
      const path = type === "movie" ? "filmes" : "series";
      const html = await this.getHtml(`${TOPFLIX_DOMAIN}/${path}/page/${page}/`);
      
      if (!html) return false;
      
      const $ = cheerio.load(html, { 
        xmlMode: false, 
        decodeEntities: false,
        lowerCaseTags: true,
      });
      
      let count = 0;
      $(".poster, article").each((_, el) => {
        const a = $(el).find('a[href*="assistir-online-"]').first();
        const href = a.attr("href");
        if (!href) return;
        
        const slugMatch = href.match(/assistir-online-([^/]+)/);
        if (!slugMatch) return;
        
        const slug = this.normalizeSlug(slugMatch[1]);
        const title = $(el).find(".poster__title").text().trim() || 
                     $(el).find("img").attr("alt")?.trim() || 
                     $(el).find("h2, h3").first().text().trim() || "";
        
        if (!title || title.length < 2) return;
        
        const poster = $(el).find("img").attr("data-src") || 
                      $(el).find("img").attr("src") || 
                      "";
        
        const item: MultiSourceItem = { 
          title, 
          slug, 
          poster: this.normalizeUrl(poster), 
          type, 
          link: this.normalizeUrl(href), 
          sources: ["topflix"], 
          addedAt: new Date(), 
          hitCount: 0, 
          popularity: 50,
          lastHit: new Date(),
        };
        
        if (this.isValidItem(item)) {
          this.addToCache(item, type, "topflix");
          count++;
        }
      });
      
      return count > 0;
    });
  }

  private async fetchSingleFromTopflix(type: ContentType, slug: string): Promise<MultiSourceItem | null> {
    return this.requestLimiter.run(async () => {
      const url = `${TOPFLIX_DOMAIN}/assistir-online-${slug}/`;
      const html = await this.getHtml(url);
      
      if (!html) return null;
      
      const $ = cheerio.load(html);
      const title = $('meta[property="og:title"]').attr("content")?.trim() || 
                   $("title").text().replace(/ - Topflix$/, "").trim();
      
      if (!title) return null;
      
      const poster = $('meta[property="og:image"]').attr("content") || 
                    $(".poster img").attr("data-src") || 
                    $(".poster img").attr("src") || 
                    "";
      
      return { 
        title, 
        slug, 
        poster: this.normalizeUrl(poster), 
        type, 
        link: url, 
        sources: ["topflix"], 
        addedAt: new Date(), 
        hitCount: 1, 
        popularity: 50,
        lastHit: new Date(),
      };
    });
  }

  private async fetchSingleFromRedeCanais(type: ContentType, slug: string): Promise<MultiSourceItem | null> {
    return this.redeCanaisLimiter.run(async () => {
      const approxTitle = slug.replace(/-/g, " ");
      
      try {
        const rcResults = await this.withTimeout(
          type === "movie" 
            ? this.redeCanais.searchMovies(approxTitle)
            : this.redeCanais.searchSeries(approxTitle),
          this.REDE_CANAIS_TIMEOUT,
          []
        );
        
        const rcMatch = rcResults.find(r => 
          this.normalizeSlug(r.slug || r.title) === slug
        );
        
        if (rcMatch) {
          return this.mapRcToMulti(rcMatch, type);
        }
      } catch (error: any) {
        this.logger.debug(`RedeCanais search failed for ${slug}: ${error.message}`);
      }
      
      return null;
    });
  }

  private async fetchRedeCanaisPopularMovies(limit = 20): Promise<void> {
    try {
      const movies = await this.withTimeout(
        this.redeCanais.getPopularMovies(),
        this.REDE_CANAIS_TIMEOUT,
        []
      );
      
      movies.slice(0, limit).forEach(m => {
        const item: MultiSourceItem = { 
          title: m.title, 
          slug: this.normalizeSlug(m.slug || m.title), 
          poster: m.poster ?? "", 
          type: "movie", 
          link: m.url ?? "", 
          genres: m.genres, 
          sources: ["redecanaishd"], 
          addedAt: new Date(), 
          hitCount: 0, 
          popularity: 75,
          lastHit: new Date(),
        };
        
        if (this.isValidItem(item)) {
          this.addToCache(item, "movie", "redecanais");
        }
      });
      
      this.logger.debug(`📥 Fetched ${Math.min(movies.length, limit)} popular movies from RedeCanais`);
    } catch (error: any) {
      this.logger.warn(`Failed to fetch RedeCanais popular movies: ${error.message}`);
    }
  }

  private async fetchRedeCanaisPopularSeries(limit = 20): Promise<void> {
    try {
      const series = await this.withTimeout(
        this.redeCanais.getPopularSeries(),
        this.REDE_CANAIS_TIMEOUT,
        []
      );
      
      series.slice(0, limit).forEach(s => {
        const item: MultiSourceItem = { 
          title: s.title, 
          slug: this.normalizeSlug(s.slug || s.title), 
          poster: s.poster ?? "", 
          type: "series", 
          link: s.url ?? "", 
          genres: s.genres, 
          sources: ["redecanaishd"], 
          addedAt: new Date(), 
          hitCount: 0, 
          popularity: 75,
          lastHit: new Date(),
        };
        
        if (this.isValidItem(item)) {
          this.addToCache(item, "series", "redecanais");
        }
      });
      
      this.logger.debug(`📥 Fetched ${Math.min(series.length, limit)} popular series from RedeCanais`);
    } catch (error: any) {
      this.logger.warn(`Failed to fetch RedeCanais popular series: ${error.message}`);
    }
  }

  private async fetchRedeCanaisTrendingMovies(): Promise<void> {
    return this.redeCanaisLimiter.run(async () => {
      try {
        const html = await this.withTimeout(
          this.getHtml("https://redecanaishd.bond"),
          this.REDE_CANAIS_TIMEOUT,
          null
        );
        
        if (!html) {
          this.logger.debug("Failed to fetch RedeCanais trending movies: timeout");
          return;
        }
        
        const $ = cheerio.load(html);
        const processed = new Set<string>();
        let trendingCount = 0;
        
        const selectors = [
          '.poster a[href*="assistir-"]', 
          '.movie-card a[href*="assistir-"]', 
          'h3 a[href*="assistir-"], h4 a[href*="assistir-"]'
        ];
        
        for (const selector of selectors) {
          $(selector).each((_, el) => {
            const $el = $(el);
            const href = $el.attr("href");
            if (!href) return;
            
            if (href.includes("/episodio/") || 
                href.includes("/pagina/") || 
                href.includes("/genero/") || 
                href.includes("/categoria/")) {
              return;
            }
            
            if (href.includes(TOPFLIX_DOMAIN)) return;
            
            const slugMatch = href.match(/assistir-([^/]+)/);
            if (!slugMatch) return;
            
            const slug = this.normalizeSlug(slugMatch[1]);
            if (processed.has(slug)) return;
            processed.add(slug);
            
            let title = $el.attr("title")?.trim() || $el.text().trim();
            if (!title || title.length < 2) return;
            
            const poster = $el.find("img").attr("data-src") || 
                          $el.find("img").attr("src") || 
                          "";
            
            const parentText = $el.parent().text().trim();
            const qualityMatches: string[] = parentText.match(/(DUB|LEG|HD|CAM|TS|FULL|4K|⭐)/gi) || [];
            const isTrending = qualityMatches.includes("⭐");
            const isHighQuality = qualityMatches.some(q => 
              ["HD", "4K", "FULL"].includes(q.toUpperCase())
            );
            
            const item: MultiSourceItem = { 
              title, 
              slug, 
              poster: this.normalizeUrl(poster), 
              type: "movie", 
              link: href.startsWith("http") ? href : `https://redecanaishd.bond${href}`, 
              sources: ["redecanaishd"], 
              addedAt: new Date(), 
              hitCount: 0, 
              popularity: isTrending ? 98 : (isHighQuality ? 92 : 85), 
              streamVerified: isHighQuality,
              lastHit: new Date(),
            };
            
            if (this.isValidItem(item)) {
              const key = `movie:${this.normalize(title)}`;
              const existing = this.rcMoviesCache.get(key);
              
              if (!existing) {
                this.rcMoviesCache.set(key, item);
                trendingCount++;
              } else {
                existing.popularity = Math.max(existing.popularity ?? 0, item.popularity ?? 0);
                existing.streamVerified = existing.streamVerified || item.streamVerified;
                existing.lastHit = new Date();
              }
            }
          });
        }
        
        if (trendingCount > 0) {
          this.logger.debug(`🔥 Fetched ${trendingCount} trending movies from RedeCanais`);
        }
      } catch (error: any) {
        this.logger.warn(`Failed to fetch RedeCanais trending movies: ${error.message}`);
      }
    });
  }

  private addToCache(item: MultiSourceItem, type: ContentType, source: "topflix" | "redecanais") {
    const key = `${type}:${this.normalize(item.title)}`;
    
    // 🔥 Determina qual cache usar baseado no tipo e fonte
    let cache: LRUCache<string, MultiSourceItem>;
    
    if (source === "topflix") {
      cache = type === "movie" ? this.topflixMoviesCache : this.topflixSeriesCache;
    } else {
      cache = type === "movie" ? this.rcMoviesCache : this.rcSeriesCache;
    }
    
    const existing = cache.get(key);
    
    if (!existing) {
      // 🔥 Item novo - adiciona com metadados otimizados
      item.lastHit = new Date();
      item.addedAt = item.addedAt || new Date();
      item.hitCount = item.hitCount || 0;
      
      // 🔥 Calcula popularidade inicial se não tiver
      if (item.popularity === undefined) {
        item.popularity = source === "redecanais" ? 75 : 50;
      }
      
      cache.set(key, item);
      
      // 🔥 Log de debug para novos itens importantes
      if (item.popularity > 90) {
        this.logger.debug(`🌟 High popularity item added: ${item.title} (${item.popularity})`);
      }
      
    } else {
      // 🔥 Item existente - mescla e atualiza
      existing.sources = [...new Set([...existing.sources, ...item.sources])];
      existing.popularity = Math.max(existing.popularity ?? 0, item.popularity ?? 0);
      existing.hitCount = Math.max(existing.hitCount ?? 0, item.hitCount ?? 0);
      
      // 🔥 Atualiza campos se melhor
      if (item.streamVerified && !existing.streamVerified) {
        existing.streamVerified = true;
      }
      
      if (item.poster && !existing.poster) {
        existing.poster = item.poster;
      }
      
      if (item.genres?.length) {
        existing.genres = [...new Set([...(existing.genres || []), ...item.genres])];
      }
      
      if (item.link && !existing.link.includes("http")) {
        existing.link = item.link;
      }
      
      // 🔥 Atualiza timestamps
      existing.lastHit = new Date();
      if (!existing.addedAt && item.addedAt) {
        existing.addedAt = item.addedAt;
      }
      
      // 🔥 Atualiza no cache com novos valores
      cache.set(key, existing);
    }
  }

  private normalize(str: string): string {
    // 🔥 Usa cache de normalização para performance
    const cacheKey = `normalize:${str}`;
    if (this.normalizedCache.has(cacheKey)) {
      return this.normalizedCache.get(cacheKey)!;
    }
    
    const result = str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
    
    // 🔥 Armazena no cache LRU
    this.normalizedCache.set(cacheKey, result);
    
    return result;
  }

  private normalizeSlug(slug: string): string {
    return slug
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private normalizeUrl(url: string): string {
    if (!url) return "";
    
    // 🔥 Remove parâmetros de tracking desnecessários
    const cleanUrl = url.split('?')[0].split('#')[0];
    
    if (cleanUrl.startsWith("http")) return cleanUrl;
    if (cleanUrl.startsWith("//")) return `https:${cleanUrl}`;
    if (cleanUrl.startsWith("/")) return `${TOPFLIX_DOMAIN}${cleanUrl}`;
    
    // 🔥 URL relativa - adiciona domínio base apropriado
    if (cleanUrl.includes("redecanais")) {
      return `https://redecanaishd.bond/${cleanUrl}`;
    }
    
    return `${TOPFLIX_DOMAIN}/${cleanUrl}`;
  }

  private async getHtml(url: string): Promise<string | null> {
    return this.requestLimiter.run(async () => {
      try {
        const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        
        const headers = {
          "User-Agent": ua,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "DNT": "1",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Cache-Control": "max-age=0",
        };
        
        const response = await this.axios.get(url, { 
          headers,
          timeout: this.REQUEST_TIMEOUT,
          validateStatus: (status) => status === 200,
        });
        
        if (!response.data || typeof response.data !== 'string') {
          this.logger.debug(`Invalid response from ${url}`);
          return null;
        }
        
        return response.data;
        
      } catch (error: any) {
        const statusCode = error.response?.status;
        const isRateLimit = statusCode === 429 || error.code === 'ECONNRESET';
        
        if (isRateLimit) {
          this.logger.warn(`⚠️ Rate limited on ${url}, backing off...`);
        } else if (statusCode === 404) {
          this.logger.debug(`❌ 404 on ${url}`);
        } else if (!error.code) {
          this.logger.debug(`❌ Request failed for ${url}: ${error.message}`);
        }
        
        return null;
      }
    });
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    try {
      const timeout = new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      );
      
      return await Promise.race([promise, timeout]);
    } catch (error) {
      return fallback;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapRcToMulti(i: any, type: ContentType): MultiSourceItem {
    return { 
      title: i.title || "", 
      slug: this.normalizeSlug(i.slug || i.title || ""), 
      poster: i.poster ?? "", 
      type, 
      link: i.url ?? "", 
      genres: i.genres || [], 
      sources: ["redecanaishd"], 
      addedAt: new Date(), 
      hitCount: 0, 
      popularity: i.popularity || 60,
      lastHit: new Date(),
    };
  }

  private getCacheStats() {
    return {
      topflixMovies: this.topflixMoviesCache.size,
      topflixSeries: this.topflixSeriesCache.size,
      rcMovies: this.rcMoviesCache.size,
      rcSeries: this.rcSeriesCache.size,
      normalizedCache: this.normalizedCache.size,
      total: this.topflixMoviesCache.size + this.topflixSeriesCache.size + this.rcMoviesCache.size + this.rcSeriesCache.size,
    };
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Shutting down Production-Optimized TopflixGetterService...');
    
    // 🔥 Limpa todos os schedulers
    if (this.fastScheduler) {
      clearInterval(this.fastScheduler);
      this.fastScheduler = undefined;
    }
    
    if (this.fullScheduler) {
      clearInterval(this.fullScheduler);
      this.fullScheduler = undefined;
    }
    
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
    
    // 🔥 Finaliza agents HTTP
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    
    // 🔥 Salva estatísticas finais
    const finalStats = this.getCacheStats();
    this.logger.log(`📊 Final cache stats: ${JSON.stringify(finalStats)}`);
    
    // 🔥 Limpa caches (opcional, mas bom para cleanup)
    this.topflixMoviesCache.clear();
    this.topflixSeriesCache.clear();
    this.rcMoviesCache.clear();
    this.rcSeriesCache.clear();
    this.normalizedCache.clear();
    
    this.logger.log('✅ Service destroyed successfully');
  }

  // 🔥 Método público para debug e monitoramento
  public getServiceStats() {
    return {
      cache: this.getCacheStats(),
      limiterStats: {
        pageLoader: this.pageLoaderLimiter.getStats(),
        request: this.requestLimiter.getStats(),
        redeCanais: this.redeCanaisLimiter.getStats(),
      },
      pages: {
        movies: this.moviesPage,
        series: this.seriesPage,
      },
      isProcessing: this.isProcessing,
      isInitialized: this.isInitialized,
      config: {
        fastInterval: this.FAST_INTERVAL_MS,
        fullInterval: this.FULL_INTERVAL_MS,
        batchSize: this.BATCH_SIZE,
        publishWindow: this.PUBLISH_WINDOW_MS,
      },
    };
  }

  // 🔥 Método para forçar atualização manual
  public async forceRefresh(mode: "fast" | "full" = "fast"): Promise<void> {
    this.logger.log(`🔧 Manual refresh requested (${mode})`);
    await this.pushNewContentToCatalog(mode);
  }

  // 🔥 Método para limpar caches específicos
  public clearCache(type?: "topflix" | "redecanais", contentType?: ContentType): void {
    if (!type) {
      this.topflixMoviesCache.clear();
      this.topflixSeriesCache.clear();
      this.rcMoviesCache.clear();
      this.rcSeriesCache.clear();
      this.normalizedCache.clear();
      this.logger.log('🧹 All caches cleared');
    } else if (type === "topflix") {
      if (!contentType) {
        this.topflixMoviesCache.clear();
        this.topflixSeriesCache.clear();
        this.logger.log('🧹 Topflix caches cleared');
      } else if (contentType === "movie") {
        this.topflixMoviesCache.clear();
        this.logger.log('🧹 Topflix movies cache cleared');
      } else {
        this.topflixSeriesCache.clear();
        this.logger.log('🧹 Topflix series cache cleared');
      }
    } else {
      if (!contentType) {
        this.rcMoviesCache.clear();
        this.rcSeriesCache.clear();
        this.logger.log('🧹 RedeCanais caches cleared');
      } else if (contentType === "movie") {
        this.rcMoviesCache.clear();
        this.logger.log('🧹 RedeCanais movies cache cleared');
      } else {
        this.rcSeriesCache.clear();
        this.logger.log('🧹 RedeCanais series cache cleared');
      }
    }
  }
}
