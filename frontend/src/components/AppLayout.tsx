import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTheme } from '../theme/ThemeContext'

interface NavItem {
  to: string
  label: string
  end?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    title: 'RFQ Planning',
    items: [
      { to: '/', label: 'Projects', end: true },
      { to: '/portfolio', label: 'Portfolio' },
    ],
  },
  {
    title: 'Modules',
    items: [{ to: '/hardware-catalog', label: 'Hardware Catalog' }],
  },
]

const SIDEBAR_KEY = 'rfq-sidebar-collapsed'

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

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white">
          V
        </div>
        {!collapsed && (
          <span className="truncate text-lg font-bold tracking-tight text-slate-100">
            Vehiclevo
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-6 last:mb-0">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      collapsed ? 'justify-center' : ''
                    } ${
                      isActive
                        ? 'bg-indigo-600/15 text-indigo-300'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                    }`
                  }
                >
                  {collapsed ? (
                    <span className="font-semibold" aria-hidden>
                      {item.label.charAt(0)}
                    </span>
                  ) : (
                    <span className="truncate">{item.label}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="border-t border-slate-800 px-4 py-3 text-[11px] text-slate-500">
          RFQ Planner · Vehiclevo
        </div>
      )}
    </>
  )
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const toggleSidebar = () => {
    // On small screens the sidebar is an off-canvas drawer; on large screens
    // it collapses to an icon rail.
    if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed((c) => !c)
    else setMobileOpen((o) => !o)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-800 bg-slate-900 transition-all duration-200 lg:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-slate-800 bg-slate-900">
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Content column, offset by the sidebar width on desktop */}
      <div className={`transition-all duration-200 ${collapsed ? 'lg:pl-16' : 'lg:pl-60'}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur">
          <button
            onClick={toggleSidebar}
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
