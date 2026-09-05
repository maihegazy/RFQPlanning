import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api'
import type { VaultInfo } from '../types'
import {
  buildRecoveryFile,
  createVault,
  decryptJson,
  dekVerifier,
  encryptJson,
  keyFromRaw,
  parseRecoveryFile,
  unwrapDekRaw,
  unwrapDekRawWithRecovery,
  rewrapDek,
  type WrappedKey,
} from '../crypto'

export type VaultStatus = 'loading' | 'no-vault' | 'locked' | 'unlocked'

interface VaultContextValue {
  status: VaultStatus
  /** Create the vault; returns the recovery-file content to download. */
  setup: (passphrase: string) => Promise<string>
  unlock: (passphrase: string) => Promise<void>
  unlockWithFile: (fileContent: string) => Promise<void>
  /** Re-wrap the data key under a new passphrase. Proof of ownership is either
   *  the current passphrase or the recovery file — data is never re-encrypted. */
  changePassphrase: (
    proof: { passphrase: string } | { recoveryFile: string },
    newPassphrase: string,
  ) => Promise<void>
  lock: () => void
  encrypt: (obj: unknown) => Promise<WrappedKey>
  decrypt: <T>(blob: WrappedKey) => Promise<T>
  /**
   * The setup/unlock dialog is rendered by `VaultDialogHost` at the app root,
   * so the prompt that opened it can disappear (a section unlocking) without
   * taking the dialog, and its one-time recovery step, down with it.
   */
  dialogOpen: boolean
  openDialog: () => void
  closeDialog: () => void
}

const VaultContext = createContext<VaultContextValue | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<VaultInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dek, setDek] = useState<CryptoKey | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const openDialog = useCallback(() => setDialogOpen(true), [])
  const closeDialog = useCallback(() => setDialogOpen(false), [])

  useEffect(() => {
    api
      .getVault()
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoaded(true))
  }, [])

  const status: VaultStatus = !loaded
    ? 'loading'
    : !info?.exists
      ? 'no-vault'
      : dek
        ? 'unlocked'
        : 'locked'

  const setup = useCallback(async (passphrase: string) => {
    const vault = await createVault(passphrase)
    // The POST answers with the stored record, so no second request stands
    // between creating the vault and showing the one-time recovery key.
    const created = await api.createVault({
      kdf_salt: vault.kdfSalt,
      kdf_iterations: vault.kdfIterations,
      wrapped_dek_passphrase_iv: vault.wrappedDekPassphrase.iv,
      wrapped_dek_passphrase: vault.wrappedDekPassphrase.ciphertext,
      wrapped_dek_recovery_iv: vault.wrappedDekRecovery.iv,
      wrapped_dek_recovery: vault.wrappedDekRecovery.ciphertext,
      dek_verifier: vault.dekVerifier,
    })
    setInfo(created)
    setDek(vault.dek)
    return buildRecoveryFile(vault.recoveryKeyB64)
  }, [])

  /**
   * A vault from before proofs of key existed gets its proof on the first
   * unlock; until then a passphrase change only needs the wrapped key. Best
   * effort: an unlock never fails because the registration did.
   */
  const registerVerifier = useCallback(async (current: VaultInfo, dekRaw: Uint8Array) => {
    if (current.has_verifier) return
    try {
      const updated = await api.registerVaultVerifier({
        current_wrapped_dek_passphrase_iv: current.wrapped_dek_passphrase_iv,
        current_wrapped_dek_passphrase: current.wrapped_dek_passphrase,
        dek_verifier: await dekVerifier(dekRaw),
      })
      setInfo(updated)
    } catch {
      /* the next unlock tries again */
    }
  }, [])

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!info?.exists) throw new Error('Vault not set up')
      let dekRaw: Uint8Array
      try {
        dekRaw = await unwrapDekRaw(passphrase, info.kdf_salt, info.kdf_iterations, {
          iv: info.wrapped_dek_passphrase_iv,
          ciphertext: info.wrapped_dek_passphrase,
        })
      } catch {
        throw new Error('Wrong passphrase')
      }
      setDek(await keyFromRaw(dekRaw))
      await registerVerifier(info, dekRaw)
    },
    [info, registerVerifier],
  )

  const unlockWithFile = useCallback(
    async (fileContent: string) => {
      if (!info?.exists) throw new Error('Vault not set up')
      const recoveryKey = parseRecoveryFile(fileContent)
      let dekRaw: Uint8Array
      try {
        dekRaw = await unwrapDekRawWithRecovery(recoveryKey, {
          iv: info.wrapped_dek_recovery_iv,
          ciphertext: info.wrapped_dek_recovery,
        })
      } catch {
        throw new Error('Recovery key does not match this vault')
      }
      setDek(await keyFromRaw(dekRaw))
      await registerVerifier(info, dekRaw)
    },
    [info, registerVerifier],
  )

  const changePassphrase = useCallback(
    async (proof: { passphrase: string } | { recoveryFile: string }, newPassphrase: string) => {
      if (!info?.exists) throw new Error('Vault not set up')
      let dekRaw: Uint8Array
      if ('passphrase' in proof) {
        try {
          dekRaw = await unwrapDekRaw(proof.passphrase, info.kdf_salt, info.kdf_iterations, {
            iv: info.wrapped_dek_passphrase_iv,
            ciphertext: info.wrapped_dek_passphrase,
          })
        } catch {
          throw new Error('Current passphrase is wrong')
        }
      } else {
        try {
          dekRaw = await unwrapDekRawWithRecovery(parseRecoveryFile(proof.recoveryFile), {
            iv: info.wrapped_dek_recovery_iv,
            ciphertext: info.wrapped_dek_recovery,
          })
        } catch {
          throw new Error('Recovery key does not match this vault')
        }
      }

      const rewrapped = await rewrapDek(dekRaw, newPassphrase)
      // The proof of key and the wrapped key this change was built from go
      // along: the server refuses a blind request and a stale one.
      const updated = await api.changeVaultPassphrase({
        kdf_salt: rewrapped.kdfSalt,
        kdf_iterations: rewrapped.kdfIterations,
        wrapped_dek_passphrase_iv: rewrapped.wrapped.iv,
        wrapped_dek_passphrase: rewrapped.wrapped.ciphertext,
        current_wrapped_dek_passphrase_iv: info.wrapped_dek_passphrase_iv,
        current_wrapped_dek_passphrase: info.wrapped_dek_passphrase,
        dek_verifier: await dekVerifier(dekRaw),
      })
      setInfo(updated)
      // Keep the session open under the new passphrase
      setDek(await keyFromRaw(dekRaw))
    },
    [info],
  )

  const lock = useCallback(() => setDek(null), [])

  const encrypt = useCallback(
    async (obj: unknown) => {
      if (!dek) throw new Error('Vault is locked')
      return encryptJson(dek, obj)
    },
    [dek],
  )

  const decrypt = useCallback(
    async <T,>(blob: WrappedKey) => {
      if (!dek) throw new Error('Vault is locked')
      return decryptJson<T>(dek, blob)
    },
    [dek],
  )

  const value = useMemo(
    () => ({
      status,
      setup,
      unlock,
      unlockWithFile,
      changePassphrase,
      lock,
      encrypt,
      decrypt,
      dialogOpen,
      openDialog,
      closeDialog,
    }),
    [
      status,
      setup,
      unlock,
      unlockWithFile,
      changePassphrase,
      lock,
      encrypt,
      decrypt,
      dialogOpen,
      openDialog,
      closeDialog,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used inside VaultProvider')
  return ctx
}
