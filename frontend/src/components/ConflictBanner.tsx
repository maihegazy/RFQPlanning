import { Button } from './ui'

/**
 * Someone else saved first. The user's edits are still on screen; reloading
 * shows the other person's version so they can be applied again on top of it.
 */
export function ConflictBanner({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-800 bg-amber-950/50 px-4 py-3 text-sm text-amber-200"
    >
      <span>{message}</span>
      <Button variant="secondary" onClick={onReload}>
        Reload their changes
      </Button>
    </div>
  )
}
