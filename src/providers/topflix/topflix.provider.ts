import { Injectable } from '@nestjs/common';
import { IframeStreamService } from './services/streams/iframe.stream.service';

@Injectable()
export class TopflixProvider {
  constructor(private readonly iframeStreamService: IframeStreamService) {}

  public async getMovieStream(movieId: string) {
    return await this.iframeStreamService.getStream('movie', movieId);
  }

  public async getSeriesStream(seriesId: string) {
    return await this.iframeStreamService.getStream('series', seriesId);
  }
}
