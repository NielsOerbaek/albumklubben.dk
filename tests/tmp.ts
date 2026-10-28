import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

/**
 * A temp directory that is taken down again when the file's tests are done.
 *
 * It is here because they were not. `mkdtempSync` on its own leaves the directory behind, and a
 * suite that makes one per test run — the seed test copies the whole upload directory into its
 * own, some 50 MB a time — fills the disk of whatever machine the tests are run on. That is not
 * only a developer's laptop: this repo's own box runs them, and the disk it shares with the live
 * site and the backups ran out.
 *
 * Every name starts with `ak-`, so anything that does escape is still easy to find and sweep.
 */
const made: string[] = []

export function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ak-${prefix}`))
  made.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
