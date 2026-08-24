import { Link } from 'react-router-dom'
import HardwareCatalogManager from '../components/HardwareCatalogManager'

/**
 * Standalone portal page for the shared hardware/tool catalog — a module of
 * its own, separate from RFQ planning. It is also reachable from the Hardware
 * planning tab (via HardwareCatalogModal) so a catalog can be maintained
 * without leaving a project.
 */
export default function HardwareCatalogPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-800 bg-indigo-950 text-xl">
            🔧
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hardware Catalog</h1>
            <p className="text-sm text-slate-400">
              Shared vendor catalog of hardware and tools
            </p>
          </div>
        </div>
        <Link to="/" className="text-sm text-slate-400 hover:text-indigo-400">
          ← All projects
        </Link>
      </header>

      <HardwareCatalogManager />
    </div>
  )
}
