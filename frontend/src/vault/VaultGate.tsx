import { useRef, useState, type ReactNode } from 'react'
import { Button, ErrorBanner, Input, Label, Modal } from '../components/ui'
import { downloadBlob } from '../download'
import { useVault } from './VaultContext'

/** Header pill showing vault state with lock/unlock actions. */
export function VaultStatusButton() {
  const { status, lock } = useVault()
  const [showDialog, setShowDialog] = useState(false)
  const [showChange, setShowChange] = useState(false)

  if (status === 'loading') return null

  return (
    <>
      {status === 'unlocked' ? (
        <span className="flex items-center overflow-hidden rounded-lg border border-emerald-800 bg-emerald-950/50 text-sm text-emerald-300">
          <button
            onClick={lock}
            className="px-3 py-1.5 hover:bg-emerald-900/50"
            title="Financial data is unlocked in this session. Click to lock."
          >
            🔓 Financial data unlocked
          </button>
          <button
            onClick={() => setShowChange(true)}
            className="border-l border-emerald-800 px-2 py-1.5 hover:bg-emerald-900/50"
            title="Change the vault passphrase"
            aria-label="Change passphrase"
          >
            ⚙
          </button>
        </span>
      ) : (
        <button
          onClick={() => setShowDialog(true)}
          className="flex items-center gap-1.5 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-900/40"
          title="Financial data is locked. Click to unlock."
        >
          🔒 {status === 'no-vault' ? 'Set up financial vault' : 'Financial data locked'}
        </button>
      )}
      {showDialog && <VaultDialog onClose={() => setShowDialog(false)} />}
      {showChange && <ChangePassphraseDialog onClose={() => setShowChange(false)} />}
    </>
  )
}

/** Change the vault passphrase: re-wraps the data key, never the data. */
export function ChangePassphraseDialog({ onClose }: { onClose: () => void }) {
  const { changePassphrase } = useVault()
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase')
  const [current, setCurrent] = useState('')
  const [recoveryFile, setRecoveryFile] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const recoveryInput = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (next.length < 8) {
      setError('New passphrase must be at least 8 characters')
      return
    }
    if (next !== confirm) {
      setError('New passphrases do not match')
      return
    }
    if (mode === 'recovery' && !recoveryFile) {
      setError('Select your rfq-recovery-key.json file')
      return
    }
    setBusy(true)
    setError('')
    try {
      await changePassphrase(
        mode === 'passphrase' ? { passphrase: current } : { recoveryFile },
        next,
      )
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Change Vault Passphrase" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">
            ✓ Passphrase changed. Everyone who uses this vault needs the new one from
            now on. Your existing recovery key file still works — it is unchanged.
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-400">
            Only the key is re-wrapped — no project data is re-encrypted, so this is
            instant however many projects you have. There is one shared vault, so the
            new passphrase applies to everyone who unlocks financial data.
          </p>
          {error && <ErrorBanner message={error} />}

          <div className="flex gap-1 rounded-lg bg-slate-800 p-1 text-sm">
            {(['passphrase', 'recovery'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m)
                  setError('')
                }}
                className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                  mode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'passphrase' ? 'I know the current passphrase' : 'Use the recovery file'}
              </button>
            ))}
          </div>

          {mode === 'passphrase' ? (
            <div>
              <Label>Current passphrase</Label>
              <Input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoFocus
              />
            </div>
          ) : (
            <div>
              <Label>Recovery key file</Label>
              <input
                ref={recoveryInput}
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) setRecoveryFile(await file.text())
                  e.target.value = ''
                }}
              />
              <Button variant="secondary" onClick={() => recoveryInput.current?.click()}>
                {recoveryFile ? '✓ Recovery file loaded' : 'Choose rfq-recovery-key.json'}
              </Button>
            </div>
          )}

          <div>
            <Label>New passphrase (min. 8 characters)</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div>
            <Label>Confirm new passphrase</Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Changing…' : 'Change Passphrase'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Inline prompt used by money sections when the vault is locked. */
