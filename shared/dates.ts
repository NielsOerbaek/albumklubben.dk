const DAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september',
  'oktober', 'november', 'december']

/** A meeting's date in Danish, e.g. "Tirsdag 21. april 2026, 11.30-12.30". The time is shown
 *  only with a date; a missing or invalid date gives null. */
export function formatMeetingDate(date: string | null, time: string | null): string | null {
  const m = date?.match(/^(\d{4})-(\d\d)-(\d\d)$/)
  if (!m) return null
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  const text = `${DAYS[day.getUTCDay()]} ${d}. ${MONTHS[mo - 1]} ${y}`
  const t = time?.trim().replaceAll(':', '.')
  return t ? `${text}, ${t}` : text
}
