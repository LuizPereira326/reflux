import { Module } from '@nestjs/common';
import { StreamService } from './stream.service';
import { StreamController } from './stream.controller';
import { TopflixModule } from '@/providers/topflix/topflix.module';
import { DoramoreModule } from '@/modules/doramore/doramore.module'; // ✅ Import necessário

@Module({
  imports: [
    TopflixModule,
    DoramoreModule, // ✅ Adicionado
  ],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}

