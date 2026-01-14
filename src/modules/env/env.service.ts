import { Env } from '@/modules/env/env';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EnvService {
  public constructor(
    private readonly configService: ConfigService<Env, true>,
  ) {}

  public get<T extends keyof Env>(key: T) {
    return this.configService.get(key, { infer: true });
  }
}
