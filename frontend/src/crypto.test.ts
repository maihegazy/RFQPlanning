import { describe, expect, it } from 'vitest'
import {
  createVault,
  dekVerifier,
  fromBase64,
  unwrapDekRaw,
  unwrapDekRawWithRecovery,
} from './crypto'

describe('the vault proof of key', () => {
  it('is the same for whoever unwraps the data key, and different for another key', async () => {
    const vault = await createVault('correct horse battery staple')
    const viaPassphrase = await unwrapDekRaw(
      'correct horse battery staple',
      vault.kdfSalt,
      vault.kdfIterations,
      vault.wrappedDekPassphrase,
    )
    const viaRecovery = await unwrapDekRawWithRecovery(
      vault.recoveryKeyB64,
      vault.wrappedDekRecovery,
    )
    expect(await dekVerifier(viaPassphrase)).toBe(vault.dekVerifier)
    expect(await dekVerifier(viaRecovery)).toBe(vault.dekVerifier)
    expect(fromBase64(vault.dekVerifier)).toHaveLength(32)

    const other = await createVault('another passphrase')
    expect(other.dekVerifier).not.toBe(vault.dekVerifier)
  }, 20_000)
})
