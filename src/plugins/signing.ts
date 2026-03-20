/**
 * Signing & Encryption utilities — HMAC-SHA256 and AES-GCM.
 *
 * Uses the Web Crypto API (works in Node.js, Bun, Deno, Cloudflare Workers).
 *
 * @example
 * ```ts
 * import { sign, unsign, encrypt, decrypt } from "silgi/plugins"
 *
 * // Sign a value (tamper-proof)
 * const signed = await sign("user:123", "my-secret")
 * const value = await unsign(signed, "my-secret") // "user:123" or null
 *
 * // Encrypt a value (confidential)
 * const encrypted = await encrypt("sensitive-data", "my-secret")
 * const decrypted = await decrypt(encrypted, "my-secret") // "sensitive-data"
 * ```
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ── HMAC-SHA256 Signing ─────────────────────────────

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || hex.length === 0) return null
  if (!/^[0-9a-f]+$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Sign a string value with HMAC-SHA256.
 * Returns `value.signature` — use `unsign()` to verify.
 */
export async function sign(value: string, secret: string): Promise<string> {
  const key = await getSigningKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return `${value}.${toHex(sig)}`
}

/**
 * Verify and extract a signed value.
 * Returns the original value if valid, or `null` if tampered.
 */
export async function unsign(signed: string, secret: string): Promise<string | null> {
  const dotIdx = signed.lastIndexOf('.')
  if (dotIdx === -1) return null

  const value = signed.slice(0, dotIdx)
  const signature = signed.slice(dotIdx + 1)

  const expected = fromHex(signature)
  if (!expected) return null
  const key = await getSigningKey(secret)
  const valid = await crypto.subtle.verify('HMAC', key, expected.buffer as ArrayBuffer, encoder.encode(value))
  return valid ? value : null
}

// ── AES-GCM Encryption ─────────────────────────────

async function getEncryptionKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt a string with AES-256-GCM (PBKDF2 key derivation).
 * Returns a base64url-encoded string containing salt + iv + ciphertext.
 */
export async function encrypt(plaintext: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await getEncryptionKey(secret, salt)

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))

  // Concatenate: salt (16) + iv (12) + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return base64urlEncode(combined)
}

/**
 * Decrypt a string encrypted with `encrypt()`.
 * Returns the original plaintext, or throws if the secret is wrong.
 */
export async function decrypt(encrypted: string, secret: string): Promise<string> {
  const combined = base64urlDecode(encrypted)
  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const ciphertext = combined.slice(28)

  const key = await getEncryptionKey(secret, salt)

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)

  return decoder.decode(plaintext)
}

// ── Base64URL helpers ───────────────────────────────

function base64urlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
