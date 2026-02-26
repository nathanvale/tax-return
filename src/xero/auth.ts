import { timingSafeEqual } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { EventsConfig } from '../events'
import { emitEvent } from '../events'
import { getXeroLogger } from '../logging'
import { isProcessAlive } from '../util/process'
import { loadEnvConfig, saveXeroConfig } from './config'
import { XeroApiError, XeroAuthError, XeroConflictError } from './errors'

const authLogger = getXeroLogger(['auth'])

const KEYCHAIN_SERVICE = 'xero-cli'
const KEYCHAIN_ACCOUNT = 'default'
const TOKEN_URL = 'https://identity.xero.com/connect/token'
const CONNECTIONS_URL = 'https://api.xero.com/connections'
const REVOCATION_URL = 'https://identity.xero.com/connect/revocation'
const REDIRECT_URI = 'http://127.0.0.1:5555/callback'
const AUTH_TIMEOUT_MS = 300_000
const REFRESH_LOCK_FILE = '.xero-token-refresh.lock'
const REFRESH_LOCK_TIMEOUT_MS = 30_000

interface TokenPayload {
	readonly access_token: string
	readonly refresh_token: string
	readonly expires_in: number
	readonly scope?: string
}

export interface StoredTokens {
	readonly accessToken: string
	readonly refreshToken: string
	readonly expiresAt: number
	readonly scope?: string
}

const TokenSchema = z.object({
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1),
	expiresAt: z.number().int().positive(),
	scope: z.string().optional(),
})

interface ConnectionResponse {
	readonly tenantId: string
	readonly tenantName: string
}

/** Check if running in a test environment (bun test sets NODE_ENV=test). */
function isTestEnvironment(): boolean {
	return process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test'
}

function base64UrlEncode(data: Uint8Array): string {
	return Buffer.from(data)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '')
}

function generateCodeVerifier(): string {
	const buffer = new Uint8Array(48)
	crypto.getRandomValues(buffer)
	return base64UrlEncode(buffer)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const hash = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(verifier),
	)
	return base64UrlEncode(new Uint8Array(hash))
}

function buildAuthUrl(
	codeChallenge: string,
	state: string,
	scope: string,
): string {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: loadEnvConfig().clientId,
		redirect_uri: REDIRECT_URI,
		scope,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
		state,
	})
	return `https://login.xero.com/identity/connect/authorize?${params}`
}

/** Detect whether we are running in a headless/non-interactive environment. */
export function isHeadless(): boolean {
	if (process.env.XERO_HEADLESS === '1') return true
	return !process.stdout.isTTY
}

function openBrowser(url: string): void {
	Bun.spawn(['open', url], { stdio: ['ignore', 'ignore', 'ignore'] })
}

function parseKeychainOutput(raw: string): StoredTokens | null {
	if (!raw.trim()) return null
	const parsed = JSON.parse(raw) as StoredTokens
	const validated = TokenSchema.safeParse(parsed)
	if (!validated.success) {
		throw new XeroAuthError('Corrupted tokens in Keychain. Re-auth required.', {
			code: 'E_UNAUTHORIZED',
			recoverable: false,
		})
	}
	return validated.data
}

function classifyKeychainError(message: string): {
	readonly code: string
	readonly message: string
} {
	const normalized = message.toLowerCase()
	if (normalized.includes('could not be found')) {
		return { code: 'E_NOT_FOUND', message: 'Keychain entry not found' }
	}
	if (normalized.includes('user interaction is not allowed')) {
		return { code: 'E_KEYCHAIN_LOCKED', message: 'Keychain is locked' }
	}
	if (
		normalized.includes('authorization denied') ||
		normalized.includes('not permitted')
	) {
		return { code: 'E_KEYCHAIN_DENIED', message: 'Keychain access denied' }
	}
	return { code: 'E_KEYCHAIN_ERROR', message: `Keychain error: ${message}` }
}

