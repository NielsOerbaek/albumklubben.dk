/**
 * One-off: turns the old free-text `gender` line into the four counts of a `lineup`.
 *
 *     node --experimental-strip-types tools/gender-to-lineup.ts <sti til .sqlite|albums.json> [...]
 *
 * The club's cards used to say "Mand", "Tre kvinder", "5 mænd og 1 kvinde", "Transkvinde" —
 * clear to read one at a time, hopeless as a chart. This read them once, on 2026-10-28, into
 * `lineup_men`/`_women`/`_nonbinary`/`_other` (and `lineup` in the seed JSON), and then the old
 * column went. Nothing reads prose at run time; that was the point of the change.
 *
 * It is kept because it is the record of how the numbers were arrived at, and because the Figma
 * export in `data/` can be re-exported with the old field in it. It prints every line and what it
 * made of it, and `--dry` stops before writing anything.
 *
 * A database is migrated in full: the four columns are added, filled, and `gender` is dropped.
 * Run it with the service stopped, and take a backup first.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import BetterSqlite3 from 'better-sqlite3'
import { EMPTY_LINEUP, lineupTotal, type Lineup, type LineupKey } from '../shared/gender.ts'

/** Danish for the small numbers; a band described in words rarely runs past ten. */
const WORDS: Record<string, number> = {
  en: 1, én: 1, et: 1, ét: 1, to: 2, tre: 3, fire: 4, fem: 5,
  seks: 6, syv: 7, otte: 8, ni: 9, ti: 10,
}

/**
 * Which count a phrase adds to. A trans woman is a woman and a trans man is a man, so
 * `transkvinde` and `transmand` fall out of the same two tests without a case of their own.
 */
function keyOf(phrase: string): LineupKey | null {
  if (/nonbinæ|non-binæ|ikkebinæ|ikke-binæ|nonbinary/.test(phrase)) return 'nonbinary'
  if (/kvinde/.test(phrase)) return 'women'
  if (/mand|mænd/.test(phrase)) return 'men'
  return null
}

/** The number in front of a phrase, as a digit or a word. Nothing in front means one of them. */
function countIn(phrase: string): number {
  const digits = /(\d+)/.exec(phrase)
  if (digits) return Math.max(1, Number(digits[1]))
  for (const word of phrase.split(/[^a-zæøå]+/)) {
    if (WORDS[word] !== undefined) return WORDS[word]
  }
  return 1
}

/** One reading of the line: every "n <gender>" in it, added up. */
function readOne(text: string): Lineup {
  const out = { ...EMPTY_LINEUP }
  for (const phrase of text.split(/,|\bog\b|\bsamt\b/)) {
    const key = keyOf(phrase)
    if (key) out[key] += countIn(phrase)
  }
  return out
}

/**
 * The lineup an old line describes. A line it cannot read, or an empty one, becomes one `other`,
 * so no album drops out of the chart without anyone noticing.
 *
 * Where the line offers alternatives — "3 mænd eller 2 mænd, 1 kvinde og 1 nonbinær" — the one
 * naming the most genders wins: the chart is about which genders are there, and the narrower
 * reading would hide two of them.
 */
export function readGender(text: string): Lineup {
  const clean = (text ?? '').toLowerCase().trim()
  if (clean === '') return { ...EMPTY_LINEUP, other: 1 }
  const readings = clean.split(/\beller\b/).map(readOne)
  const best = readings.reduce((a, b) =>
    (Object.values(b).filter(Boolean).length > Object.values(a).filter(Boolean).length ? b : a))
  return lineupTotal(best) > 0 ? best : { ...EMPTY_LINEUP, other: 1 }
}

// --- Doing it ----------------------------------------------------------------------------------

const show = (text: string, l: Lineup) =>
  console.log(`  ${JSON.stringify(text).padEnd(70)} -> ${JSON.stringify(l)}`)

function migrateDb(path: string, dry: boolean) {
  const db = new BetterSqlite3(path)
  const cols = (db.prepare('PRAGMA table_info(albums)').all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('gender')) return console.log(`${path}: already done, no gender column`)
  for (const key of ['men', 'women', 'nonbinary', 'other']) {
    if (!cols.includes(`lineup_${key}`)) {
      db.exec(`ALTER TABLE albums ADD COLUMN lineup_${key} INTEGER NOT NULL DEFAULT 0`)
    }
  }
  const rows = db.prepare('SELECT id, gender FROM albums').all() as { id: number; gender: string }[]
  const set = db.prepare(`UPDATE albums SET lineup_men = ?, lineup_women = ?, lineup_nonbinary = ?,
    lineup_other = ? WHERE id = ?`)
  db.transaction(() => {
    for (const r of rows) {
      const l = readGender(r.gender)
      show(r.gender, l)
      if (!dry) set.run(l.men, l.women, l.nonbinary, l.other, r.id)
    }
  })()
  if (!dry) db.exec('ALTER TABLE albums DROP COLUMN gender')
  console.log(`${path}: ${rows.length} albums${dry ? ' (dry run, nothing written)' : ', gender dropped'}`)
}

function migrateJson(path: string, dry: boolean) {
  const albums = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
  let done = 0
  for (const a of albums) {
    if (a.lineup !== undefined) continue
    const l = readGender(String(a.gender ?? ''))
    show(String(a.gender ?? ''), l)
    delete a.gender
    a.lineup = l
    done++
  }
  if (!dry) writeFileSync(path, `${JSON.stringify(albums, null, 2)}\n`)
  console.log(`${path}: ${done} albums${dry ? ' (dry run, nothing written)' : ''}`)
}

// Only when run as a command. `readGender` above is imported on its own by its test.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const paths = args.filter(a => !a.startsWith('--'))
  if (paths.length === 0) {
    console.error('usage: gender-to-lineup.ts [--dry] <sti til .sqlite eller albums.json> ...')
    process.exit(1)
  }
  for (const path of paths) {
    console.log(`\n${path}`)
    if (path.endsWith('.json')) migrateJson(path, dry)
    else migrateDb(path, dry)
  }
}
