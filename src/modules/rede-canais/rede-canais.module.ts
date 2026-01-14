import { Module } from '@nestjs/common';
import { RedeCanaisService } from './rede-canais.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [RedeCanaisService],
  exports: [RedeCanaisService], // Exporta para ser usado no StremioService
})
export class RedeCanaisModule {}
