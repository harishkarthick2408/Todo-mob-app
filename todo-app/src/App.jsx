import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { loadState, saveState, wipeAllData, defaultCategories } from './lib/db.js'
import { todayStr, nextOccurrence, parseLocalDateTime } from './lib/recurrence.js'
import { parseQuickTask } from './lib/nlp.js'
import { hashPin, verifyPin, encryptBackup, decryptBackup } from './lib/crypto.js'
import {
  ensurePermissions,
  scheduleTaskReminder,
  cancelTaskReminder,
  rescheduleAll,
  vibrateOnce,
  onNotificationAction,
} from './lib/notifications.js'
import { Preferences } from '@capacitor/preferences'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  PlusIcon, HomeIcon, CalendarIcon, StatsIcon, GearIcon, SearchIcon, BackIcon,
  TrashIcon, SnoozeIcon, LockIcon, BellIcon, ShieldIcon, ExportIcon, ImportIcon, CheckIcon,
} from './components/Icons.jsx'

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function greetingFor(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]
const SNOOZE_OPTS = [5, 10, 15, 30]
const REMINDER_OPTS = [
  { v: 0, label: 'At time' },
  { v: 10, label: '10 min before' },
  { v: 30, label: '30 min before' },
  { v: 60, label: '1 hour before' },
]

