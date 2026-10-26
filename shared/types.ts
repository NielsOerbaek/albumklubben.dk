export interface Album { id: number; meetingId: number; position: number; artist: string; title: string;
  year: number | null; origin: string; country: string; lat: number | null; lng: number | null;
  genre: string; gender: string; status: string; pickedByName: string | null;
  pickedByWorkplace: string | null; story: string | null; cardColor: string; coverUrl: string | null;
  tracklist: string | null }
export interface Poster { id: number; meetingId: number; position: number; imageUrl: string;
  caption: string | null; about: string | null; videoUrl: string | null }
export interface Meeting { id: number; number: number; date: string | null; time: string | null;
  theme: string | null; albums: Album[]; posters: Poster[] }   // albums/posters ordered by position
export interface Archive { meetings: Meeting[] }                 // ordered by number ascending
export type AlbumInput = Omit<Album, 'id' | 'meetingId' | 'position' | 'coverUrl'> & { coverPath: string | null }
export type PosterInput = { imagePath: string; caption: string | null; about: string | null; videoPath: string | null }
export type MeetingInput = { number: number; date: string | null; time: string | null; theme: string | null }
