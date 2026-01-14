import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { StremioModule } from '../../modules/stremio/stremio.module';
import { TvModule } from '../../modules/tv/tv.module'; // ✅ Verifique se este caminho está correto

@Module({
  imports: [
    StremioModule, 
    TvModule // ✅ Agora dentro do array e com vírgula
  ],
  controllers: [CatalogController],
  providers: [],
})
export class CatalogModule {}
