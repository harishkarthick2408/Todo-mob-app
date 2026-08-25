import { todayStr } from './recurrence.js'

// Fully local, regex-based parser. No network call, no ML model download —
// this never leaves the device, satisfying "quick task creation must not
// call an external AI API."

const TIME_RE = /\b(at\s+)?(\d{1,2})(:(\d{2}))?\s?(am|pm)\b/i
const TOMORROW_RE = /\btomorrow\b/i
const TODAY_RE = /\btoday\b/i
const TONIGHT_RE = /\btonight\b/i

export function parseQuickTask(input) {
  let title = input.trim()
  let date = todayStr()
  let time = null

  if (TOMORROW_RE.test(title)) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    date = todayStr(d)
    title = title.replace(TOMORROW_RE, '').trim()
  } else if (TODAY_RE.test(title)) {
    title = title.replace(TODAY_RE, '').trim()
  } else if (TONIGHT_RE.test(title)) {
    time = '20:00'
    title = title.replace(TONIGHT_RE, '').trim()
  }

  const m = title.match(TIME_RE)
  if (m) {
    let hh = parseInt(m[2], 10)
    const mm = m[4] ? parseInt(m[4], 10) : 0
    const ampm = m[5].toLowerCase()
    if (ampm === 'pm' && hh < 12) hh += 12
    if (ampm === 'am' && hh === 12) hh = 0
    time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    title = title.replace(m[0], '').trim()
  }

  // Clean up leftover connector words ("call mom  at " -> "call mom")
  title = title.replace(/\s{2,}/g, ' ').replace(/\s+(at|on)\s*$/i, '').trim()

  return { title: title || input.trim(), date, time }
}
