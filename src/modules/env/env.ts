import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'seed'])
    .default('development'),
  APP_PORT: z.coerce.number().min(0).max(65535).default(3000),
  APP_URL: z.coerce.string().url(),
  PROXY_URL: z.coerce.string().url().optional(),
  DATABASE_URL: z.coerce.string().url(),
  TMDB_KEY: z.coerce.string(),
});

export type Env = z.infer<typeof envSchema>;
