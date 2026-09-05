import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'

// Testing Library only unmounts between tests on its own with vitest globals on.
afterEach(() => cleanup())

// jsdom ships no SubtleCrypto; the vault tests need the real one Node has.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
