// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { VaultProvider, useVault } from '../VaultContext'
import { parseRecoveryFile } from '../../crypto'
import type { VaultInfo } from '../../types'

const apiMock = vi.hoisted(() => ({
  getVault: vi.fn(),
  createVault: vi.fn(),
  changeVaultPassphrase: vi.fn(),
  registerVaultVerifier: vi.fn(),
}))
vi.mock('../../api', () => ({ api: apiMock }))

const wrapper = ({ children }: { children: ReactNode }) => <VaultProvider>{children}</VaultProvider>

/** The server keeps whatever the client sends; this stands in for it. */
function fakeServer() {
  let stored: VaultInfo | null = null
  apiMock.getVault.mockImplementation(async () => stored ?? { exists: false })
  apiMock.createVault.mockImplementation(async (keys) => {
    stored = { exists: true, has_verifier: true, ...keys }
    return stored
  })
  apiMock.changeVaultPassphrase.mockImplementation(async (keys) => {
    stored = { ...stored!, ...keys, has_verifier: true }
    return stored
  })
  apiMock.registerVaultVerifier.mockImplementation(async () => {
    stored = { ...stored!, has_verifier: true }
    return stored
  })
  return {
    get: () => stored,
    forgetVerifier: () => {
      stored = { ...stored!, has_verifier: false }
    },
  }
}

describe('the vault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is set up, locked and unlocked with the passphrase or the recovery file', async () => {
    const server = fakeServer()
    const { result } = renderHook(() => useVault(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('no-vault'))

    let recoveryFile = ''
    await act(async () => {
      recoveryFile = await result.current.setup('correct horse battery staple')
    })
    expect(result.current.status).toBe('unlocked')
    expect(apiMock.createVault).toHaveBeenCalledWith(
      expect.objectContaining({ dek_verifier: expect.any(String) }),
    )
    expect(parseRecoveryFile(recoveryFile)).toHaveLength(44)

    // Round trip a value through the session key
    let blob!: { iv: string; ciphertext: string }
    await act(async () => {
      blob = await result.current.encrypt({ rate: 95 })
    })
    expect(await result.current.decrypt<{ rate: number }>(blob)).toEqual({ rate: 95 })

    act(() => result.current.lock())
    expect(result.current.status).toBe('locked')
    await expect(result.current.unlock('wrong passphrase')).rejects.toThrow('Wrong passphrase')
    await act(async () => {
      await result.current.unlock('correct horse battery staple')
    })
    expect(result.current.status).toBe('unlocked')
    expect(await result.current.decrypt<{ rate: number }>(blob)).toEqual({ rate: 95 })

    act(() => result.current.lock())
    await act(async () => {
      await result.current.unlockWithFile(recoveryFile)
    })
    expect(result.current.status).toBe('unlocked')
    expect(server.get()?.exists).toBe(true)
  }, 30_000)

  it('changes the passphrase with proof of the current key and keeps the data readable', async () => {
    fakeServer()
    const { result } = renderHook(() => useVault(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('no-vault'))
    await act(async () => {
      await result.current.setup('first passphrase')
    })
    let blob!: { iv: string; ciphertext: string }
    await act(async () => {
      blob = await result.current.encrypt('secret')
    })
    const before = apiMock.createVault.mock.calls[0][0]

    await act(async () => {
      await result.current.changePassphrase({ passphrase: 'first passphrase' }, 'second passphrase')
    })
    const sent = apiMock.changeVaultPassphrase.mock.calls[0][0]
    expect(sent.current_wrapped_dek_passphrase).toBe(before.wrapped_dek_passphrase)
    expect(sent.dek_verifier).toBe(before.dek_verifier)
    expect(sent.wrapped_dek_passphrase).not.toBe(before.wrapped_dek_passphrase)

    act(() => result.current.lock())
    await expect(result.current.unlock('first passphrase')).rejects.toThrow('Wrong passphrase')
    await act(async () => {
      await result.current.unlock('second passphrase')
    })
    expect(await result.current.decrypt<string>(blob)).toBe('secret')
  }, 30_000)

  it('registers the proof of key for a vault that was created without one', async () => {
    const server = fakeServer()
    const { result } = renderHook(() => useVault(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('no-vault'))
    await act(async () => {
      await result.current.setup('legacy passphrase')
    })
    server.forgetVerifier()
    act(() => result.current.lock())
    // A fresh provider sees the server's record without a verifier
    const { result: again } = renderHook(() => useVault(), { wrapper })
    await waitFor(() => expect(again.current.status).toBe('locked'))
    await act(async () => {
      await again.current.unlock('legacy passphrase')
    })
    expect(apiMock.registerVaultVerifier).toHaveBeenCalledWith(
      expect.objectContaining({ dek_verifier: apiMock.createVault.mock.calls[0][0].dek_verifier }),
    )
    expect(server.get()?.has_verifier).toBe(true)
  }, 30_000)
})
