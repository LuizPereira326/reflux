import { EnvService } from '@/modules/env/env.service';
import { ManifestService } from '@/routes/manifest/manifest.service';
import { TvService } from '@/modules/tv/tv.service';
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import * as packageJson from '@package';

@Controller('/manifest.json')
export class ManifestController {
  public constructor(
    private readonly envService: EnvService,
    private readonly manifestService: ManifestService,
    private readonly tvService: TvService,
  ) {}

  @Get('/')
  public async get(@Req() req: Request): Promise<any> {
    const protocol =
      (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host =
      (req.headers['x-forwarded-host'] as string) || req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const catalogs = await this.manifestService.getCatalogs();

    return {
      id: 'community.reflux.topflix.v13',
      version: '1.0.43',
      name: packageJson.stremio.name,
      description: packageJson.stremio.description,
      logo: `${baseUrl}/public/images/logo.png`,

      resources: [
        'catalog',
        {
          name: 'meta',
          types: ['movie', 'series', 'channel'],
          idPrefixes: ['topflix:', 'doramore:'],
        },
        {
          name: 'stream',
          types: ['movie', 'series', 'channel'],
          idPrefixes: ['topflix:', 'doramore:'],
        },
      ],

      types: ['movie', 'series', 'channel'],
      idPrefixes: ['topflix:', 'doramore:'],

      catalogs,
    };
  }
}

