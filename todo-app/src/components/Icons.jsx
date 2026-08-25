const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const CheckIcon = (p) => (
  <svg {...base} width={p.size || 14} height={p.size || 14} stroke="#0e1310"><polyline points="20 6 9 17 4 12" /></svg>
)
export const PlusIcon = () => (<svg {...base} width={28} height={28}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>)
export const HomeIcon = () => (<svg {...base}><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10h14V10" /></svg>)
export const CalendarIcon = () => (<svg {...base}><rect x="3" y="5" width="18" height="16" rx="3" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg>)
export const StatsIcon = () => (<svg {...base}><line x1="6" y1="20" x2="6" y2="12" /><line x1="12" y1="20" x2="12" y2="6" /><line x1="18" y1="20" x2="18" y2="15" /></svg>)
export const GearIcon = () => (<svg {...base}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.9-1.5-2-3.4-2.3.7a7.7 7.7 0 0 0-2.6-1.5L14 2h-4l-.4 2.3a7.7 7.7 0 0 0-2.6 1.5l-2.3-.7-2 3.4L4.6 10a7.7 7.7 0 0 0 0 3l-1.9 1.5 2 3.4 2.3-.7c.8.65 1.65 1.15 2.6 1.5L10 22h4l.4-2.3a7.7 7.7 0 0 0 2.6-1.5l2.3.7 2-3.4z" /></svg>)
export const SearchIcon = () => (<svg {...base}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></svg>)
export const BackIcon = () => (<svg {...base}><polyline points="15 18 9 12 15 6" /></svg>)
export const TrashIcon = () => (<svg {...base} width={16} height={16}><polyline points="3 6 5 6 21 6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z" /></svg>)
export const SnoozeIcon = () => (<svg {...base} width={16} height={16}><circle cx="12" cy="13" r="8" /><polyline points="12 9 12 13 15 15" /><path d="M9 2h6" /></svg>)
export const LockIcon = () => (<svg {...base} width={26} height={26}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>)
export const BellIcon = () => (<svg {...base} width={16} height={16}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>)
export const ShieldIcon = () => (<svg {...base}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /></svg>)
export const ExportIcon = () => (<svg {...base}><path d="M12 3v12" /><polyline points="7 8 12 3 17 8" /><path d="M5 21h14" /></svg>)
export const ImportIcon = () => (<svg {...base}><path d="M12 21V9" /><polyline points="7 16 12 21 17 16" /><path d="M5 3h14" /></svg>)
