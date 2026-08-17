import { useRef, useState, type ReactNode } from 'react'
import { Button, ErrorBanner, Input, Label, Modal } from '../components/ui'
import { downloadBlob } from '../download'
import { useVault } from './VaultContext'

/** Header pill showing vault state with lock/unlock actions. */
export function VaultStatusButton() {
  const { status, lock } = useVault()
  const [showDialog, setShowDialog] = useState(false)

  if (status === 'loading') return null

  return (
    <>
      {status === 'unlocked' ? (
        <button
          onClick={lock}
          className="flex items-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-950/50 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/50"
          title="Money data is unlocked in this session. Click to lock."
        >
          🔓 Money unlocked
        </button>
      ) : (
        <button
          onClick={() => setShowDialog(true)}
          className="flex items-center gap-1.5 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-900/40"
          title="Money data is locked. Click to unlock."
        >
          🔒 {status === 'no-vault' ? 'Set up money vault' : 'Money locked'}
        </button>
      )}
      {showDialog && <VaultDialog onClose={() => setShowDialog(false)} />}
    </>
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
          'Money data is end-to-end encrypted. Unlock it to view and edit financial values.'}
      </p>
      <div className="mt-4">
        <Button onClick={() => setShowDialog(true)}>
          {status === 'no-vault' ? 'Set Up Money Vault' : 'Unlock Money Data'}
        </Button>
      </div>
      {showDialog && <VaultDialog onClose={() => setShowDialog(false)} />}
    </div>
  )
}

/** Setup wizard (no vault yet) or unlock dialog (vault exists, locked). */
export function VaultDialog({ onClose }: { onClose: () => void }) {
  const { status } = useVault()
  // Latch the mode on mount: setup flips status to 'unlocked' mid-wizard,
  // and the recovery-file step must stay visible until the user finishes.
  const [mode] = useState<'setup' | 'unlock' | null>(() =>
    status === 'no-vault' ? 'setup' : status === 'locked' ? 'unlock' : null,
  )
  if (mode === 'setup') return <SetupWizard onClose={onClose} />
  if (mode === 'unlock') return <UnlockDialog onClose={onClose} />
  return null
}

function SetupWizard({ onClose }: { onClose: () => void }) {
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
    <Modal title="Set Up Money Vault" onClose={recoveryContent ? () => {} : onClose}>
      {recoveryContent === null ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-400">
            Money data (rates, costs, prices) is encrypted <em>in your browser</em> with
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
            you forget the passphrase AND lose this file, your money data is
            unrecoverable — by design, nobody else can decrypt it.
          </div>
          <Button onClick={downloadRecovery} className="w-full">
            ⬇ Download rfq-recovery-key.json
          </Button>
          <p className="text-xs text-slate-500">
            Store it somewhere safe and offline (USB stick, password manager, safe).
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose} disabled={!downloaded}>
              {downloaded ? 'Done' : 'Download the file to continue'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function UnlockDialog({ onClose }: { onClose: () => void }) {
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
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Unlock Money Data" onClose={onClose}>
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
