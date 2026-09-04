import { Link } from 'react-router-dom'
import { ArrowRight, CircleDot, Diamond, Flag, Square } from 'lucide-react'
import { ORDERING_PROCESS, type ProcessStep } from '../hardware/orderingProcess'

const KIND_ICON = {
  terminator: Flag,
  action: Square,
  decision: Diamond,
} as const

function Step({ step, index }: { step: ProcessStep; index: number }) {
  const Icon = KIND_ICON[step.kind]
  const decision = step.kind === 'decision'
  return (
    <li className="relative pl-10">
      {/* The rail and node stand in for the flowchart's connector arrows. */}
      <span
        className={`absolute left-2.5 top-4 flex h-5 w-5 items-center justify-center rounded-full border ${
          decision
            ? 'border-amber-800 bg-amber-950 text-amber-300'
            : 'border-indigo-800 bg-indigo-950 text-indigo-300'
        }`}
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
      </span>

      <div
        className={`rounded-lg border px-4 py-3 ${
          decision ? 'border-amber-800 bg-amber-950/30' : 'border-slate-800 bg-slate-900/60'
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs font-mono text-slate-500">{String(index + 1).padStart(2, '0')}</span>
          <h3 className="text-sm font-semibold text-slate-100">{step.label}</h3>
          {step.owner && (
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {step.owner}
            </span>
          )}
        </div>

        {step.detail && <p className="mt-2 max-w-3xl text-sm text-slate-400">{step.detail}</p>}

        {step.branches && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.branches.map((b) => (
              <span
                key={b.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-800 bg-amber-950/50 px-2.5 py-0.5 text-xs font-medium text-amber-300"
              >
                {b.label}
                <ArrowRight className="h-3 w-3" strokeWidth={2} />
                {b.to}
              </span>
            ))}
          </div>
        )}

        {step.link && (
          <Link
            to={step.link.to}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:underline"
          >
            {step.link.label}
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        )}
      </div>
    </li>
  )
}

export default function HwProcessPage() {
  let counter = 0
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-800 bg-indigo-950 text-indigo-300">
            <CircleDot className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ordering Process</h1>
            <p className="text-sm text-slate-400">
              How a hardware purchase runs, from budget approval to labeling
            </p>
          </div>
        </div>
        <Link to="/hardware" className="text-sm text-slate-400 hover:text-indigo-400">
          ← Hardware Management
        </Link>
      </div>

      <p className="mb-8 max-w-3xl text-sm text-slate-400">
        The working document carried this flow as three pasted images on its first sheet. Here
        each step keeps its owner and its guidance, and the steps that happen in this tool link
        straight to the screen that performs them.
      </p>

      <div className="space-y-8">
        {ORDERING_PROCESS.map((phase) => (
          <section key={phase.number}>
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
                {phase.number}
              </span>
              <h2 className="text-base font-semibold text-slate-100">{phase.title}</h2>
            </div>
            <ol className="relative space-y-3 before:absolute before:bottom-6 before:left-5 before:top-6 before:w-px before:bg-slate-800">
              {phase.steps.map((step) => (
                <Step key={step.id} step={step} index={counter++} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
