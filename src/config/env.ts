import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
  GUILD_ID: z.string().min(1, 'GUILD_ID is required'),

  // Admin — comma-separated list of Discord user IDs with full access
  ADMIN_USER_IDS: z.string().min(1, 'ADMIN_USER_IDS is required (comma-separated)'),
  // Manager — comma-separated list of Discord user IDs with limited admin access
  MANAGER_USER_IDS: z.string().default(''),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_CLIENT_EMAIL: z.string().min(1, 'FIREBASE_CLIENT_EMAIL is required'),
  FIREBASE_PRIVATE_KEY: z.string().min(1, 'FIREBASE_PRIVATE_KEY is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // JWT
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  DASHBOARD_USERNAME: z.string().default('admin'),
  DASHBOARD_PASSWORD: z.string().min(1, 'DASHBOARD_PASSWORD is required'),

  // API
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Dashboard
  DASHBOARD_URL: z.string().default('http://localhost:5173'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment validation failed:');
    for (const error of result.error.errors) {
      console.error(`   ${error.path.join('.')}: ${error.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
