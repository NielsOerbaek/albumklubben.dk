import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../server/db.ts'
import { openDb } from '../../server/db.ts'
import {
  createAlbum, createMeeting, createPoster, deleteMeeting, isEmpty, listMeetings, moveAlbum,
} from '../../server/repo.ts'
import type { AlbumInput } from '../../shared/types.ts'

const album = (over: Partial<AlbumInput> = {}): AlbumInput => ({
  artist: 'A', title: 'T', year: 1999, origin: 'Danmark', country: 'DK', lat: 55, lng: 12,
  genre: 'Pop', gender: 'Mand', status: 'Aktiv', pickedByName: null, pickedByWorkplace: null,
  story: null, cardColor: '#ff0000', coverPath: null, ...over,
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
    createPoster(db, m, { imagePath: 'posters/p.jpg', caption: null, videoPath: null })
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
    createPoster(db, m, { imagePath: 'posters/p.jpg', caption: 'c', videoPath: 'videos/v.mp4' })
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
