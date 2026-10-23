import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildApp } from './app.ts'
import { openDb } from './db.ts'

if (!existsSync('.env')) {
  console.error('Mangler .env (kopier .env.example)')
  process.exit(1)
}
process.loadEnvFile('.env')
const env = process.env
const dbPath = env.DB_PATH ?? 'var/albumklubben.sqlite'
const uploadDir = env.UPLOAD_DIR ?? 'var/uploads'
mkdirSync(dirname(dbPath), { recursive: true })
mkdirSync(uploadDir, { recursive: true })

const app = buildApp({
  db: openDb(dbPath),
  uploadDir,
  adminPassword: env.ADMIN_PASSWORD!,
  sessionSecret: env.SESSION_SECRET!,
  webDir: existsSync('dist') ? 'dist' : undefined,
})
await app.listen({ host: env.HOST ?? '127.0.0.1', port: Number(env.PORT ?? 3600) })
