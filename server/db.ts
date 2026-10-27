import BetterSqlite3 from 'better-sqlite3'

export type Database = BetterSqlite3.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  date TEXT,
  time TEXT,
  theme TEXT,
  UNIQUE(number)
);
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  origin TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  genre TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  picked_by_name TEXT,
  picked_by_workplace TEXT,
  story TEXT,
  card_color TEXT NOT NULL,
  cover_path TEXT,
  tracklist TEXT
);
CREATE TABLE IF NOT EXISTS posters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  caption TEXT,
  video_path TEXT,
  about TEXT
);
-- Lyttefesten: an album, a time, and everybody pressing play at once on their own speakers.
-- The tracks column is the tracklist frozen as it was when the lyttefest was made, so editing
-- the album later cannot move a party that has already been held.
CREATE TABLE IF NOT EXISTS lyttefester (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  host_sub TEXT NOT NULL,
  host_name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  note TEXT,
  tracks TEXT NOT NULL,
  theta_post_id TEXT,
  theta_post_url TEXT,
  card_external_id TEXT,
  posted_as TEXT NOT NULL DEFAULT 'user',
  cancelled_at TEXT,
  reminded_at TEXT,
  summary_posted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lyttefest_rsvps (
  lyttefest_id INTEGER NOT NULL REFERENCES lyttefester(id) ON DELETE CASCADE,
  sub TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (lyttefest_id, sub)
);
CREATE TABLE IF NOT EXISTS lyttefest_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lyttefest_id INTEGER NOT NULL REFERENCES lyttefester(id) ON DELETE CASCADE,
  sub TEXT NOT NULL,
  name TEXT NOT NULL,
  track_index INTEGER,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS lyttefester_album ON lyttefester(album_id);
CREATE INDEX IF NOT EXISTS lyttefester_time ON lyttefester(starts_at);
CREATE INDEX IF NOT EXISTS lyttefest_comments_fest ON lyttefest_comments(lyttefest_id, created_at);
CREATE INDEX IF NOT EXISTS albums_meeting ON albums(meeting_id, position);
CREATE INDEX IF NOT EXISTS posters_meeting ON posters(meeting_id, position);
`

function addColumn(db: Database, table: string, column: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
}

export function openDb(path: string): Database {
  const db = new BetterSqlite3(path)
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  addColumn(db, 'albums', 'tracklist')
  addColumn(db, 'posters', 'about')
  return db
}