export function VaultPrompt({ children }: { children?: ReactNode }) {
  const { status } = useVault()
  const [showDialog, setShowDialog] = useState(false)

  return (
    <div className="rounded-lg border border-dashed border-amber-800/60 bg-amber-950/20 px-6 py-8 text-center">
      <p className="text-2xl">🔒</p>
      <p className="mt-2 text-sm text-amber-200">
        {children ??
          'Financial data is end-to-end encrypted. Unlock it to view and edit it.'}
      </p>
      <div className="mt-4">
        <Button onClick={() => setShowDialog(true)}>
          {status === 'no-vault' ? 'Set Up Financial Vault' : 'Unlock Financial Data'}
        </Button>
      </div>
      {showDialog && <VaultDialog onClose={() => setShowDialog(false)} />}
    </div>
  )
}

/** Setup wizard (no vault yet) or unlock dialog (vault exists, locked). */
export function VaultDialog({
  onClose,
  onUnlocked,
}: {
  onClose: () => void
  onUnlocked?: () => void
}) {
  const { status } = useVault()
  // Latch the mode on mount: setup flips status to 'unlocked' mid-wizard,
  // and the recovery-file step must stay visible until the user finishes.
  const [mode] = useState<'setup' | 'unlock' | null>(() =>
    status === 'no-vault' ? 'setup' : status === 'locked' ? 'unlock' : null,
  )
  if (mode === 'setup') return <SetupWizard onClose={onClose} onUnlocked={onUnlocked} />
  if (mode === 'unlock') return <UnlockDialog onClose={onClose} onUnlocked={onUnlocked} />
  return null
}

function SetupWizard({
  onClose,
  onUnlocked,
}: {
  onClose: () => void
  onUnlocked?: () => void
}) {
  const { setup } = useVault()
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryContent, setRecoveryContent] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState(false)

  const create = async () => {
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      setRecoveryContent(await setup(passphrase))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const downloadRecovery = () => {
    if (!recoveryContent) return
    downloadBlob(
      new Blob([recoveryContent], { type: 'application/json' }),
      'rfq-recovery-key.json',
    )
    setDownloaded(true)
  }

  return (
    <Modal title="Set Up Financial Data Vault" onClose={recoveryContent ? () => {} : onClose}>
      {recoveryContent === null ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-400">
            Financial data (rates, costs, prices) is encrypted <em>in your browser</em> with
            a key derived from this passphrase. Nobody with access to the database or
            server can read it — including administrators. The passphrase never leaves
            this device.
          </p>
          {error && <ErrorBanner message={error} />}
          <div>
            <Label>Passphrase (min. 8 characters)</Label>
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label>Confirm passphrase</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create Vault'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
            <strong>Download your recovery key now.</strong> It is shown only once. If
            you forget the passphrase AND lose this file, your financial data is
            unrecoverable — by design, nobody else can decrypt it.
          </div>
          <Button onClick={downloadRecovery} className="w-full">
            ⬇ Download rfq-recovery-key.json
          </Button>
          <p className="text-xs text-slate-500">
            Store it somewhere safe and offline (USB stick, password manager, safe).
          </p>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                onUnlocked?.()
                onClose()
              }}
              disabled={!downloaded}
            >
              {downloaded ? 'Done' : 'Download the file to continue'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function UnlockDialog({
  onClose,
  onUnlocked,
}: {
  onClose: () => void
  onUnlocked?: () => void
}) {
  const { unlock, unlockWithFile } = useVault()
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const tryUnlock = async () => {
    setBusy(true)
    setError('')
    try {
      await unlock(passphrase)
      onUnlocked?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const tryFile = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      await unlockWithFile(await file.text())
      onUnlocked?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Unlock Financial Data" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          tryUnlock()
        }}
      >
        {error && <ErrorBanner message={error} />}
        <div>
          <Label>Passphrase</Label>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between">
          <input
            ref={fileInput}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) tryFile(f)
              e.target.value = ''
            }}
          />
          <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
            Use recovery key file…
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !passphrase}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
