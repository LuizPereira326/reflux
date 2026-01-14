import { EnvModule } from '@/modules/env/env.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { TmdbService } from '@/modules/tmdb/tmdb.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [EnvModule, PrismaModule],
  providers: [TmdbService],
  exports: [TmdbService],
})
export class TmdbModule {}
