// Dates are handled as local calendar dates (YYYY-MM-DD) + local HH:MM time,
// always resolved against the device's current timezone — never UTC math —
// so DST and timezone changes are handled correctly by construction.

export function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!timeStr) return new Date(y, m - 1, d, 23, 59, 0)
  const [hh, mm] = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0)
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return todayStr(dt)
}

/**
 * Given a task's repeat rule and its current date, return the next date
 * (YYYY-MM-DD) strictly after `fromDate`, or null if it doesn't repeat.
 */
export function nextOccurrence(task, fromDate) {
  if (!task.repeat || task.repeat === 'none') return null
  if (task.repeat === 'daily') return addDays(fromDate, 1)
  if (task.repeat === 'weekly') return addDays(fromDate, 7)
  if (task.repeat === 'custom' && Array.isArray(task.repeatDays) && task.repeatDays.length) {
    // repeatDays: 0=Sun..6=Sat. Find the next matching weekday after fromDate.
    for (let i = 1; i <= 14; i++) {
      const candidate = addDays(fromDate, i)
      const [y, m, d] = candidate.split('-').map(Number)
      const dow = new Date(y, m - 1, d).getDay()
      if (task.repeatDays.includes(dow)) return candidate
    }
  }
  return null
}

export function isSameOrBeforeToday(dateStr) {
  return dateStr <= todayStr()
}
