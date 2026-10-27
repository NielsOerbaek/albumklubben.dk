/** Opslagstavlen: the club's Theta group as the site passes it between server and page. */
export interface BoardAuthor { sub: string; name: string }

export interface BoardPost {
  id: string
  author: BoardAuthor
  title: string | null
  body: string
  createdAt: string
  commentCount: number
  attachmentCount: number
  pinned: boolean
  /** The post on Theta, where the attachments and everything else are. */
  url: string | null
}

export interface BoardComment {
  id: string
  author: BoardAuthor
  body: string
  createdAt: string
  /** How deep in the thread Theta put it. Albumklubben can only write at the top (depth 0). */
  depth: number
}

export interface Page<T> { items: T[]; nextCursor: string | null }

const MONTHS = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
const two = (n: number) => String(n).padStart(2, '0')
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** When something was written, in Danish and as short as it can be: "14.03" today, "I går 14.03",
 *  then "3. nov. 14.03", with the year once it is not this one. */
export function formatPostTime(iso: string, now = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const clock = `${two(at.getHours())}.${two(at.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(at, now)) return clock
  if (sameDay(at, yesterday)) return `I går ${clock}`
  const year = at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`
  return `${at.getDate()}. ${MONTHS[at.getMonth()]}${year} ${clock}`
}

/** The first name, which is what a note on the board and a summary have room for. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Et medlem'
