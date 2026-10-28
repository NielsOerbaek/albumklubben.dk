import { execFile } from 'node:child_process'
import {readdirSync} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tmp } from '../tmp.ts'

/**
 * The server is run by Node itself (`node --experimental-strip-types`), which only strips types:
 * it refuses parameter properties, enums and anything else that would mean something at runtime.
 * Vitest compiles with esbuild, which takes all of it, so without this the whole suite can pass
 * on a server that will not start.
 *
 * Loading is done from an empty directory, so `index.ts` and `seed-cli.ts` stop at their missing
 * .env instead of starting a server: they have been read by then, which is the point.
 */
describe('the server runs on Node\'s strip-only TypeScript', () => {
  const files = readdirSync('server', { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.ts'))
  const elsewhere = tmp('strip-')

  it('has server modules to check', () => expect(files.length).toBeGreaterThan(5))

  it.each(files)('loads server/%s', (file) => new Promise<void>((done, fail) => {
    const url = pathToFileURL(resolve('server', file)).href
    execFile(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
      { cwd: elsewhere }, (_err, _out, stderr) => {
        try {
          expect(stderr, `server/${file}`).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')
          expect(stderr, `server/${file}`).not.toContain('ERR_INVALID_TYPESCRIPT_SYNTAX')
          done()
        } catch (e) { fail(e) }
      })
  }), 20_000)
})