async function readKeychain(): Promise<StoredTokens | null> {
	if (process.env.XERO_TEST_TOKENS) {
		if (!isTestEnvironment()) {
			authLogger.warn(
				'XERO_TEST_TOKENS is set but NODE_ENV/BUN_ENV is not "test" -- ignoring for safety.',
			)
		} else {
			try {
				const parsed = JSON.parse(process.env.XERO_TEST_TOKENS) as StoredTokens
				const validated = TokenSchema.safeParse(parsed)
				if (!validated.success) {
					throw new Error('Invalid token shape')
				}
				return validated.data
			} catch {
				throw new XeroAuthError('Invalid XERO_TEST_TOKENS payload')
			}
		}
	}
	authLogger.debug('Reading tokens from Keychain.')
	const proc = Bun.spawn([
		'security',
		'find-generic-password',
		'-s',
		KEYCHAIN_SERVICE,
		'-a',
		KEYCHAIN_ACCOUNT,
		'-w',
	])

	const output = await streamToString(proc.stdout ?? null)
	const errorOutput = await streamToString(proc.stderr ?? null)
	const exitCode = await proc.exited
	if (exitCode === 0) {
		const tokens = parseKeychainOutput(output)
		authLogger.debug('Keychain read result: token={token}', {
			token: tokens ? 'present' : 'missing',
		})
		return tokens
	}
	const info = classifyKeychainError(errorOutput.trim())
	if (info.code === 'E_NOT_FOUND') {
		authLogger.debug('Keychain entry not found.')
		return null
	}
	throw new XeroAuthError(info.message, {
		code: info.code,
		recoverable: false,
	})
}

/**
 * Write tokens to the macOS Keychain.
 *
 * Security: The token payload is passed via an environment variable rather than
 * a command-line argument. CLI args are visible to all users via `ps aux`, but
 * env vars are only readable by the process owner (not exposed by `ps` on
 * macOS). We spawn `sh -c` which reads $__XERO_KCP and forwards it as the
 * `-w` value to `security add-generic-password`.
 */
async function writeKeychain(tokens: StoredTokens): Promise<void> {
	if (process.env.XERO_TEST_TOKENS && isTestEnvironment()) return
	authLogger.debug('Writing tokens to Keychain.')
	const payload = JSON.stringify(tokens)
	const proc = Bun.spawn(
		[
			'sh',
			'-c',
			`security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -U -w "$__XERO_KCP"`,
		],
		{
			env: { ...process.env, __XERO_KCP: payload },
		},
	)
	const errorOutput = await streamToString(proc.stderr ?? null)
	const exitCode = await proc.exited
	if (exitCode !== 0) {
		const info = classifyKeychainError(errorOutput.trim())
		throw new XeroAuthError(info.message, {
			code: info.code,
			recoverable: false,
		})
	}
}

async function deleteKeychain(): Promise<void> {
	if (process.env.XERO_TEST_TOKENS && isTestEnvironment()) return
	authLogger.debug('Deleting tokens from Keychain.')
	const proc = Bun.spawn([
		'security',
		'delete-generic-password',
		'-s',
		KEYCHAIN_SERVICE,
		'-a',
		KEYCHAIN_ACCOUNT,
	])
	const errorOutput = await streamToString(proc.stderr ?? null)
	const exitCode = await proc.exited
	if (exitCode !== 0) {
		const info = classifyKeychainError(errorOutput.trim())
		if (info.code === 'E_NOT_FOUND') return
		throw new XeroAuthError(info.message, {
			code: info.code,
			recoverable: false,
		})
	}
}

export interface AuthProvider {
	readonly loadTokens: () => Promise<StoredTokens | null>
	readonly saveTokens: (tokens: StoredTokens) => Promise<void>
	readonly deleteTokens: () => Promise<void>
}

