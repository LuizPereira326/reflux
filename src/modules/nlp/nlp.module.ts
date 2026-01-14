import { GenresModule } from '@/modules/genres/genres.module';
import { NlpProcessingService } from '@/modules/nlp/services/processing.service';
import { NlpQueriesService } from '@/modules/nlp/services/queries.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [GenresModule],
  providers: [NlpProcessingService, NlpQueriesService],
  exports: [NlpProcessingService, NlpQueriesService],
})
export class NlpModule {}
