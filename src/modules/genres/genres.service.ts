import { DelegateGenres, TmdbService } from '@/modules/tmdb/tmdb.service';
import { ContentType } from '@/modules/tmdb/types/tmdb';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class GenresService implements OnModuleInit {
  private readonly logger = new Logger(GenresService.name);

  public constructor(private readonly tmdbService: TmdbService) {}

  public async onModuleInit() {
    this.logger.log('Syncing genres with tmdb, please wait...');

    await Promise.all([
      this.sync(
        ContentType.MOVIE,
        this.tmdbService.convertGenreContentType(ContentType.MOVIE),
      ),
      this.sync(
        ContentType.TV,
        this.tmdbService.convertGenreContentType(ContentType.TV),
      ),
    ]);

    this.logger.log('Database genres is fully sync with tmdb.');
  }

  private async sync(type: ContentType, model: DelegateGenres): Promise<void> {
    const genres = await this.tmdbService.listGenres(type);
    let sync = 0;

    for (const genre of genres.genres) {
      const exists = await model.findFirst({
        where: { id: genre.id },
        select: { id: true },
      });

      if (!exists) {
        const created = await model.create({
          data: { id: genre.id, name: genre.name },
          select: { id: true },
        });

        if (created) {
          sync++;
        }
      }
    }

    if (sync) {
      this.logger.log(
        `${sync} new ${type} genre${sync > 1 ? 's' : ''} were synced with tmdb.`,
      );
    }
  }
}