export default function App() {
  const [state, setState] = useState(null)
  const [tab, setTab] = useState('home')
  const [locked, setLocked] = useState(false)
  const [sheet, setSheet] = useState(null) // { mode: 'add'|'edit', task }
  const [toast, setToast] = useState(null)
  const [snoozeFor, setSnoozeFor] = useState(null)
  const stateRef = useRef(null)
  stateRef.current = state

  // ---- boot ----
  useEffect(() => {
    (async () => {
      const s = await loadState()
      setState(s)
      setLocked(!!s.settings.appLockEnabled)
      await ensurePermissions()
      await rescheduleAll(s.tasks, s.settings)
      onNotificationAction(async (actionId, taskId) => {
        const cur = stateRef.current
        if (!cur) return
        if (actionId === 'complete') toggleComplete(taskId, cur)
        if (actionId === 'snooze') snoozeTask(taskId, cur.settings.defaultSnoozeMinutes, cur)
      })
    })()
  }, [])

  // ---- persist on every change ----
  useEffect(() => {
    if (state) saveState(state)
  }, [state])

  // ---- theme ----
  useEffect(() => {
    if (!state) return
    const t = state.settings.theme
    const resolved = t === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : t
    document.documentElement.setAttribute('data-theme', resolved)
  }, [state?.settings.theme])

  function showToast(msg, actionLabel, onAction) {
    setToast({ msg, actionLabel, onAction })
    setTimeout(() => setToast(null), 3200)
  }

  // ---- task ops ----
  function upsertTask(task) {
    setState((prev) => {
      const exists = prev.tasks.some((t) => t.id === task.id)
      const tasks = exists ? prev.tasks.map((t) => (t.id === task.id ? task : t)) : [task, ...prev.tasks]
      scheduleTaskReminder(task, prev.settings)
      return { ...prev, tasks }
    })
  }

  function deleteTask(id) {
    setState((prev) => {
      const t = prev.tasks.find((x) => x.id === id)
      if (t) cancelTaskReminder(t)
      return { ...prev, tasks: prev.tasks.filter((x) => x.id !== id) }
    })
  }

  function toggleComplete(id, curState) {
    const cur = curState || stateRef.current
    const task = cur.tasks.find((t) => t.id === id)
    if (!task) return
    const nowCompleting = !task.completed
    vibrateOnce(cur.settings.vibrationEnabled)

    setState((prev) => {
      let tasks = prev.tasks.map((t) => (t.id === id ? { ...t, completed: nowCompleting, completedAt: nowCompleting ? Date.now() : null } : t))
      const log = { ...prev.settings.completionLog }
      const day = todayStr()
      if (nowCompleting) {
        log[day] = (log[day] || 0) + 1
        // handle recurrence: spawn next occurrence
        const nxt = nextOccurrence(task, task.date)
        if (nxt) {
          tasks = [{ ...task, id: uid(), date: nxt, completed: false, completedAt: null, createdAt: Date.now() }, ...tasks]
        }
      } else if (log[day]) {
        log[day] = Math.max(0, log[day] - 1)
      }
      const updatedTask = tasks.find((t) => t.id === id)
      if (updatedTask) {
        if (nowCompleting) cancelTaskReminder(updatedTask)
        else scheduleTaskReminder(updatedTask, prev.settings)
      }
      return { ...prev, tasks, settings: { ...prev.settings, completionLog: log } }
    })
  }

  function snoozeTask(id, minutes, curState) {
    const cur = curState || stateRef.current
    setState((prev) => {
      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t
        const base = new Date(Date.now() + minutes * 60000)
        const date = todayStr(base)
        const time = `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`
        const updated = { ...t, date, time, reminderMinutesBefore: 0 }
        scheduleTaskReminder(updated, prev.settings)
        return updated
      })
      return { ...prev, tasks }
    })
    showToast(`Snoozed ${minutes} min`)
  }

  function updateSettings(patch) {
    setState((prev) => {
      const nextSettings = { ...prev.settings, ...patch }
      rescheduleAll(prev.tasks, nextSettings)
      return { ...prev, settings: nextSettings }
    })
  }

  if (!state) {
    return <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>Loading…</div>
    </div>
  }

  if (locked) {
    return <LockScreen settings={state.settings} onUnlock={() => setLocked(false)} />
  }

  return (
    <div className="app-shell">
      <div className="scroll-area">
        {tab === 'home' && (
          <HomeScreen state={state} onToggle={(id) => toggleComplete(id)} onEdit={(t) => setSheet({ mode: 'edit', task: t })} onDelete={deleteTask} onSnooze={(id) => setSnoozeFor(id)} onQuickAdd={(text) => {
            const parsed = parseQuickTask(text)
            const task = {
              id: uid(), title: parsed.title, description: '', date: parsed.date, time: parsed.time,
              priority: 'medium', category: 'personal', completed: false, completedAt: null,
              createdAt: Date.now(), repeat: 'none', repeatDays: [], reminderEnabled: !!parsed.time,
              reminderMinutesBefore: state.settings.defaultReminderMinutes,
            }
            upsertTask(task)
            showToast('Task added')
          }} />
        )}
        {tab === 'calendar' && <CalendarScreen state={state} onEdit={(t) => setSheet({ mode: 'edit', task: t })} onToggle={(id) => toggleComplete(id)} onAddForDate={(date) => setSheet({ mode: 'add', task: { date } })} />}
        {tab === 'search' && <SearchScreen state={state} onEdit={(t) => setSheet({ mode: 'edit', task: t })} onToggle={(id) => toggleComplete(id)} />}
        {tab === 'stats' && <StatsScreen state={state} />}
        {tab === 'settings' && (
          <SettingsScreen
            state={state}
            onUpdateSettings={updateSettings}
            onWipe={async () => { await wipeAllData(); setState((p) => ({ ...p, tasks: [], settings: { ...p.settings, completionLog: {} } })); showToast('All data deleted') }}
            onToast={showToast}
          />
        )}
      </div>

      <button className="fab" aria-label="Add task" onClick={() => setSheet({ mode: 'add', task: { date: todayStr() } })}>
        <PlusIcon />
      </button>

      <nav className="bottom-nav">
        <NavBtn icon={<HomeIcon />} label="Today" active={tab === 'home'} onClick={() => setTab('home')} />
        <NavBtn icon={<CalendarIcon />} label="Calendar" active={tab === 'calendar'} onClick={() => setTab('calendar')} />
        <NavBtn icon={<SearchIcon />} label="Search" active={tab === 'search'} onClick={() => setTab('search')} />
        <NavBtn icon={<StatsIcon />} label="Stats" active={tab === 'stats'} onClick={() => setTab('stats')} />
        <NavBtn icon={<GearIcon />} label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </nav>

      {sheet && (
        <TaskSheet
          mode={sheet.mode}
          initial={sheet.task}
          categories={state.categories}
          defaultReminderMinutes={state.settings.defaultReminderMinutes}
          onCancel={() => setSheet(null)}
          onSave={(task) => { upsertTask(task); setSheet(null); showToast(sheet.mode === 'add' ? 'Task saved' : 'Task updated') }}
          onDelete={sheet.mode === 'edit' ? () => { deleteTask(sheet.task.id); setSheet(null); showToast('Task deleted') } : null}
        />
      )}

      {snoozeFor && (
        <SnoozeSheet onPick={(m) => { snoozeTask(snoozeFor, m); setSnoozeFor(null) }} onCancel={() => setSnoozeFor(null)} />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.actionLabel && <button onClick={() => { toast.onAction?.(); setToast(null) }}>{toast.actionLabel}</button>}
        </div>
      )}
    </div>
  )
}