class KeychainAuthProvider implements AuthProvider {
	async loadTokens(): Promise<StoredTokens | null> {
		return await readKeychain()
	}
	async saveTokens(tokens: StoredTokens): Promise<void> {
		await writeKeychain(tokens)
	}
	async deleteTokens(): Promise<void> {
		await deleteKeychain()
	}
}

export class InMemoryAuthProvider implements AuthProvider {
	private tokens: StoredTokens | null

	constructor(tokens?: StoredTokens | null) {
		this.tokens = tokens ?? null
	}

	async loadTokens(): Promise<StoredTokens | null> {
		return this.tokens
	}

	async saveTokens(tokens: StoredTokens): Promise<void> {
		this.tokens = tokens
	}

	async deleteTokens(): Promise<void> {
		this.tokens = null
	}
}

let authProvider: AuthProvider = new KeychainAuthProvider()

export function setAuthProvider(provider: AuthProvider): void {
	authProvider = provider
}

export function resetAuthProvider(): void {
	authProvider = new KeychainAuthProvider()
}

async function streamToString(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (!stream) return ''
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	while (true) {
		const { value, done } = await reader.read()
		if (done) break
		if (value) chunks.push(value)
	}
	return Buffer.concat(chunks).toString('utf8')
}

function stateEquals(a: string, b: string): boolean {
	const left = Buffer.from(a)
	const right = Buffer.from(b)
	if (left.length !== right.length) return false
	return timingSafeEqual(left, right)
}

async function exchangeToken(
	code: string,
	verifier: string,
): Promise<StoredTokens> {
	const { clientId } = loadEnvConfig()
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: clientId,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	})
	if (!response.ok) {
		const payload = await response.text().catch(() => '')
		throw new XeroApiError(`Token exchange failed: ${payload}`, {
			code: 'E_UNAUTHORIZED',
			recoverable: false,
			status: response.status,
		})
	}
	const data = (await response.json()) as TokenPayload
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Date.now() + data.expires_in * 1000,
		scope: data.scope,
	}
}

async function fetchConnections(
	accessToken: string,
): Promise<ConnectionResponse[]> {
	const response = await fetch(CONNECTIONS_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/json',
		},
	})
	if (!response.ok) {
		const payload = await response.text().catch(() => '')
		throw new XeroApiError(`Connections fetch failed: ${payload}`, {
			code: 'E_API_ERROR',
			recoverable: false,
			status: response.status,
		})
	}
	return (await response.json()) as ConnectionResponse[]
}

async function refreshToken(tokens: StoredTokens): Promise<StoredTokens> {
	const { clientId } = loadEnvConfig()
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: clientId,
			refresh_token: tokens.refreshToken,
		}),
	})
	if (!response.ok) {
		const payload = await response.text().catch(() => '')
		throw new XeroAuthError(`Token refresh failed: ${payload}`, {
			code: 'E_UNAUTHORIZED',
			recoverable: false,
		})
	}
	const data = (await response.json()) as TokenPayload
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Date.now() + data.expires_in * 1000,
		scope: data.scope ?? tokens.scope,
	}
}

function resolveRefreshLockPath(): string {
	return `${process.cwd()}/${REFRESH_LOCK_FILE}`
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
	const lockPath = resolveRefreshLockPath()
	const start = Date.now()
	while (true) {
		try {
			await writeFile(
				lockPath,
				JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
				{ mode: 0o600, flag: 'wx' },
			)
			break
		} catch {
			try {
				const raw = await readFile(lockPath, 'utf8')
				const parsed = JSON.parse(raw) as { pid?: number; createdAt?: number }
				if (parsed.pid && isProcessAlive(parsed.pid)) {
					if (Date.now() - start > REFRESH_LOCK_TIMEOUT_MS) {
						throw new XeroConflictError('Token refresh already in progress', {
							code: 'E_LOCK_CONTENTION',
							recoverable: true,
						})
					}
					await new Promise((resolve) => setTimeout(resolve, 200))
					continue
				}
				await unlink(lockPath)
			} catch (err) {
				if (err instanceof XeroConflictError) throw err
				if (Date.now() - start > REFRESH_LOCK_TIMEOUT_MS) {
					throw new XeroConflictError('Token refresh already in progress', {
						code: 'E_LOCK_CONTENTION',
						recoverable: true,
					})
				}
				await new Promise((resolve) => setTimeout(resolve, 200))
			}
		}
	}

	try {
		return await fn()
	} finally {
		try {
			await unlink(lockPath)
		} catch {
			// ignore
		}
	}
}

