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
// The site holds members' personal photos: no Theta login, no start.
for (const key of ['ADMIN_PASSWORD', 'SESSION_SECRET', 'THETA_ISSUER', 'THETA_CLIENT_ID', 'THETA_CLIENT_SECRET', 'THETA_GROUP_ID', 'PUBLIC_URL']) {
  if (!env[key]) {
    console.error(`Mangler ${key} i .env`)
    process.exit(1)
  }
}
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
  theta: {
    issuer: env.THETA_ISSUER!.replace(/\/$/, ''),
    clientId: env.THETA_CLIENT_ID!,
    clientSecret: env.THETA_CLIENT_SECRET!,
    groupId: env.THETA_GROUP_ID!,
    publicUrl: env.PUBLIC_URL!.replace(/\/$/, ''),
  },
})
await app.listen({ host: env.HOST ?? '127.0.0.1', port: Number(env.PORT ?? 3600) })
