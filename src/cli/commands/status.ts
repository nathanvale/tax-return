import { existsSync, lstatSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { xeroFetch } from '../../xero/api'
import { isTokenExpired, loadTokens } from '../../xero/auth'
import { loadEnvConfig, loadXeroConfig } from '../../xero/config'
import { XeroAuthError } from '../../xero/errors'
import type { ExitCode, OutputContext } from '../output'
import {
	EXIT_OK,
	EXIT_RUNTIME,
	EXIT_UNAUTHORIZED,
	EXIT_USAGE,
	writeSuccess,
} from '../output'

interface StatusCheck {
	readonly name: string
	readonly status: 'ok' | 'warning' | 'error'
	readonly message?: string
}

interface StatusData {
	readonly command: 'status'
	readonly checks: StatusCheck[]
	readonly diagnosis:
		| 'ok'
		| 'needs-auth'
		| 'invalid-config'
		| 'api-error'
		| 'keychain-locked'
		| 'keychain-denied'
		| 'fs-error'
	readonly nextAction:
		| 'NONE'
		| 'RUN_AUTH'
		| 'FIX_CONFIG'
		| 'RETRY'
		| 'UNLOCK_KEYCHAIN'
		| 'ALLOW_KEYCHAIN'
		| 'CHECK_FS'
}

/** Check auth + API connectivity. */
export async function runStatus(ctx: OutputContext): Promise<ExitCode> {
	const checks: StatusCheck[] = []
	let envOk = true
	let configOk = true
	let keychainOk = true
	let keychainLocked = false
	let keychainDenied = false
	let tokensExpired = false
	let apiOk = true
	let stateOk = true
	let lockOk = true
	let auditOk = true

	try {
		loadEnvConfig()
		checks.push({ name: 'env', status: 'ok' })
	} catch (err) {
		envOk = false
		checks.push({
			name: 'env',
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		})
	}

	let config: Awaited<ReturnType<typeof loadXeroConfig>> | null = null
	try {
		config = await loadXeroConfig()
		if (!config) {
			configOk = false
			checks.push({
				name: 'config',
				status: 'warning',
				message: 'Missing .xero-config.json (run auth)',
			})
		} else {
			checks.push({ name: 'config', status: 'ok' })
		}
	} catch (err) {
		configOk = false
		checks.push({
			name: 'config',
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		})
	}

	let tokens: Awaited<ReturnType<typeof loadTokens>> | null = null
	try {
		tokens = await loadTokens()
		tokensExpired = isTokenExpired(tokens.expiresAt)
		checks.push({
			name: 'keychain',
			status: tokensExpired ? 'warning' : 'ok',
			message: tokensExpired ? 'Token expired, re-auth required' : undefined,
		})
	} catch (err) {
		keychainOk = false
		if (err instanceof XeroAuthError) {
			if (err.code === 'E_KEYCHAIN_LOCKED') keychainLocked = true
			if (err.code === 'E_KEYCHAIN_DENIED') keychainDenied = true
			checks.push({
				name: 'keychain',
				status: 'error',
				message: err.message,
			})
		} else {
			checks.push({
				name: 'keychain',
				status: 'error',
				message: err instanceof Error ? err.message : String(err),
			})
		}
	}

	const statePath = path.join(process.cwd(), '.xero-reconcile-state.json')
	if (!existsSync(statePath)) {
		checks.push({
			name: 'state_file',
			status: 'warning',
			message: 'State file missing (ok for first run)',
		})
	} else {
		try {
			const info = lstatSync(statePath)
			if (info.isSymbolicLink()) {
				stateOk = false
				checks.push({
					name: 'state_file',
					status: 'error',
					message: 'State file is a symlink',
				})
			} else {
				checks.push({ name: 'state_file', status: 'ok' })
			}
		} catch (err) {
			stateOk = false
			checks.push({
				name: 'state_file',
				status: 'error',
				message: err instanceof Error ? err.message : String(err),
			})
		}
	}

	const lockPath = path.join(process.cwd(), '.xero-reconcile-lock.json')
	if (!existsSync(lockPath)) {
		checks.push({ name: 'lock_file', status: 'ok' })
	} else {
		try {
			const info = lstatSync(lockPath)
			if (info.isSymbolicLink()) {
				lockOk = false
				checks.push({
					name: 'lock_file',
					status: 'error',
					message: 'Lock file is a symlink',
				})
			} else {
				checks.push({
					name: 'lock_file',
					status: 'warning',
					message: 'Lock file present (another run may be active)',
				})
			}
		} catch (err) {
			lockOk = false
			checks.push({
				name: 'lock_file',
				status: 'error',
				message: err instanceof Error ? err.message : String(err),
			})
		}
	}

	const auditDir = path.join(process.cwd(), '.xero-reconcile-runs')
	if (!existsSync(auditDir)) {
		checks.push({
			name: 'audit_dir',
			status: 'warning',
			message: 'Audit dir missing (created on first execute)',
		})
	} else {
		try {
			const info = await stat(auditDir)
			if (!info.isDirectory()) {
				auditOk = false
				checks.push({
					name: 'audit_dir',
					status: 'error',
					message: 'Audit path is not a directory',
				})
			} else {
				checks.push({ name: 'audit_dir', status: 'ok' })
			}
		} catch (err) {
			auditOk = false
			checks.push({
				name: 'audit_dir',
				status: 'error',
				message: err instanceof Error ? err.message : String(err),
			})
		}
	}

	if (tokens && !tokensExpired && configOk && envOk && config) {
		try {
			await xeroFetch(
				'/Organisation',
				{ method: 'GET' },
				{
					accessToken: tokens.accessToken,
					tenantId: config.tenantId,
					eventsConfig: ctx.eventsConfig,
				},
			)
			checks.push({ name: 'api', status: 'ok' })
		} catch (err) {
			apiOk = false
			checks.push({
				name: 'api',
				status: 'error',
				message: err instanceof Error ? err.message : String(err),
			})
		}
	} else {
		checks.push({
			name: 'api',
			status: 'warning',
			message: 'Skipped API check (missing auth/config)',
		})
	}

	let diagnosis: StatusData['diagnosis'] = 'ok'
	let nextAction: StatusData['nextAction'] = 'NONE'

	if (!envOk || !configOk) {
		diagnosis = 'invalid-config'
		nextAction = 'FIX_CONFIG'
	} else if (keychainLocked) {
		diagnosis = 'keychain-locked'
		nextAction = 'UNLOCK_KEYCHAIN'
	} else if (keychainDenied) {
		diagnosis = 'keychain-denied'
		nextAction = 'ALLOW_KEYCHAIN'
	} else if (!keychainOk || tokensExpired) {
		diagnosis = 'needs-auth'
		nextAction = 'RUN_AUTH'
	} else if (!apiOk) {
		diagnosis = 'api-error'
		nextAction = 'RETRY'
	} else if (!stateOk || !lockOk || !auditOk) {
		diagnosis = 'fs-error'
		nextAction = 'CHECK_FS'
	}

	writeSuccess(
		ctx,
		{
			command: 'status',
			checks,
			diagnosis,
			nextAction,
		} satisfies StatusData,
		[`Status: ${diagnosis}`],
		diagnosis,
	)

	if (diagnosis === 'ok') return EXIT_OK
	if (diagnosis === 'needs-auth') return EXIT_UNAUTHORIZED
	if (diagnosis === 'invalid-config') return EXIT_USAGE
	if (diagnosis === 'api-error') return EXIT_RUNTIME
	if (diagnosis === 'keychain-locked' || diagnosis === 'keychain-denied')
		return EXIT_UNAUTHORIZED
	if (diagnosis === 'fs-error') return EXIT_RUNTIME
	return EXIT_OK
}
