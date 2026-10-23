import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDb } from './db.ts'
import { seed } from './seed.ts'

if (!existsSync('.env')) {
  console.error('Mangler .env (kopier .env.example)')
  process.exit(1)
}
process.loadEnvFile('.env')
const dbPath = process.env.DB_PATH!
const uploadDir = process.env.UPLOAD_DIR!
mkdirSync(dirname(dbPath), { recursive: true })
try {
  const r = seed(openDb(dbPath), 'data', uploadDir)
  console.log(`${r.meetings} meetings, ${r.albums} albums, ${r.posters} posters`)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
