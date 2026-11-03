import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { historicalDatasets } from '@gfloge/db'
import type { Db } from '@gfloge/db'

export type DatasetRow = typeof historicalDatasets.$inferSelect

export async function claimDataset(db: Db, id: string): Promise<{ ok: true; row: DatasetRow } | { ok: false; status: string; message: string }> {
  const [row] = await db.select().from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1)
  if (!row) return { ok: false, status: 'missing', message: 'No dataset with that id.' }
  if (row.status === 'installed') return { ok: false, status: 'installed', message: 'Already installed.' }
  if (row.status === 'downloading' || row.status === 'verifying' || row.status === 'queued') {
    return { ok: false, status: row.status, message: 'Download already in progress.' }
  }
  // Atomic claim: only one request can move available/failed -> queued.
  const updated = await db
    .update(historicalDatasets)
    .set({ status: 'queued', progressBytes: 0, error: null, updatedAt: new Date() })
    .where(eq(historicalDatasets.id, id))
    .returning()
  if (!updated.length) return { ok: false, status: 'busy', message: 'Download could not be claimed.' }
  return { ok: true, row: updated[0]! }
}

export async function installDataset(db: Db, id: string, dataDirectory: string): Promise<void> {
  const [row] = await db.select().from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1)
  if (!row) throw new Error('Dataset not found')
  const targetDir = path.join(dataDirectory, 'historical')
  // Fail early and visibly if the storage directory is not writable; the route
  // maps this to an HTTP 500 instead of a silent 200.
  await mkdir(targetDir, { recursive: true })
  const probe = path.join(targetDir, '.write-test')
  const fs = await import('node:fs/promises')
  await fs.writeFile(probe, 'ok')
  await fs.unlink(probe)
  const finalPath = path.join(targetDir, row.assetName)
  const tempPath = `${finalPath}.part`
  const startOffset = await stat(tempPath).then((s) => s.size).catch(() => 0)

  await db.update(historicalDatasets).set({ status: 'downloading', progressBytes: startOffset, error: null, updatedAt: new Date() }).where(eq(historicalDatasets.id, id))

  let downloaded = startOffset
  try {
    const headers: Record<string, string> = {}
    if (startOffset > 0) headers.Range = `bytes=${startOffset}-`
    const response = await fetch(row.downloadUrl, { headers })
    if (!response.ok && response.status !== 206) throw new Error(`Download failed with HTTP ${response.status}`)
    if (!response.body) throw new Error('Empty response body')

    const stream = createWriteStream(tempPath, { flags: startOffset > 0 ? 'a' : 'w' })
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        await new Promise<void>((resolve, reject) => {
          stream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()))
        })
        downloaded += value.byteLength
        // Only update progress if the row is still in downloading state;
        // a removal in flight aborts the update (and the download).
        const current = await db.select({ status: historicalDatasets.status }).from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1)
        if (current[0]?.status !== 'downloading') {
          throw new Error('Download cancelled.')
        }
        await db.update(historicalDatasets).set({ progressBytes: downloaded, updatedAt: new Date() }).where(eq(historicalDatasets.id, id))
      }
    }
    await new Promise<void>((resolve, reject) => stream.end((err?: Error | null) => (err ? reject(err) : resolve())))
    await verifyAndInstall(db, id, tempPath, finalPath, row.sha256, row.sizeBytes ?? undefined)
  } catch (error) {
    const current = await db.select({ status: historicalDatasets.status }).from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1)
    // If the dataset was removed while downloading, do not clobber its state.
    if (current[0]?.status !== 'available') {
      await db.update(historicalDatasets).set({ status: 'failed', error: error instanceof Error ? error.message : 'Download failed', updatedAt: new Date() }).where(eq(historicalDatasets.id, id))
    }
    const fs = await import('node:fs/promises')
    await fs.unlink(tempPath).catch(() => undefined)
    throw error
  }
}

async function verifyAndInstall(db: Db, id: string, tempPath: string, finalPath: string, expectedSha: string | null, expectedSize: number | undefined): Promise<void> {
  await db.update(historicalDatasets).set({ status: 'verifying', updatedAt: new Date() }).where(eq(historicalDatasets.id, id))
  const fs = await import('node:fs/promises')
  const info = await fs.stat(tempPath)
  if (expectedSize && info.size !== expectedSize) {
    await fs.unlink(tempPath).catch(() => undefined)
    throw new Error(`Size mismatch: expected ${expectedSize}, got ${info.size}`)
  }
  const hash = createHash('sha256')
  const stream = (await import('node:fs')).createReadStream(tempPath)
  for await (const chunk of stream) hash.update(chunk)
  const digest = hash.digest('hex')
  if (expectedSha && digest !== expectedSha) {
    await fs.unlink(tempPath).catch(() => undefined)
    throw new Error(`Checksum mismatch: expected ${expectedSha}, got ${digest}`)
  }
  await fs.rename(tempPath, finalPath)
  await db.update(historicalDatasets).set({ status: 'installed', localPath: finalPath, installedAt: new Date(), progressBytes: expectedSize ?? info.size, error: null, updatedAt: new Date() }).where(eq(historicalDatasets.id, id))
}

export async function removeDataset(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(historicalDatasets).where(eq(historicalDatasets.id, id)).limit(1)
  if (!row) throw new Error('Dataset not found')
  const fs = await import('node:fs/promises')
  const pathMod = await import('node:path')
  const { dataDir } = await import('./catalog.js')
  const directory = dataDir()
  const finalPath = row.localPath ?? pathMod.join(directory, 'historical', row.assetName)
  await fs.unlink(finalPath).catch(() => undefined)
  await fs.unlink(`${finalPath}.part`).catch(() => undefined)
  await db.update(historicalDatasets).set({ status: 'available', localPath: null, installedAt: null, progressBytes: 0, error: null, updatedAt: new Date() }).where(eq(historicalDatasets.id, id))
}
