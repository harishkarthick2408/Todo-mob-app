import { LocalNotifications } from '@capacitor/local-notifications'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { parseLocalDateTime } from './recurrence.js'

// Reminders are scheduled with the OS's own alarm mechanism (AlarmManager on
// Android, via Capacitor's LocalNotifications plugin). There is deliberately
// no setInterval/polling loop anywhere in this app that "checks the time" —
// see performance requirements. The plugin registers its own
// BOOT_COMPLETED/LOCKED_BOOT_COMPLETED receiver (LocalNotificationRestoreReceiver)
// that re-arms pending alarms after a device reboot; rescheduleAll() below is
// an additional belt-and-suspenders pass run once on every app launch.

let actionsRegistered = false

export async function ensurePermissions() {
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted') {
    const req = await LocalNotifications.requestPermissions()
    return req.display === 'granted'
  }
  return true
}

export async function registerActionTypes() {
  if (actionsRegistered) return
  actionsRegistered = true
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'TASK_REMINDER',
          actions: [
            { id: 'complete', title: 'Complete' },
            { id: 'snooze', title: 'Snooze' },
            { id: 'open', title: 'Open' },
          ],
        },
      ],
    })
  } catch {
    // Action buttons are best-effort; core notification still fires without them.
  }
}

// Deterministic 32-bit id from a task id string, since the plugin wants a number.
function idFor(taskId) {
  let h = 0
  for (let i = 0; i < taskId.length; i++) {
    h = (h * 31 + taskId.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 2147483647
}

export function computeTriggerDate(task) {
  if (!task.date || !task.reminderEnabled) return null
  const base = parseLocalDateTime(task.date, task.time)
  const lead = Number.isFinite(task.reminderMinutesBefore) ? task.reminderMinutesBefore : 0
  return new Date(base.getTime() - lead * 60000)
}

export async function scheduleTaskReminder(task, settings) {
  await cancelTaskReminder(task)
  if (!settings.notificationsEnabled || !task.reminderEnabled || task.completed) return
  const trigger = computeTriggerDate(task)
  if (!trigger || trigger.getTime() <= Date.now()) return

  await registerActionTypes()
  const id = idFor(task.id)
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: task.title,
        body: task.description || (task.time ? `Due at ${task.time}` : 'Task reminder'),
        schedule: { at: trigger, allowWhileIdle: true },
        sound: settings.soundEnabled ? 'notify_soft.wav' : undefined,
        actionTypeId: 'TASK_REMINDER',
        extra: { taskId: task.id },
        smallIcon: 'ic_stat_notify',
      },
    ],
  })
}

export async function cancelTaskReminder(task) {
  const id = idFor(task.id)
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] })
  } catch {
    // fine if nothing was scheduled
  }
}

/** Re-arm every future reminder. Call once on app launch (mitigates reboot loss). */
export async function rescheduleAll(tasks, settings) {
  if (!settings.notificationsEnabled) return
  for (const t of tasks) {
    if (!t.completed && t.reminderEnabled) {
      await scheduleTaskReminder(t, settings)
    }
  }
}

export async function vibrateOnce(enabled) {
  if (!enabled) return
  try {
    await Haptics.impact({ style: ImpactStyle.Medium })
  } catch {
    if (navigator.vibrate) navigator.vibrate(120)
  }
}

export function onNotificationAction(handler) {
  LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    handler(event.actionId, event.notification?.extra?.taskId)
  })
}
