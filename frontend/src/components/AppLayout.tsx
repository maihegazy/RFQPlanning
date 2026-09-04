import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  ChevronDown,
  ChevronUp,
  CircleUser,
  ClipboardList,
  Cpu,
  Menu,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { useTheme } from '../theme/ThemeContext'

/** Monochrome line icons: they inherit `currentColor`, so the theme drives them. */
type NavIcon = LucideIcon

interface NavLeaf {
  to: string
  label: string
  /** Marks this leaf active for the current path. */
  active: (path: string) => boolean
}

interface NavGroup {
  key: string
  label: string
  Icon: NavIcon
  items: NavLeaf[]
}

const GROUPS: NavGroup[] = [
  {
    key: 'rfq',
    label: 'RFQ Planning',
    Icon: ClipboardList,
    items: [
      { to: '/', label: 'Projects', active: (p) => p === '/' || p.startsWith('/projects') },
      { to: '/portfolio', label: 'Portfolio', active: (p) => p.startsWith('/portfolio') },
    ],
  },
  {
    key: 'hardware',
    label: 'Hardware',
    Icon: Cpu,
    items: [
      // `startsWith('/hardware')` alone would also claim '/hardware-catalog'.
      {
        to: '/hardware',
        label: 'Overview',
        active: (p) => p === '/hardware' || (p.startsWith('/hardware/') && p !== '/hardware/process'),
      },
      { to: '/hardware-catalog', label: 'Catalog', active: (p) => p.startsWith('/hardware-catalog') },
      { to: '/hardware/process', label: 'Ordering Process', active: (p) => p === '/hardware/process' },
    ],
  },
]

const SIDEBAR_KEY = 'rfq-sidebar-open'

/**
 * Colours come from the `--sidebar-*` custom properties in index.css, which are
 * redefined under `[data-theme='light']` — so the rail follows the app's theme
 * instead of staying dark on a light page.
 */
const SIDEBAR_SURFACE = 'bg-[var(--sidebar-bg)] text-[var(--sidebar-idle)]'

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
    >
      {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
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
      <div className="flex h-16 items-center gap-2.5 border-b border-[var(--sidebar-border)] px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white">
          V
        </div>
        <span className="truncate text-lg font-bold tracking-tight text-[var(--sidebar-brand)]">
          Vehiclevo
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--sidebar-section)]">
          Main Menu
        </p>

        <div className="space-y-1">
          {GROUPS.map(({ key, label, Icon, items }) => {
            const isActiveGroup = key === activeGroupKey
            const isOpen = open[key]
            const Chevron = isOpen ? ChevronUp : ChevronDown
            return (
              <div key={key}>
                <button
                  onClick={() => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--sidebar-hover)] ${
                    isActiveGroup ? 'text-[var(--sidebar-accent)]' : 'text-[var(--sidebar-idle)]'
                  }`}
                >
                  <Icon
                    className={`h-4.5 w-4.5 shrink-0 ${
                      isActiveGroup ? 'text-[var(--sidebar-accent)]' : 'text-[var(--sidebar-idle-icon)]'
                    }`}
                    strokeWidth={1.75}
                  />
                  <span className="flex-1 text-left">{label}</span>
                  <Chevron
                    className={`h-4 w-4 shrink-0 ${
                      isActiveGroup ? 'text-[var(--sidebar-accent)]' : 'text-[var(--sidebar-idle-icon)]'
                    }`}
                    strokeWidth={2}
                  />
                </button>

                {isOpen && (
                  <div className="mt-0.5 space-y-0.5 pb-1 pl-8">
                    {items.map((item) => {
                      const active = item.active(pathname)
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          // The active leaf carries a left rail as well as the accent
                          // colour, so the state does not rely on hue alone.
                          className={`block border-l-2 py-1.5 pl-3 pr-3 text-sm transition-colors ${
                            active
                              ? 'border-[var(--sidebar-accent)] font-semibold text-[var(--sidebar-accent)]'
                              : 'border-transparent text-[var(--sidebar-sub-idle)] hover:text-[var(--sidebar-hover-text)]'
                          }`}
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

      <div className="border-t border-[var(--sidebar-border)] px-4 py-3 text-[11px] text-[var(--sidebar-section)]">
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
          className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-[var(--sidebar-border)] ${SIDEBAR_SURFACE}`}
        >
          <SidebarNav />
        </aside>
      )}

      {/* Mobile drawer — off-canvas overlay; only mounted on small screens */}
      {!isDesktop && sidebarOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside
            className={`absolute inset-y-0 left-0 flex w-64 flex-col border-r border-[var(--sidebar-border)] ${SIDEBAR_SURFACE}`}
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
            aria-expanded={sidebarOpen}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-200 transition-colors hover:text-slate-100"
              title="Account"
              aria-label="Account"
            >
              <CircleUser className="h-5 w-5" strokeWidth={1.75} />
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