interface AuthWaitOptions {
	readonly timeoutMs?: number
	readonly onTick?: (remainingMs: number) => void
	/** When true, emit auth_url as NDJSON instead of opening a browser.
	 *  Callers should derive this from OutputContext.headless so there is
	 *  a single source of truth for headless detection. */
	readonly headless?: boolean
}

/** Start the OAuth callback server and return the code promise. */
export async function waitForAuthCode(
	state: string,
	options?: AuthWaitOptions,
): Promise<string> {
	let resolveCode: (code: string) => void
	let rejectCode: (err: Error) => void
	const codePromise = new Promise<string>((resolve, reject) => {
		resolveCode = resolve
		rejectCode = reject
	})

	const server = Bun.serve({
		port: 5555,
		hostname: '127.0.0.1',
		fetch(req) {
			const url = new URL(req.url)
			if (url.pathname !== '/callback') {
				return new Response('Not found', { status: 404 })
			}
			const code = url.searchParams.get('code')
			const returnedState = url.searchParams.get('state')
			if (!code || !returnedState || !stateEquals(returnedState, state)) {
				rejectCode(new XeroAuthError('Invalid auth callback state'))
				queueMicrotask(() => server.stop())
				return new Response('Invalid callback', { status: 400 })
			}
			resolveCode(code)
			queueMicrotask(() => server.stop())
			return new Response(
				'<h1>Authenticated</h1><p>You can close this tab.</p>',
				{
					headers: {
						'Content-Type': 'text/html; charset=utf-8',
						'X-Content-Type-Options': 'nosniff',
					},
				},
			)
		},
	})

	const timeoutMs = options?.timeoutMs ?? AUTH_TIMEOUT_MS
	const start = Date.now()
	const timeout = setTimeout(() => {
		rejectCode(
			new XeroAuthError(
				`Auth timed out after ${Math.round(timeoutMs / 1000)}s`,
			),
		)
		server.stop()
	}, timeoutMs)

	const tick = setInterval(() => {
		const remaining = timeoutMs - (Date.now() - start)
		if (remaining <= 0) return
		options?.onTick?.(remaining)
	}, 1000)

	return codePromise.finally(() => {
		clearTimeout(timeout)
		clearInterval(tick)
	})
}

/** Revoke a single token via Xero's revocation endpoint. */
async function revokeToken(token: string): Promise<void> {
	const { clientId } = loadEnvConfig()
	const response = await fetch(REVOCATION_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			token,
			token_type_hint: 'refresh_token',
			client_id: clientId,
		}),
	})
	if (!response.ok) {
		const payload = await response.text().catch(() => '')
		throw new XeroAuthError(`Token revocation failed: ${payload}`, {
			code: 'E_UNAUTHORIZED',
			recoverable: false,
		})
	}
}

async function revokeStoredTokens(tokens: StoredTokens | null): Promise<void> {
	if (!tokens) return
	await revokeToken(tokens.refreshToken)
}

