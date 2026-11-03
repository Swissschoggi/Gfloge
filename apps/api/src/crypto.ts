// Crypto: Argon2id password hashing, 256-bit session tokens, and AES-256-GCM
// for provider credential storage at rest (key derived from GF_SECRET).
import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto'
import { argon2id } from 'hash-wasm'

const ARGON2_SALT_LEN = 16
const ARGON2_MEMORY_KIB = 19456 // 19 MiB, OWASP moderate
const ARGON2_ITERATIONS = 2
const ARGON2_PARALLELISM = 1
const ARGON2_HASH_LEN = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(ARGON2_SALT_LEN)
  const hash = await argon2id({
    password,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LEN,
    outputType: 'encoded',
  })
  return hash
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const parts = encoded.split('$')
    // $argon2id$v=19$m=19456,t=2,p=1$<saltbase64>$<hashbase64>
    const salt = Buffer.from(parts[4], 'base64')
    const expected = Buffer.from(parts[5] ?? '', 'base64')
    const [m, t, p] = parts[3].split(',')
    const computed = Buffer.from(
      await argon2id({
        password,
        salt,
        parallelism: Number(p?.split('=')[1]) || ARGON2_PARALLELISM,
        iterations: Number(t?.split('=')[1]) || ARGON2_ITERATIONS,
        memorySize: Number(m?.split('=')[1]) || ARGON2_MEMORY_KIB,
        hashLength: expected.length,
        outputType: 'binary',
      })
    )
    return computed.length === expected.length && timingSafeEqual(computed, expected)
  } catch (error) {
    console.error('Password verification failed structurally:', error instanceof Error ? error.message : error)
    return false
  }
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

// ===== Provider credential encryption =====

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'gfloge-provider-credentials', 32)
}

export function encryptConfigJson(secret: string, config: Record<string, string>): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const plaintext = Buffer.from(JSON.stringify(config), 'utf8')
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`
}

export function decryptConfigJson(secret: string, stored: string): Record<string, string> {
  const [ivB, encB, tagB] = stored.split('.')
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
  const dec = Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()])
  return JSON.parse(dec.toString('utf8'))
}

export function maskSecret(secretValue: string): string {
  const tail = secretValue.slice(-4)
  return `\u2022\u2022\u2022\u2022${tail}`
}
