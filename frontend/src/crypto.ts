/**
 * End-to-end encryption primitives (WebCrypto only, no external libs).
 *
 * Key hierarchy:
 *   passphrase --PBKDF2-SHA256--> KEK ─┐
 *                                      ├─ wraps --> DEK (AES-256-GCM)
 *   recovery key (random 256-bit)  ────┘
 *
 * The DEK encrypts all money data. The server stores only the wrapped DEK
 * copies, KDF salt/iterations, and ciphertext blobs — never a usable key.
 */

export const KDF_ITERATIONS = 600_000

export interface WrappedKey {
  iv: string // base64
  ciphertext: string // base64
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  return arr
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

/** Derive the passphrase key (KEK). */
export async function deriveKek(
  passphrase: string,
  saltB64: string,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltB64) as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function aesEncrypt(key: CryptoKey, data: Uint8Array): Promise<WrappedKey> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource,
  )
  return { iv: toBase64(iv), ciphertext: toBase64(ct) }
}

async function aesDecrypt(key: CryptoKey, wrapped: WrappedKey): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv) as BufferSource },
    key,
    fromBase64(wrapped.ciphertext) as BufferSource,
  )
  return new Uint8Array(plain)
}

export interface VaultSetup {
  kdfSalt: string
  kdfIterations: number
  wrappedDekPassphrase: WrappedKey
  wrappedDekRecovery: WrappedKey
  recoveryKeyB64: string // shown/downloaded ONCE, never sent to the server
  dek: CryptoKey
}

/** Create a brand-new vault: DEK + recovery key, both wrapped. */
export async function createVault(passphrase: string): Promise<VaultSetup> {
  const kdfSalt = toBase64(randomBytes(16))
  const dekRaw = randomBytes(32)
  const recoveryRaw = randomBytes(32)

  const kek = await deriveKek(passphrase, kdfSalt, KDF_ITERATIONS)
  const recoveryKey = await importAesKey(recoveryRaw)

  return {
    kdfSalt,
    kdfIterations: KDF_ITERATIONS,
    wrappedDekPassphrase: await aesEncrypt(kek, dekRaw),
    wrappedDekRecovery: await aesEncrypt(recoveryKey, dekRaw),
    recoveryKeyB64: toBase64(recoveryRaw),
    dek: await importAesKey(dekRaw),
  }
}

/** Unlock with passphrase. Throws on wrong passphrase (GCM auth failure). */
export async function unlockWithPassphrase(
  passphrase: string,
  kdfSalt: string,
  kdfIterations: number,
  wrappedDek: WrappedKey,
): Promise<CryptoKey> {
  const kek = await deriveKek(passphrase, kdfSalt, kdfIterations)
  const dekRaw = await aesDecrypt(kek, wrappedDek)
  return importAesKey(dekRaw)
}

/** Unlock with the recovery key from the recovery file. */
export async function unlockWithRecoveryKey(
  recoveryKeyB64: string,
  wrappedDek: WrappedKey,
): Promise<CryptoKey> {
  const recoveryKey = await importAesKey(fromBase64(recoveryKeyB64))
  const dekRaw = await aesDecrypt(recoveryKey, wrappedDek)
  return importAesKey(dekRaw)
}

/**
 * Re-wrap the DEK under a new passphrase (passphrase change). Requires an
 * unlocked session? No — requires the DEK raw bytes, so we unwrap with the
 * current credentials first, outside this function, and pass the CryptoKey
 * as non-extractable... AES keys imported non-extractable cannot be re-wrapped.
 * Instead: unwrap raw DEK with old credentials and call this with the raw.
 */
export async function rewrapDek(
  dekRaw: Uint8Array,
  newPassphrase: string,
): Promise<{ kdfSalt: string; kdfIterations: number; wrapped: WrappedKey }> {
  const kdfSalt = toBase64(randomBytes(16))
  const kek = await deriveKek(newPassphrase, kdfSalt, KDF_ITERATIONS)
  return {
    kdfSalt,
    kdfIterations: KDF_ITERATIONS,
    wrapped: await aesEncrypt(kek, dekRaw),
  }
}

/** Unwrap the raw DEK bytes (needed for passphrase change). */
export async function unwrapDekRaw(
  passphrase: string,
  kdfSalt: string,
  kdfIterations: number,
  wrappedDek: WrappedKey,
): Promise<Uint8Array> {
  const kek = await deriveKek(passphrase, kdfSalt, kdfIterations)
  return aesDecrypt(kek, wrappedDek)
}

/** Encrypt an arbitrary JSON-serializable object with the DEK. */
export async function encryptJson(dek: CryptoKey, obj: unknown): Promise<WrappedKey> {
  const data = new TextEncoder().encode(JSON.stringify(obj))
  return aesEncrypt(dek, data)
}

/** Decrypt a blob back into an object. Throws if key or data is wrong. */
export async function decryptJson<T>(dek: CryptoKey, blob: WrappedKey): Promise<T> {
  const plain = await aesDecrypt(dek, blob)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

// ---------------------------------------------------------------------------
// Recovery file
// ---------------------------------------------------------------------------

export interface RecoveryFile {
  format: 'rfq-planner-recovery'
  version: 1
  created_at: string
  recovery_key: string
}

export function buildRecoveryFile(recoveryKeyB64: string): string {
  const file: RecoveryFile = {
    format: 'rfq-planner-recovery',
    version: 1,
    created_at: new Date().toISOString(),
    recovery_key: recoveryKeyB64,
  }
  return JSON.stringify(file, null, 2)
}

export function parseRecoveryFile(content: string): string {
  const data = JSON.parse(content) as RecoveryFile
  if (data.format !== 'rfq-planner-recovery' || !data.recovery_key) {
    throw new Error('Not a valid RFQ Planner recovery file')
  }
  return data.recovery_key
}
