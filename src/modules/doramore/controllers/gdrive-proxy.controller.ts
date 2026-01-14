import { Controller, Get, Query, Res, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { GdriveProxyService } from '../services/gdrive-proxy.service';

@Controller('proxy')
export class GDriveProxyController {
  private readonly logger = new Logger(GDriveProxyController.name);

  constructor(private readonly gdriveProxyService: GdriveProxyService) {}

  @Get('gdrive')
  async proxyGoogleDrive(
    @Query('id') fileId: string,
    @Res() res: Response,
  ) {
    if (!fileId) {
      throw new HttpException('File ID é obrigatório', HttpStatus.BAD_REQUEST);
    }

    try {
      this.logger.log(`🚀 [Puppeteer] Proxy Google Drive: ${fileId}`);
      
      // Usar Puppeteer para obter o vídeo
      await this.gdriveProxyService.streamVideo(fileId, res);
      
    } catch (error: any) {
      this.logger.error(`❌ Erro no proxy: ${error.message}`);
      
      if (!res.headersSent) {
        throw new HttpException(
          `Falha no proxy: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    }
  }
}
