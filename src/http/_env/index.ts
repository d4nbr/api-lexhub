import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().default(3892),
  DATABASE_URL: z.string().url(),
  PASSWORD_ADMIN_FULL: z.string().min(8),
  EMAIL_ADMIN_FULL: z.string().email(),
  JWT_SECRET: z.string().min(8),
  RESEND_API_KEY: z.string(),
  WEB_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(),
  DOMAIN: z.string().default('localhost'),
  API_PROTHEUS_DATA_URL: z.string().url(),
  API_PROTHEUS_FIN_URL: z.string().url(),
})

const _env = envSchema.safeParse(process.env)

if (_env.success === false) {
  console.error(
    '> ❌ Variáveis de ambiente inválidas, verifique o arquivo .env',
    _env.error.format()
  )

  throw new Error('❌ Houve um erro ao carregar as variáveis de ambiente.')
}

export const env = _env.data
