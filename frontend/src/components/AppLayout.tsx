import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTheme } from '../theme/ThemeContext'

interface NavLeaf {
  to: string
  label: string
  /** Marks this leaf active for the current path. */
  active: (path: string) => boolean
}

interface NavGroup {
  key: string
  label: string
  icon: string
  items: NavLeaf[]
}

const GROUPS: NavGroup[] = [
  {
    key: 'rfq',
    label: 'RFQ Planning',
    icon: '📋',
    items: [
      { to: '/', label: 'Projects', active: (p) => p === '/' || p.startsWith('/projects') },
      { to: '/portfolio', label: 'Portfolio', active: (p) => p.startsWith('/portfolio') },
    ],
  },
  {
    key: 'hardware',
    label: 'Hardware',
    icon: '🔧',
    items: [
      { to: '/hardware-catalog', label: 'Catalog', active: (p) => p.startsWith('/hardware-catalog') },
    ],
  },
]

// Reference palette — the sidebar stays dark in both themes (like the mockup).
const SIDEBAR = {
  bg: '#0B1220',
  border: '#1B2740',
  section: '#5A6A88',
  idle: '#C3CEDF',
  idleIcon: '#8A99B5',
  hover: '#131E36',
  blue: '#3B9EFF',
  subIdle: '#9AA8C7',
}

const SIDEBAR_KEY = 'rfq-sidebar-open'

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
    >
      <span className="text-base" aria-hidden>
        {dark ? '☀️' : '🌙'}
      </span>
    </button>
  )
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const activeGroupKey = GROUPS.find((g) => g.items.some((i) => i.active(pathname)))?.key
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.key, g.key === activeGroupKey])),
  )

  // Keep the group holding the current route expanded as navigation happens.
  useEffect(() => {
    if (activeGroupKey) setOpen((prev) => ({ ...prev, [activeGroupKey]: true }))
  }, [activeGroupKey])

  return (
    <>
      <div
        className="flex h-16 items-center gap-2.5 border-b px-4"
        style={{ borderColor: SIDEBAR.border }}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white">
          V
        </div>
        <span className="truncate text-lg font-bold tracking-tight text-white">Vehiclevo</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p
          className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: SIDEBAR.section }}
        >
          Main Menu
        </p>

        <div className="space-y-1">
          {GROUPS.map((group) => {
            const isActiveGroup = group.key === activeGroupKey
            const isOpen = open[group.key]
            return (
              <div key={group.key}>
                <button
                  onClick={() => setOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors"
                  style={{ color: isActiveGroup ? SIDEBAR.blue : SIDEBAR.idle }}
                  onMouseEnter={(e) => {
                    if (!isActiveGroup) e.currentTarget.style.backgroundColor = SIDEBAR.hover
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span
                    className="text-base"
                    aria-hidden
                    style={{ color: isActiveGroup ? SIDEBAR.blue : SIDEBAR.idleIcon }}
                  >
                    {group.icon}
                  </span>
                  <span className="flex-1 text-left">{group.label}</span>
                  <span
                    className="text-xs transition-transform"
                    aria-hidden
                    style={{ color: isActiveGroup ? SIDEBAR.blue : SIDEBAR.idleIcon }}
                  >
                    {isOpen ? '↑' : '↓'}
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-0.5 space-y-0.5 pb-1 pl-11">
                    {group.items.map((item) => {
                      const active = item.active(pathname)
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={onNavigate}
                          className="block rounded-md px-3 py-1.5 text-sm transition-colors"
                          style={{ color: active ? SIDEBAR.blue : SIDEBAR.subIdle, fontWeight: active ? 600 : 400 }}
                          onMouseEnter={(e) => {
                            if (!active) e.currentTarget.style.color = '#E2E8F5'
                          }}
                          onMouseLeave={(e) => {
                            if (!active) e.currentTarget.style.color = SIDEBAR.subIdle
                          }}
                        >
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      <div
        className="border-t px-4 py-3 text-[11px]"
        style={{ borderColor: SIDEBAR.border, color: SIDEBAR.section }}
      >
        RFQ Planner · Vehiclevo
      </div>
    </>
  )
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY)
      if (saved === '0') return false
      if (saved === '1') return true
    } catch {
      /* ignore */
    }
    return typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
  })

  const [isDesktop, setIsDesktop] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [sidebarOpen])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop sidebar — a fixed rail; only mounted on large screens */}
      {isDesktop && sidebarOpen && (
        <aside
          className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col"
          style={{ backgroundColor: SIDEBAR.bg }}
        >
          <SidebarNav />
        </aside>
      )}

      {/* Mobile drawer — off-canvas overlay; only mounted on small screens */}
      {!isDesktop && sidebarOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside
            className="absolute inset-y-0 left-0 flex w-64 flex-col"
            style={{ backgroundColor: SIDEBAR.bg }}
          >
            <SidebarNav onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <div className={`transition-all duration-200 ${isDesktop && sidebarOpen ? 'pl-64' : 'pl-0'}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle navigation"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <span className="text-lg leading-none" aria-hidden>
              ☰
            </span>
          </button>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-sm font-semibold text-slate-200"
              title="Account"
              aria-label="Account"
            >
              <span aria-hidden>👤</span>
            </button>
          </div>
        </header>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
