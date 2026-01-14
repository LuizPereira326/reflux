import { Module } from '@nestjs/common';
import { TvService } from './tv.service';
import { TvController } from './tv.controller';
import { PrismaModule } from '@/modules/prisma/prisma.module'; // Ajuste caminho

@Module({
  imports: [PrismaModule],
  controllers: [TvController],
  providers: [TvService],
  exports: [TvService], // Exporta para usar no Stremio
})
export class TvModule {}
