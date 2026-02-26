import { existsSync, lstatSync } from 'node:fs'
import {
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises'
import path from 'node:path'

const STATE_FILE = '.xero-reconcile-state.json'
const STATE_MODE = 0o600
const STATE_DIR_MODE = 0o700

export interface ReconcileState {
	readonly schemaVersion: number
	readonly processed: Record<string, true>
}

const EMPTY_STATE: ReconcileState = {
	schemaVersion: 1,
	processed: {},
}

function resolveStatePath(): string {
	return path.join(process.cwd(), STATE_FILE)
}

function assertSecureFile(targetPath: string): void {
	const statInfo = lstatSync(targetPath)
	if (statInfo.isSymbolicLink()) {
		throw new Error(`Refusing to read symlinked state file: ${targetPath}`)
	}
	const mode = statInfo.mode & 0o777
	if ((mode & 0o077) !== 0) {
		throw new Error(
			`State file permissions too open: ${targetPath} (${mode.toString(8)})`,
		)
	}
}

async function ensureStateDir(): Promise<void> {
	await mkdir(process.cwd(), { recursive: true, mode: STATE_DIR_MODE })
}

/** Load reconcile state from disk, or return empty state. */
export async function loadState(): Promise<ReconcileState> {
	const statePath = resolveStatePath()
	if (!existsSync(statePath)) return EMPTY_STATE
	assertSecureFile(statePath)
	const raw = await readFile(statePath, 'utf8')
	const parsed = JSON.parse(raw) as ReconcileState
	if (!parsed.schemaVersion || typeof parsed.schemaVersion !== 'number') {
		throw new Error('Invalid state file schemaVersion')
	}
	if (!parsed.processed || typeof parsed.processed !== 'object') {
		throw new Error('Invalid state file processed map')
	}
	return parsed
}

/** Save reconcile state atomically with secure permissions. */
export async function saveState(state: ReconcileState): Promise<void> {
	await ensureStateDir()
	const statePath = resolveStatePath()
	const tempPath = `${statePath}.tmp-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2)}`
	const payload = JSON.stringify(state, null, 2)
	await writeFile(tempPath, payload, {
		encoding: 'utf8',
		mode: STATE_MODE,
		flag: 'wx',
	})
	await rename(tempPath, statePath)
	const statInfo = await stat(statePath)
	const mode = statInfo.mode & 0o777
	if (mode !== STATE_MODE) {
		await unlink(statePath)
		throw new Error(`State file permissions incorrect: ${mode.toString(8)}`)
	}
}

/** Mark a BankTransactionID as processed in the state (immutable, creates a copy). */
export function markProcessed(
	state: ReconcileState,
	id: string,
): ReconcileState {
	return {
		...state,
		processed: { ...state.processed, [id]: true },
	}
}

/** Check if a BankTransactionID has been processed. */
export function isProcessed(state: ReconcileState, id: string): boolean {
	return Boolean(state.processed[id])
}

const DEFAULT_CHECKPOINT_INTERVAL = 50

/**
 * Batches state updates in memory and flushes to disk periodically.
 *
 * Avoids quadratic I/O from per-item markProcessed + saveState calls.
 * The processed map is mutated in place to avoid O(n^2) spread copies.
 * State is flushed every `checkpointInterval` dirty items and on explicit flush.
 */
export class StateBatcher {
	private readonly processed: Record<string, true>
	private readonly schemaVersion: number
	private dirtyCount = 0
	private readonly checkpointInterval: number

	constructor(
		initial: ReconcileState,
		checkpointInterval = DEFAULT_CHECKPOINT_INTERVAL,
	) {
		this.schemaVersion = initial.schemaVersion
		// Copy the initial processed map so we own the mutation
		this.processed = { ...initial.processed }
		this.checkpointInterval = checkpointInterval
	}

	/** Check if a BankTransactionID has been processed. */
	isProcessed(id: string): boolean {
		return Boolean(this.processed[id])
	}

	/**
	 * Mark a BankTransactionID as processed.
	 * Automatically flushes to disk every checkpointInterval items.
	 */
	async markProcessed(id: string): Promise<void> {
		this.processed[id] = true
		this.dirtyCount += 1
		if (this.dirtyCount >= this.checkpointInterval) {
			await this.flush()
		}
	}

	/** Persist current state to disk if there are unflushed changes. */
	async flush(): Promise<void> {
		if (this.dirtyCount === 0) return
		await saveState(this.snapshot())
		this.dirtyCount = 0
	}

	/** Return a readonly snapshot of the current state. */
	snapshot(): ReconcileState {
		return {
			schemaVersion: this.schemaVersion,
			processed: { ...this.processed },
		}
	}
}
