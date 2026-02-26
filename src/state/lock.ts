import { existsSync, lstatSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isProcessAlive } from '../util/process'

const LOCK_FILE = '.xero-reconcile-lock.json'
const LOCK_MODE = 0o600
const LOCK_TIMEOUT_MS = 30_000

interface LockPayload {
	readonly pid: number
	readonly createdAt: number
}

function resolveLockPath(): string {
	return path.join(process.cwd(), LOCK_FILE)
}

async function readLock(): Promise<LockPayload | null> {
	const lockPath = resolveLockPath()
	if (!existsSync(lockPath)) return null
	const statInfo = lstatSync(lockPath)
	if (statInfo.isSymbolicLink()) {
		throw new Error(`Refusing to read symlinked lock file: ${lockPath}`)
	}
	const raw = await readFile(lockPath, 'utf8')
	return JSON.parse(raw) as LockPayload
}

/** Acquire a process lock for --execute runs. */
export async function acquireLock(): Promise<void> {
	const lockPath = resolveLockPath()
	const existing = await readLock()
	if (existing) {
		const age = Date.now() - existing.createdAt
		if (age < LOCK_TIMEOUT_MS && isProcessAlive(existing.pid)) {
			throw new Error('Another reconcile run is in progress')
		}
		await unlink(lockPath)
	}

	const payload: LockPayload = { pid: process.pid, createdAt: Date.now() }
	try {
		await writeFile(lockPath, JSON.stringify(payload), {
			encoding: 'utf8',
			mode: LOCK_MODE,
			flag: 'wx',
		})
	} catch (error: unknown) {
		if (
			error instanceof Error &&
			'code' in error &&
			(error as NodeJS.ErrnoException).code === 'EEXIST'
		) {
			throw new Error('Another reconcile run is in progress')
		}
		throw error
	}
}

/** Release the reconcile lock. */
export async function releaseLock(): Promise<void> {
	const lockPath = resolveLockPath()
	if (!existsSync(lockPath)) return
	await unlink(lockPath)
}
