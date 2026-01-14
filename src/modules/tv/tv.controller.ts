import { Controller, Get, Post, Body, Delete, Param } from '@nestjs/common';
import { TvService } from './tv.service';

@Controller('admin/tv')
export class TvController {
  constructor(private readonly tvService: TvService) {}

  @Get()
  getAll() {
    return this.tvService.getAllChannels();
  }

  @Post()
  create(@Body() body: { name: string; streamUrl: string; logo?: string; group?: string }) {
    return this.tvService.createChannel(body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.tvService.deleteChannel(id);
  }
}
