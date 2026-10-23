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
  cover_path TEXT
);
CREATE TABLE IF NOT EXISTS posters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  caption TEXT,
  video_path TEXT
);
CREATE INDEX IF NOT EXISTS albums_meeting ON albums(meeting_id, position);
CREATE INDEX IF NOT EXISTS posters_meeting ON posters(meeting_id, position);
`

export function openDb(path: string): Database {
  const db = new BetterSqlite3(path)
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
