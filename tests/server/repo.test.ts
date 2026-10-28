import BetterSqlite3 from 'better-sqlite3'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../server/db.ts'
import { openDb } from '../../server/db.ts'
import {
  createAlbum, createMeeting, createPoster, deleteMeeting, getMeeting, isEmpty, listMeetings, moveAlbum,
  updateAlbum, updatePoster,
} from '../../server/repo.ts'
import type { AlbumInput } from '../../shared/types.ts'
import { tmp } from '../tmp.ts'
import { EMPTY_LINEUP } from '../../shared/gender.ts'

const album = (over: Partial<AlbumInput> = {}): AlbumInput => ({
  artist: 'A', title: 'T', year: 1999, origin: 'Danmark', country: 'DK', lat: 55, lng: 12,
  genre: 'Pop', lineup: EMPTY_LINEUP, status: 'Aktiv', pickedByName: null, pickedByWorkplace: null,
  story: null, cardColor: '#ff0000', coverPath: null, tracklist: null, ...over,
})
const meeting = (number = 1) => ({ number, date: '2024-01-01', time: '12:00', theme: null })

let db: Database
beforeEach(() => { db = openDb(':memory:') })

describe('repo', () => {
  it('creates a meeting with two albums and a poster and lists them in position order', () => {
    expect(isEmpty(db)).toBe(true)
    const m = createMeeting(db, meeting())
    createAlbum(db, m, album({ coverPath: 'covers/x.jpg' }))
    createAlbum(db, m, album({ title: 'U' }))
    createPoster(db, m, { imagePath: 'posters/p.jpg', caption: null, about: null, videoPath: null })
    const [got] = listMeetings(db)
    expect(isEmpty(db)).toBe(false)
    expect(got.albums.map(a => a.position)).toEqual([1, 2])
    expect(got.albums[0].coverUrl).toBe('/uploads/covers/x.jpg')
    expect(got.albums[1].coverUrl).toBeNull()
    expect(got.posters[0].imageUrl).toBe('/uploads/posters/p.jpg')
  })

  it('moveAlbum swaps positions with the neighbour and is a no-op at the ends', () => {
    const m = createMeeting(db, meeting())
    const a = createAlbum(db, m, album({ title: 'first' }))
    const b = createAlbum(db, m, album({ title: 'second' }))
    const titles = () => listMeetings(db)[0].albums.map(x => x.title)
    moveAlbum(db, a, -1)
    moveAlbum(db, b, 1)
    expect(titles()).toEqual(['first', 'second'])
    moveAlbum(db, a, 1)
    expect(titles()).toEqual(['second', 'first'])
    expect(listMeetings(db)[0].albums.map(x => x.position)).toEqual([1, 2])
  })

  it('deleteMeeting cascades and returns every referenced path', () => {
    const m = createMeeting(db, meeting())
    createAlbum(db, m, album({ coverPath: 'covers/c.jpg' }))
    createPoster(db, m, { imagePath: 'posters/p.jpg', caption: 'c', about: null, videoPath: 'videos/v.mp4' })
    const paths = deleteMeeting(db, m)
    expect(paths.sort()).toEqual(['covers/c.jpg', 'posters/p.jpg', 'videos/v.mp4'])
    expect(listMeetings(db)).toEqual([])
    expect(db.prepare('select count(*) n from albums').get()).toEqual({ n: 0 })
    expect(db.prepare('select count(*) n from posters').get()).toEqual({ n: 0 })
  })

  it('meeting number is unique', () => {
    createMeeting(db, meeting(5))
    expect(() => createMeeting(db, meeting(5))).toThrow()
  })

  it('stores text verbatim', () => {
    const m = createMeeting(db, meeting())
    const story = '<script>"æøå" 🎵'
    createAlbum(db, m, album({ story }))
    expect(listMeetings(db)[0].albums[0].story).toBe(story)
  })
})

describe('tracklist and about', () => {
  it('round-trips verbatim through create and update', () => {
    const m = createMeeting(db, meeting())
    const a = createAlbum(db, m, album({ tracklist: 'Intro 1:02\nOutro' }))
    const p = createPoster(db, m, { imagePath: 'p.jpg', caption: null, about: 'Æøå <script>', videoPath: null })
    expect(getMeeting(db, m)!.albums[0].tracklist).toBe('Intro 1:02\nOutro')
    expect(getMeeting(db, m)!.posters[0].about).toBe('Æøå <script>')
    updateAlbum(db, a, album({ tracklist: 'X\n\nY 2:00' }))
    updatePoster(db, p, { imagePath: 'p.jpg', caption: null, about: 'Ny', videoPath: null })
    expect(getMeeting(db, m)!.albums[0].tracklist).toBe('X\n\nY 2:00')
    expect(getMeeting(db, m)!.posters[0].about).toBe('Ny')
  })
})

const ROUND1 = `
CREATE TABLE meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL, date TEXT, time TEXT, theme TEXT, UNIQUE(number));
CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, artist TEXT NOT NULL, title TEXT NOT NULL, year INTEGER, origin TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '', lat REAL, lng REAL, genre TEXT NOT NULL DEFAULT '', gender TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', picked_by_name TEXT, picked_by_workplace TEXT, story TEXT, card_color TEXT NOT NULL, cover_path TEXT);
CREATE TABLE posters (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, image_path TEXT NOT NULL, caption TEXT, video_path TEXT);
CREATE INDEX albums_meeting ON albums(meeting_id, position);
CREATE INDEX posters_meeting ON posters(meeting_id, position);
`

describe('migration', () => {
  it('upgrades a round-1 database in place, twice', () => {
    const path = join(tmp('mig-'), 'old.db')
    const old = new BetterSqlite3(path)
    old.exec(ROUND1)
    old.exec(`INSERT INTO meetings (number) VALUES (1);
      INSERT INTO albums (meeting_id, position, artist, title, card_color) VALUES (1, 1, 'A', 'T', '#fff000');
      INSERT INTO posters (meeting_id, position, image_path, caption) VALUES (1, 1, 'p.jpg', 'c');`)
    old.close()
    for (let i = 0; i < 2; i++) {
      const db = openDb(path)
      const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name)
      expect(cols('albums')).toContain('tracklist')
      expect(cols('posters')).toContain('about')
      const [m] = listMeetings(db)
      expect(m.albums[0]).toMatchObject({ artist: 'A', tracklist: null })
      expect(m.posters[0]).toMatchObject({ caption: 'c', about: null })
      db.close()
    }
  })
})