function NavBtn({ icon, label, active, onClick }) {
  return (
    <button className={`nav-btn${active ? ' active' : ''}`} onClick={onClick} aria-current={active}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ================= HOME =================
function HomeScreen({ state, onToggle, onEdit, onDelete, onSnooze, onQuickAdd }) {
  const [quick, setQuick] = useState('')
  const today = todayStr()
  const todays = state.tasks.filter((t) => t.date === today).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
  const pending = todays.filter((t) => !t.completed)
  const done = todays.filter((t) => t.completed)
  const total = todays.length
  const pct = total ? Math.round((done.length / total) * 100) : 0
  const name = 'Harish'

  const overdue = state.tasks.filter((t) => !t.completed && t.date < today)

  return (
    <div>
      <div className="home-header">
        <h1 className="greeting">{greetingFor()}, {name} 👋</h1>
        <div className="date-line">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div className="privacy-badge"><span className="dot" /> Stored only on this device</div>
      </div>

      <div className="progress-card">
        <div className="ring-wrap">
          <ProgressRing pct={pct} />
          <div className="ring-center">{pct}%</div>
        </div>
        <div>
          <p className="progress-title">Today's progress</p>
          <p className="progress-sub">{done.length} of {total || 0} tasks completed</p>
        </div>
      </div>

      <div className="field-label" style={{ margin: '20px 2px 8px' }}>Quick add</div>
      <form onSubmit={(e) => { e.preventDefault(); if (quick.trim()) { onQuickAdd(quick); setQuick('') } }}>
        <input
          className="text-input"
          placeholder='Try "Call mom at 7pm"'
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
      </form>

      {overdue.length > 0 && (
        <>
          <div className="section-label">Overdue</div>
          <div className="task-list">
            {overdue.map((t) => <TaskCard key={t.id} task={t} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onSnooze={onSnooze} />)}
          </div>
        </>
      )}

      <div className="section-label">Today</div>
      {pending.length === 0 && done.length === 0 && (
        <div className="empty-state">
          <div className="glyph">🌿</div>
          <p>Nothing scheduled for today.</p>
          <p>Tap the + button or use quick add above.</p>
        </div>
      )}
      <div className="task-list">
        {pending.map((t) => <TaskCard key={t.id} task={t} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onSnooze={onSnooze} />)}
      </div>

      {done.length > 0 && (
        <>
          <div className="section-label">Completed</div>
          <div className="task-list">
            {done.map((t) => <TaskCard key={t.id} task={t} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onSnooze={onSnooze} />)}
          </div>
        </>
      )}
    </div>
  )
}

function ProgressRing({ pct }) {
  const r = 27, c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <svg width="64" height="64">
      <circle cx="32" cy="32" r={r} stroke="var(--surface-3)" strokeWidth="6" fill="none" />
      <circle cx="32" cy="32" r={r} stroke="var(--accent)" strokeWidth="6" fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
    </svg>
  )
}

// ================= TASK CARD (swipe) =================
function TaskCard({ task, onToggle, onEdit, onDelete, onSnooze }) {
  const [dx, setDx] = useState(0)
  const startX = useRef(null)
  const dragging = useRef(false)

  function onTouchStart(e) {
    startX.current = e.touches[0].clientX
    dragging.current = true
  }
  function onTouchMove(e) {
    if (!dragging.current) return
    const delta = e.touches[0].clientX - startX.current
    setDx(Math.max(-90, Math.min(90, delta)))
  }
  function onTouchEnd() {
    dragging.current = false
    if (dx > 55) { onToggle(task.id) }
    else if (dx < -55) { onSnooze(task.id) }
    setDx(0)
  }

  const cat = task.category
  return (
    <div className="task-swipe-outer">
      <div className="task-swipe-bg right" style={{ opacity: dx > 10 ? 1 : 0 }}>Complete</div>
      <div className="task-swipe-bg left" style={{ opacity: dx < -10 ? 1 : 0 }}>Snooze</div>
      <div
        className={`task-card priority-${task.priority}${task.completed ? ' completed' : ''}`}
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => onEdit(task)}
      >
        <button
          className={`checkbox-btn${task.completed ? ' checked' : ''}`}
          onClick={() => onToggle(task.id)}
          aria-label={task.completed ? 'Mark as not done' : 'Mark as done'}
        >
          <CheckIcon />
        </button>
        <div className="task-body" onClick={() => onEdit(task)}>
          <p className={`task-title${task.completed ? ' done' : ''}`}>{task.title}</p>
          <div className="task-meta">
            {task.time && <span className="task-time">{formatTime(task.time)}</span>}
            {!task.completed ? (
              <span className={`pill ${task.priority}`}>{task.priority[0].toUpperCase() + task.priority.slice(1)} priority</span>
            ) : (
              <span className="pill done-pill">Completed</span>
            )}
            {task.repeat && task.repeat !== 'none' && <span className="pill cat">↻ {task.repeat}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`
}

// ================= ADD / EDIT SHEET =================
function TaskSheet({ mode, initial, categories, defaultReminderMinutes, onSave, onCancel, onDelete }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [date, setDate] = useState(initial?.date || todayStr())
  const [time, setTime] = useState(initial?.time || '')
  const [priority, setPriority] = useState(initial?.priority || 'medium')
  const [category, setCategory] = useState(initial?.category || 'personal')
  const [repeat, setRepeat] = useState(initial?.repeat || 'none')
  const [reminderEnabled, setReminderEnabled] = useState(initial?.reminderEnabled ?? true)
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState(
    initial?.reminderMinutesBefore ?? defaultReminderMinutes ?? 0
  )

  function save() {
    if (!title.trim()) return
    onSave({
      id: initial?.id || uid(),
      title: title.trim(),
      description: description.trim(),
      date, time: time || null,
      priority, category, repeat, repeatDays: initial?.repeatDays || [],
      completed: initial?.completed || false,
      completedAt: initial?.completedAt || null,
      createdAt: initial?.createdAt || Date.now(),
      reminderEnabled: reminderEnabled && !!time,
      reminderMinutesBefore: Number(reminderMinutesBefore),
    })
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="field-label mt0">What needs to be done?</div>
        <input className="text-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Complete project report" />

        <div className="field-label">Description (optional)</div>
        <textarea className="textarea-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add notes…" />

        <div className="field-label">When?</div>
        <div className="chip-row">
          <input type="date" className="text-input" style={{ width: 'auto', flex: 1 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" className="text-input" style={{ width: 'auto', flex: 1 }} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>

        <div className="field-label">Priority</div>
        <div className="chip-row">
          {PRIORITIES.map((p) => (
            <button key={p.id} className={`chip priority-${p.id}${priority === p.id ? ' selected' : ''}`} onClick={() => setPriority(p.id)}>{p.label}</button>
          ))}
        </div>

        <div className="field-label">Category</div>
        <div className="chip-row">
          {categories.map((c) => (
            <button key={c.id} className={`chip${category === c.id ? ' selected' : ''}`} onClick={() => setCategory(c.id)}>{c.icon} {c.name}</button>
          ))}
        </div>

        <div className="field-label">Repeat</div>
        <div className="chip-row">
          {[{ id: 'none', label: "Doesn't repeat" }, { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }].map((r) => (
            <button key={r.id} className={`chip${repeat === r.id ? ' selected' : ''}`} onClick={() => setRepeat(r.id)}>{r.label}</button>
          ))}
        </div>

        <div className="field-label">Reminder</div>
        <div className="chip-row">
          <button className={`chip${!reminderEnabled ? ' selected' : ''}`} onClick={() => setReminderEnabled(false)}>Off</button>
          {REMINDER_OPTS.map((o) => (
            <button key={o.v} className={`chip${reminderEnabled && reminderMinutesBefore === o.v ? ' selected' : ''}`}
              onClick={() => { setReminderEnabled(true); setReminderMinutesBefore(o.v) }}>🔔 {o.label}</button>
          ))}
        </div>
        {reminderEnabled && !time && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>Set a time above to enable this reminder.</div>}

        <div className="sheet-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!title.trim()}>Save Task</button>
        </div>
        {onDelete && (
          <button className="btn danger" style={{ width: '100%', marginTop: 10 }} onClick={onDelete}>
            <span className="row gap" style={{ justifyContent: 'center' }}><TrashIcon /> Delete task</span>
          </button>
        )}
      </div>
    </div>
  )
}

function SnoozeSheet({ onPick, onCancel }) {
  const [custom, setCustom] = useState('')
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="field-label mt0">Snooze for</div>
        <div className="chip-row">
          {SNOOZE_OPTS.map((m) => (
            <button key={m} className="chip" onClick={() => onPick(m)}>{m} min</button>
          ))}
        </div>
        <div className="field-label">Custom (minutes)</div>
        <div className="row gap">
          <input className="text-input" type="number" min="1" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn primary" style={{ flex: '0 0 auto' }} disabled={!custom} onClick={() => onPick(Number(custom))}>Set</button>
        </div>
        <div className="sheet-actions"><button className="btn" onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  )
}

// ================= CALENDAR =================
function CalendarScreen({ state, onEdit, onToggle, onAddForDate }) {
  const [cursor, setCursor] = useState(new Date())
  const [selected, setSelected] = useState(todayStr())

  const year = cursor.getFullYear(), month = cursor.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const tasksByDate = useMemo(() => {
    const m = {}
    for (const t of state.tasks) { (m[t.date] ||= []).push(t) }
    return m
  }, [state.tasks])

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const selectedTasks = (tasksByDate[selected] || []).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))

  return (
    <div>
      <div className="cal-header">
        <button className="icon-btn" onClick={() => setCursor(new Date(year, month - 1, 1))}><BackIcon /></button>
        <h2>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button className="icon-btn" onClick={() => setCursor(new Date(year, month + 1, 1))} style={{ transform: 'rotate(180deg)' }}><BackIcon /></button>
      </div>
      <div className="cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="cal-dow">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const ds = dateStr(d)
          const has = (tasksByDate[ds] || []).length > 0
          return (
            <button key={i}
              className={`cal-cell${ds === todayStr() ? ' today' : ''}${ds === selected ? ' selected' : ''}`}
              onClick={() => setSelected(ds)}>
              {d}
              {has && <span className="cal-dot" />}
            </button>
          )
        })}
      </div>

      <div className="section-label">{selected === todayStr() ? 'Today' : new Date(selected + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <div className="task-list">
        {selectedTasks.map((t) => <TaskCard key={t.id} task={t} onToggle={onToggle} onEdit={onEdit} onDelete={() => {}} onSnooze={() => {}} />)}
      </div>
      {selectedTasks.length === 0 && (
        <div className="empty-state"><div className="glyph">📅</div><p>No tasks on this date.</p></div>
      )}
      <button className="btn primary" style={{ width: '100%', marginTop: 16 }} onClick={() => onAddForDate(selected)}>+ Add task for this date</button>
    </div>
  )
}

// ================= SEARCH / FILTER =================
function SearchScreen({ state, onEdit, onToggle }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const today = todayStr()

  const results = useMemo(() => {
    let list = state.tasks
    if (filter === 'today') list = list.filter((t) => t.date === today)
    if (filter === 'upcoming') list = list.filter((t) => t.date > today && !t.completed)
    if (filter === 'completed') list = list.filter((t) => t.completed)
    if (filter === 'pending') list = list.filter((t) => !t.completed)
    if (filter === 'high') list = list.filter((t) => t.priority === 'high')
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(needle) || (t.description || '').toLowerCase().includes(needle))
    }
    return list.sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')))
  }, [state.tasks, q, filter, today])

  const filters = [
    { id: 'all', label: 'All' }, { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' },
    { id: 'pending', label: 'Pending' }, { id: 'completed', label: 'Completed' }, { id: 'high', label: 'High priority' },
  ]

  return (
    <div>
      <div className="section-label" style={{ margin: '0 4px 10px' }}>Search</div>
      <div className="search-bar">
        <SearchIcon />
        <input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="filter-row">
        {filters.map((f) => (
          <button key={f.id} className={`chip${filter === f.id ? ' selected' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="section-label">{results.length} result{results.length === 1 ? '' : 's'}</div>
      <div className="task-list">
        {results.map((t) => <TaskCard key={t.id} task={t} onToggle={onToggle} onEdit={onEdit} onDelete={() => {}} onSnooze={() => {}} />)}
      </div>
      {results.length === 0 && <div className="empty-state"><div className="glyph">🔍</div><p>No matching tasks.</p></div>}
    </div>
  )
}

// ================= STATS =================
function StatsScreen({ state }) {
  const today = todayStr()
  const log = state.settings.completionLog || {}
  const completedToday = log[today] || 0

  const weekDates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    weekDates.push(todayStr(d))
  }
  const completedThisWeek = weekDates.reduce((sum, d) => sum + (log[d] || 0), 0)

  const totalTasks = state.tasks.length
  const totalCompleted = state.tasks.filter((t) => t.completed).length
  const completionPct = totalTasks ? Math.round((totalCompleted / totalTasks) * 100) : 0

  let streak = 0
  { let cursor = new Date()
    while (true) {
      const ds = todayStr(cursor)
      if (log[ds] > 0) { streak++; cursor.setDate(cursor.getDate() - 1) } else break
    }
  }
  let best = 0, run = 0
  const allDates = Object.keys(log).sort()
  let prevDate = null
  for (const ds of allDates) {
    if (log[ds] > 0) {
      if (prevDate) {
        const diff = (new Date(ds) - new Date(prevDate)) / 86400000
        run = diff === 1 ? run + 1 : 1
      } else run = 1
      best = Math.max(best, run)
      prevDate = ds
    }
  }
  best = Math.max(best, streak)

  return (
    <div>
      <div className="section-label" style={{ margin: '0 4px 10px' }}>Your progress</div>
      <div className="stat-grid">
        <div className="stat-card"><p className="stat-num">{completedToday}</p><p className="stat-label">Completed today</p></div>
        <div className="stat-card"><p className="stat-num">{completedThisWeek}</p><p className="stat-label">Completed this week</p></div>
        <div className="stat-card"><p className="stat-num">{completionPct}%</p><p className="stat-label">Overall completion</p></div>
        <div className="stat-card"><p className="stat-num">{best}</p><p className="stat-label">Best streak (days)</p></div>
      </div>
      <div className="streak-card">
        <div className="streak-fire">🔥</div>
        <p className="streak-num">{streak} day{streak === 1 ? '' : 's'}</p>
        <p className="streak-msg">{streak === 0 ? 'Complete a task today to start a streak.' : "You're building a great habit!"}</p>
      </div>
    </div>
  )
}

// ================= SETTINGS =================
function SettingsScreen({ state, onUpdateSettings, onWipe, onToast }) {
  const s = state.settings
  const [pinSetup, setPinSetup] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [backupOpen, setBackupOpen] = useState(null) // 'export' | 'import'

  return (
    <div>
      <div className="section-label" style={{ margin: '0 4px 10px' }}>Settings</div>

      <div className="settings-group-title">Notifications</div>
      <div className="settings-group">
        <SettingsRow label="Reminders" sub="Show notifications for tasks" toggle checked={s.notificationsEnabled} onChange={(v) => onUpdateSettings({ notificationsEnabled: v })} />
        <SettingsRow label="Sound" toggle checked={s.soundEnabled} onChange={(v) => onUpdateSettings({ soundEnabled: v })} />
        <SettingsRow label="Vibration" toggle checked={s.vibrationEnabled} onChange={(v) => onUpdateSettings({ vibrationEnabled: v })} />
        <div className="settings-row">
          <div><div className="settings-row-label">Default reminder</div></div>
          <select className="select-input" value={s.defaultReminderMinutes} onChange={(e) => onUpdateSettings({ defaultReminderMinutes: Number(e.target.value) })}>
            {REMINDER_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <div><div className="settings-row-label">Default snooze</div></div>
          <select className="select-input" value={s.defaultSnoozeMinutes} onChange={(e) => onUpdateSettings({ defaultSnoozeMinutes: Number(e.target.value) })}>
            {SNOOZE_OPTS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
      </div>

      <div className="settings-group-title">Appearance</div>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">Theme</div>
          <select className="select-input" value={s.theme} onChange={(e) => onUpdateSettings({ theme: e.target.value })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <div className="settings-group-title">Security</div>
      <div className="settings-group">
        <SettingsRow label="App lock" sub="Require a PIN to open the app" toggle checked={s.appLockEnabled} onChange={(v) => {
          if (v && !s.pin) setPinSetup(true)
          else onUpdateSettings({ appLockEnabled: v })
        }} />
        {s.appLockEnabled && (
          <div className="settings-row">
            <div className="settings-row-label">Change PIN</div>
            <button className="btn" style={{ flex: '0 0 auto', padding: '8px 14px' }} onClick={() => setPinSetup(true)}>Update</button>
          </div>
        )}
        {s.appLockEnabled && (
          <div className="settings-row">
            <div className="settings-row-label">Auto-lock</div>
            <select className="select-input" value={s.autoLockMinutes} onChange={(e) => onUpdateSettings({ autoLockMinutes: Number(e.target.value) })}>
              <option value={0}>Immediately</option>
              <option value={1}>After 1 minute</option>
              <option value={5}>After 5 minutes</option>
            </select>
          </div>
        )}
      </div>

      <div className="settings-group-title">Privacy</div>
      <div className="settings-group">
        <div className="settings-row"><div className="settings-row-label row gap"><ShieldIcon />&nbsp;Local-only storage</div><span style={{ color: 'var(--accent-strong)', fontSize: 13, fontWeight: 700 }}>Active</span></div>
        <div className="settings-row"><div className="settings-row-label">Cloud sync</div><span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Never</span></div>
        <div className="settings-row"><div className="settings-row-label">Analytics &amp; tracking</div><span style={{ color: 'var(--text-dim)', fontSize: 13 }}>None</span></div>
      </div>

      <div className="settings-group-title">Data</div>
      <div className="settings-group">
        <div className="settings-row" onClick={() => setBackupOpen('export')} style={{ cursor: 'pointer' }}>
          <div className="settings-row-label row gap"><ExportIcon />&nbsp;Export encrypted backup</div>
        </div>
        <div className="settings-row" onClick={() => setBackupOpen('import')} style={{ cursor: 'pointer' }}>
          <div className="settings-row-label row gap"><ImportIcon />&nbsp;Restore from backup</div>
        </div>
        <div className="settings-row" onClick={() => setConfirmWipe(true)} style={{ cursor: 'pointer' }}>
          <div className="settings-row-label" style={{ color: 'var(--high)' }}>Delete all data</div>
        </div>
      </div>

      <div className="settings-group-title">About</div>
      <div className="settings-group">
        <div className="settings-row"><div className="settings-row-label">Version</div><span style={{ color: 'var(--text-dim)', fontSize: 13 }}>1.0.0</span></div>
        <div className="settings-row"><div className="settings-row-label">Privacy</div><span style={{ color: 'var(--text-dim)', fontSize: 13 }}>No network calls, ever</span></div>
      </div>

      {pinSetup && (
        <PinSetupSheet onCancel={() => setPinSetup(false)} onSave={async (pin) => {
          const hashed = await hashPin(pin)
          onUpdateSettings({ pin: hashed, appLockEnabled: true })
          setPinSetup(false)
          onToast('App lock enabled')
        }} />
      )}

      {confirmWipe && (
        <ConfirmSheet
          title="Delete all data?"
          body="This permanently deletes every task and setting stored on this device. This cannot be undone."
          confirmLabel="Delete everything"
          danger
          onCancel={() => setConfirmWipe(false)}
          onConfirm={() => { onWipe(); setConfirmWipe(false) }}
        />
      )}

      {backupOpen && (
        <BackupSheet mode={backupOpen} state={state} onClose={() => setBackupOpen(null)} onToast={onToast} onRestore={(data) => {
          // caller replaces state entirely
          onUpdateSettings(data.settings)
        }} />
      )}
    </div>
  )
}

function SettingsRow({ label, sub, toggle, checked, onChange }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      {toggle && (
        <button className={`switch${checked ? ' on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
          <span className="switch-knob" />
        </button>
      )}
    </div>
  )
}

function PinSetupSheet({ onCancel, onSave }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  function submit() {
    if (pin.length < 4) return setError('PIN must be at least 4 digits')
    if (pin !== confirm) return setError("PINs don't match")
    onSave(pin)
  }
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="field-label mt0">New PIN</div>
        <input className="text-input" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <div className="field-label">Confirm PIN</div>
        <input className="text-input" type="password" inputMode="numeric" maxLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} />
        {error && <div className="pin-error">{error}</div>}
        <div className="sheet-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={submit}>Save PIN</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmSheet({ title, body, confirmLabel, danger, onCancel, onConfirm }) {
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="lock-title" style={{ fontSize: 18 }}>{title}</div>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>{body}</p>
        <div className="sheet-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function BackupSheet({ mode, state, onClose, onToast }) {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function doExport() {
    if (password.length < 6) return setError('Use a password with at least 6 characters')
    if (password !== password2) return setError("Passwords don't match")
    setBusy(true)
    try {
      const json = JSON.stringify({ tasks: state.tasks, categories: state.categories, settings: { ...state.settings, pin: state.settings.pin } })
      const blob = await encryptBackup(json, password)
      const filename = `privado-backup-${todayStr()}.json`
      const content = JSON.stringify(blob)
      await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 })
      const uriRes = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
      try {
        await Share.share({ title: 'Privado backup', url: uriRes.uri })
      } catch {
        onToast('Backup saved to app cache: ' + filename)
      }
      onToast('Encrypted backup created')
      onClose()
    } catch (e) {
      setError('Could not create backup. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {mode === 'export' ? (
          <>
            <div className="field-label mt0">Backup password</div>
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>This encrypts your tasks into a single file using this password. You'll need it to restore — Privado cannot recover a lost backup password.</p>
            <input className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            <div className="field-label">Confirm password</div>
            <input className="text-input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} placeholder="Confirm password" />
            {error && <div className="pin-error">{error}</div>}
            <div className="sheet-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={doExport}>{busy ? 'Encrypting…' : 'Create backup'}</button>
            </div>
          </>
        ) : (
          <ImportBackup onClose={onClose} onToast={onToast} />
        )}
      </div>
    </div>
  )
}

function ImportBackup({ onClose, onToast }) {
  const [raw, setRaw] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function pickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    setRaw(text)
  }

  async function doImport() {
    setBusy(true); setError('')
    try {
      const blob = JSON.parse(raw)
      const json = await decryptBackup(blob, password)
      const data = JSON.parse(json)
      const cur = await loadState()
      const merged = { ...cur, tasks: [...data.tasks, ...cur.tasks], categories: data.categories || cur.categories, settings: { ...cur.settings, ...data.settings } }
      await saveState(merged)
      onToast('Backup restored — reload to see it')
      onClose()
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setError(e.message === 'WRONG_PASSWORD_OR_CORRUPT' ? 'Wrong password, or the file is corrupted.' : 'Could not read this backup file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="field-label mt0">Backup file</div>
      <input className="text-input" type="file" accept=".json" onChange={pickFile} />
      <div className="field-label">Backup password</div>
      <input className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <div className="pin-error">{error}</div>}
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!raw || !password || busy} onClick={doImport}>{busy ? 'Restoring…' : 'Restore'}</button>
      </div>
    </>
  )
}

// ================= LOCK SCREEN =================
function LockScreen({ settings, onUnlock }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (pin.length >= 4) {
      verifyPin(pin, settings.pin).then((ok) => {
        if (ok) onUnlock()
        else { setError('Incorrect PIN'); setTimeout(() => { setPin(''); setError('') }, 500) }
      })
    }
  }, [pin])

  return (
    <div className="lock-screen">
      <div className="lock-icon"><LockIcon /></div>
      <h2 className="lock-title">Privado is locked</h2>
      <p className="lock-sub">Enter your PIN to continue</p>
      <div className="pin-dots">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`pin-dot${pin.length > i ? ' filled' : ''}`} />)}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
          k === '' ? <div key={i} /> :
          <button key={i} className="pin-key" onClick={() => {
            if (k === '⌫') setPin((p) => p.slice(0, -1))
            else if (pin.length < 8) setPin((p) => p + k)
          }}>{k}</button>
        ))}
      </div>
      <div className="pin-error">{error}</div>
    </div>
  )
}
