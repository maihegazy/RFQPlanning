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
  encryptJson,
  parseRecoveryFile,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type WrappedKey,
} from '../crypto'

export type VaultStatus = 'loading' | 'no-vault' | 'locked' | 'unlocked'

interface VaultContextValue {
  status: VaultStatus
  /** Create the vault; returns the recovery-file content to download. */
  setup: (passphrase: string) => Promise<string>
  unlock: (passphrase: string) => Promise<void>
  unlockWithFile: (fileContent: string) => Promise<void>
  lock: () => void
  encrypt: (obj: unknown) => Promise<WrappedKey>
  decrypt: <T>(blob: WrappedKey) => Promise<T>
}

const VaultContext = createContext<VaultContextValue | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<VaultInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dek, setDek] = useState<CryptoKey | null>(null)

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
    await api.createVault({
      kdf_salt: vault.kdfSalt,
      kdf_iterations: vault.kdfIterations,
      wrapped_dek_passphrase_iv: vault.wrappedDekPassphrase.iv,
      wrapped_dek_passphrase: vault.wrappedDekPassphrase.ciphertext,
      wrapped_dek_recovery_iv: vault.wrappedDekRecovery.iv,
      wrapped_dek_recovery: vault.wrappedDekRecovery.ciphertext,
    })
    setInfo(await api.getVault())
    setDek(vault.dek)
    return buildRecoveryFile(vault.recoveryKeyB64)
  }, [])

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!info?.exists) throw new Error('Vault not set up')
      try {
        const key = await unlockWithPassphrase(passphrase, info.kdf_salt, info.kdf_iterations, {
          iv: info.wrapped_dek_passphrase_iv,
          ciphertext: info.wrapped_dek_passphrase,
        })
        setDek(key)
      } catch {
        throw new Error('Wrong passphrase')
      }
    },
    [info],
  )

  const unlockWithFile = useCallback(
    async (fileContent: string) => {
      if (!info?.exists) throw new Error('Vault not set up')
      const recoveryKey = parseRecoveryFile(fileContent)
      try {
        const key = await unlockWithRecoveryKey(recoveryKey, {
          iv: info.wrapped_dek_recovery_iv,
          ciphertext: info.wrapped_dek_recovery,
        })
        setDek(key)
      } catch {
        throw new Error('Recovery key does not match this vault')
      }
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
    () => ({ status, setup, unlock, unlockWithFile, lock, encrypt, decrypt }),
    [status, setup, unlock, unlockWithFile, lock, encrypt, decrypt],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used inside VaultProvider')
  return ctx
}
