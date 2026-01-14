import { Injectable, Logger } from '@nestjs/common';
import { DoramoreScraperService } from '@/modules/doramore/services/scraper.service';
import { DoramasMP4ScraperService } from '@/modules/doramasmp4/services/scraper.service'; // <-- ADICIONE

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);
  private cachedGenres: string[] | null = null;
  private cachedDoramasMP4Genres: string[] | null = null; // <-- ADICIONE

  constructor(
    private readonly doramoreScraper: DoramoreScraperService,
    private readonly doramasmp4Scraper: DoramasMP4ScraperService, // <-- ADICIONE
  ) {}

  private async getDoramoreGenres(): Promise<string[]> {
    if (this.cachedGenres) {
      return this.cachedGenres;
    }

    try {
      const genres = await this.doramoreScraper.discoverGenres();
      this.cachedGenres = genres
        .filter(g => !g.match(/^\d+$/))
        .map(g => {
          return g.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        });
      
      setTimeout(() => {
        this.cachedGenres = null;
      }, 24 * 60 * 60 * 1000);

      return this.cachedGenres;
    } catch (error) {
      this.logger.error('Failed to discover genres, using defaults');
      return ['Ação', 'Comédia', 'Drama', 'Romance'];
    }
  }

  // <-- ADICIONE ESTE MÉTODO
  private async getDoramasMP4Genres(): Promise<string[]> {
    if (this.cachedDoramasMP4Genres) {
      return this.cachedDoramasMP4Genres;
    }

    try {
      const genres = await this.doramasmp4Scraper.discoverGenres();
      this.cachedDoramasMP4Genres = genres
        .filter(g => !g.match(/^\d+$/))
        .map(g => {
          return g.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        });
      
      setTimeout(() => {
        this.cachedDoramasMP4Genres = null;
      }, 24 * 60 * 60 * 1000);

      return this.cachedDoramasMP4Genres;
    } catch (error) {
      this.logger.error('Failed to discover DoramasMP4 genres, using defaults');
      return ['Ação', 'Comédia', 'Drama', 'Romance'];
    }
  }

  async getCatalogs() {
    const genres = await this.getDoramoreGenres();
    const doramasmp4Genres = await this.getDoramasMP4Genres(); // <-- ADICIONE
    
    const genreOptions = ['Todos', ...genres];
    const doramasmp4GenreOptions = ['Todos', ...doramasmp4Genres]; // <-- ADICIONE

    const catalogs = [
      // TopFlix
      {
        id: 'topflix.movies',
        type: 'movie',
        name: 'TopFlix Filmes',
      },
      {
        id: 'topflix.series',
        type: 'series',
        name: 'TopFlix Séries',
      },
      {
        id: 'topflix.tv',
        type: 'channel',
        name: 'TopFlix TV',
      },
      
      // DoraMore
      {
        id: 'doramore.series',
        type: 'series',
        name: '🎭 DoraMore Séries',
        extra: [
          {
            name: 'genre',
            isRequired: false,
            options: genreOptions,
            optionsLimit: 1,
          },
          {
            name: 'skip',
            isRequired: false,
          },
        ],
      },

      // <-- ADICIONE DoramasMP4
      {
        id: 'doramasmp4.series',
        type: 'series',
        name: '🎬 DoramasMP4',
        extra: [
          {
            name: 'genre',
            isRequired: false,
            options: doramasmp4GenreOptions,
            optionsLimit: 1,
          },
          {
            name: 'skip',
            isRequired: false,
          },
        ],
      },
    ];

    this.logger.log(`✅ Generated ${catalogs.length} catalogs`);
    return catalogs;
  }

  async getManifest() {
    const catalogs = await this.getCatalogs();

    return {
      id: 'org.reflux.complete',
      name: 'Reflux',
      description: 'TopFlix + DoraMore + DoramasMP4 - Seu hub completo de streaming!',
      version: '5.0.0',
      logo: 'http://localhost:3000/public/images/logo.png',
      
      resources: ['catalog', 'meta', 'stream'],
      types: ['movie', 'series', 'channel'],
      idPrefixes: ['topflix:', 'doramore:', 'doramasmp4:'], // <-- ADICIONE
      
      catalogs,
      
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: false,
        configurationRequired: false,
      },
    };
  }
}
