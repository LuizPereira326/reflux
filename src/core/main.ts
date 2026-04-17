import { AppModule } from '@/core/app.module';
import { EnvService } from '@/modules/env/env.service';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as packageJson from '@package';

async function bootstrap(): Promise<void> {
  // ✅ Adicionei o segundo parâmetro de configuração
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = app.get(EnvService);

  const environment = config.get('NODE_ENV');
  const appPort = config.get('APP_PORT');

  // CORS completo para Stremio
  app.enableCors({
    origin: '*',
    methods: '*',
    allowedHeaders: '*',
    credentials: false,
  });

  app.disable('x-powered-by');

  // CRÍTICO para ngrok e proxies
  app.set('trust proxy', true);

  // Escuta em todas as interfaces (necessário para ngrok)
  await app.listen(appPort, '0.0.0.0', () => {
    console.log();
    console.log('🌉 HTTP server was successfully started.');
    console.log(`🚀 Reflux: v${packageJson.version}`);
    console.log(`🔒 Environment: ${environment}`);
    console.log(`✨ Listening on port ${appPort}`);
    console.log(`📡 Access via: http://localhost:${appPort}`);
    console.log();
  });
}

bootstrap();