export async function authenticate(
	scope: string,
	options?: AuthWaitOptions,
): Promise<{ tenantId: string }> {
	authLogger.debug('Starting PKCE auth flow with scope={scope}', { scope })
	const verifier = generateCodeVerifier()
	const challenge = await generateCodeChallenge(verifier)
	const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
	const authUrl = buildAuthUrl(challenge, state, scope)

	const headless = options?.headless ?? isHeadless()
	if (headless) {
		const payload = JSON.stringify({ phase: 'auth_url', authUrl })
		process.stdout.write(`${payload}\n`)
	} else {
		openBrowser(authUrl)
	}
	const code = await waitForAuthCode(state, options)
	authLogger.debug('Auth callback received, exchanging code for tokens.')
	const tokens = await exchangeToken(code, verifier)
	const existing = await authProvider.loadTokens()
	await revokeStoredTokens(existing)
	await authProvider.saveTokens(tokens)
	authLogger.debug('Tokens saved after initial auth.')

	const connections = await fetchConnections(tokens.accessToken)
	const primary = connections[0]
	if (!primary) {
		throw new XeroAuthError('No Xero tenants available', {
			code: 'E_NOT_FOUND',
			recoverable: false,
		})
	}
	await saveXeroConfig({
		tenantId: primary.tenantId,
		orgName: primary.tenantName,
	})
	return { tenantId: primary.tenantId }
}

/** Load tokens from Keychain, validating presence. */
export async function loadTokens(): Promise<StoredTokens> {
	const tokens = await authProvider.loadTokens()
	if (!tokens) {
		throw new XeroAuthError('Not authenticated. Run: bun run xero-cli auth', {
			code: 'E_UNAUTHORIZED',
			recoverable: false,
		})
	}
	return tokens
}

/** Load tokens and refresh if expired (uses refresh lock). */
export async function loadValidTokens(
	eventsConfig?: EventsConfig,
): Promise<StoredTokens> {
	const tokens = await loadTokens()
	if (!isTokenExpired(tokens.expiresAt)) return tokens
	authLogger.debug('Token expired, attempting refresh.')
	const refreshStart = Date.now()
	return await withRefreshLock(async () => {
		authLogger.info('Token refresh lock acquired.')
		const fresh = await authProvider.loadTokens()
		if (!fresh) {
			throw new XeroAuthError('Not authenticated. Run: bun run xero-cli auth', {
				code: 'E_UNAUTHORIZED',
				recoverable: false,
			})
		}
		if (!isTokenExpired(fresh.expiresAt)) {
			authLogger.debug('Token refreshed by another process, skipping.')
			if (eventsConfig) {
				emitEvent(eventsConfig, 'xero-auth-refreshed', {
					skipped: true,
					durationMs: Date.now() - refreshStart,
				})
			}
			return fresh
		}
		let refreshed: StoredTokens
		try {
			refreshed = await refreshToken(fresh)
		} catch (err) {
			authLogger.warn('Token refresh failed: {message}', {
				message: err instanceof Error ? err.message : String(err),
			})
			if (eventsConfig) {
				emitEvent(eventsConfig, 'xero-auth-refresh-failed', {
					error: err instanceof Error ? err.message : String(err),
				})
			}
			throw err
		}
		try {
			await authProvider.saveTokens(refreshed)
		} catch (_err) {
			authLogger.warn('Token refresh succeeded but failed to save tokens.')
			if (eventsConfig) {
				emitEvent(eventsConfig, 'xero-auth-refresh-failed', {
					error: 'Token refresh succeeded but could not save new tokens',
				})
			}
			throw new XeroAuthError(
				'Token refresh succeeded but could not save new tokens. Re-auth required.',
				{ code: 'E_UNAUTHORIZED', recoverable: false },
			)
		}
		authLogger.debug('Token refreshed and saved successfully.')
		if (eventsConfig) {
			emitEvent(eventsConfig, 'xero-auth-refreshed', {
				skipped: false,
				durationMs: Date.now() - refreshStart,
			})
		}
		return refreshed
	})
}

/** Load tokens without throwing on missing. */
export async function loadTokensRaw(): Promise<StoredTokens | null> {
	return await authProvider.loadTokens()
}

/** Best-effort check for expired tokens. */
export function isTokenExpired(
	expiresAt: number,
	skewMs = 5 * 60 * 1000,
): boolean {
	return Date.now() + skewMs >= expiresAt
}
