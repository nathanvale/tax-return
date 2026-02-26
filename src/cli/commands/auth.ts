import { existsSync } from 'node:fs'
import path from 'node:path'
import { emitEvent } from '../../events'
import { authenticate } from '../../xero/auth'
import { loadXeroConfig } from '../../xero/config'
import {
	XeroApiError,
	XeroAuthError,
	XeroConflictError,
} from '../../xero/errors'

const EXIT_OK = 0
const EXIT_RUNTIME = 1
const EXIT_USAGE = 2
const EXIT_UNAUTHORIZED = 4

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130

interface AuthSuccessData {
	readonly command: 'auth'
	readonly tenantId: string | null
	readonly orgName: string
}

interface OutputContext {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: 'silent' | 'info' | 'debug'
	readonly progressMode: 'animated' | 'static' | 'off'
	readonly eventsConfig: ReturnType<
		typeof import('../../events').resolveEventsConfig
	>
}

const ERROR_CODE_ACTIONS: Record<
	string,
	{ action: string; retryable: boolean }
> = {
	E_RUNTIME: { action: 'ESCALATE', retryable: false },
	E_USAGE: { action: 'FIX_ARGS', retryable: false },
	E_UNAUTHORIZED: { action: 'RUN_AUTH', retryable: false },
	E_CONFLICT: { action: 'WAIT_AND_RETRY', retryable: true },
}

function writeSuccess<T>(
	ctx: OutputContext,
	data: T,
	humanLines: string[],
	quietLine: string,
): void {
	if (ctx.json) {
		process.stdout.write(
			`${JSON.stringify({ status: 'data', schemaVersion: 1, data })}\n`,
		)
		return
	}
	if (ctx.quiet) {
		process.stdout.write(`${quietLine}\n`)
		return
	}
	process.stdout.write(`${humanLines.join('\n')}\n`)
}

function writeError(
	ctx: OutputContext,
	message: string,
	errorCode: string,
	errorName: string,
	context?: Record<string, unknown>,
): void {
	if (ctx.json) {
		const fallback = { action: 'ESCALATE', retryable: false }
		const action = ERROR_CODE_ACTIONS[errorCode] ?? fallback
		const errorPayload: Record<string, unknown> = {
			name: errorName,
			code: errorCode,
			action: action.action,
			retryable: action.retryable,
		}
		if (context) errorPayload.context = context
		process.stderr.write(
			`${JSON.stringify({
				status: 'error',
				message,
				error: errorPayload,
			})}\n`,
		)
		return
	}
	const line = ctx.quiet ? message : `[xero-cli] ${message}`
	process.stderr.write(`${line}\n`)
}

function printSetupGuide(): void {
	const lines = [
		'xero-cli setup checklist:',
		'',
		'1. Create a Xero app at https://developer.xero.com/app/manage',
		'   - App type: "Auth Code with PKCE"',
		'   - Redirect URI: http://127.0.0.1:5555/callback',
		'   - Company or application URL: http://localhost',
		'',
		'2. Copy .env.example to .env:',
		'   cp .env.example .env',
		'',
		'3. Add your Client ID from the Xero app dashboard:',
		'   XERO_CLIENT_ID=YOUR_CLIENT_ID_HERE',
		'',
		'4. Run auth:',
		'   bun run xero-cli auth',
		'',
		'Common issues:',
		'- "redirect_uri mismatch" -- Xero requires EXACT match. Use http://127.0.0.1:5555/callback',
		'- "Keychain access denied" -- System Settings > Privacy & Security > allow Terminal',
		'- Multiple orgs -- after auth, check .xero-config.json for the selected org',
	]
	process.stderr.write(`${lines.join('\n')}\n`)
}

/** Run the OAuth2 PKCE auth flow. */
export async function runAuth(
	_ctx: OutputContext,
	options: { readonly authTimeoutMs: number | null },
): Promise<ExitCode> {
	const ctx = _ctx
	const envPath = path.join(process.cwd(), '.env')
	if (!existsSync(envPath)) {
		printSetupGuide()
		writeError(ctx, 'Missing .env file', 'E_USAGE', 'UsageError')
		return EXIT_USAGE
	}

	try {
		const scope =
			'accounting.banktransactions accounting.payments accounting.invoices accounting.contacts accounting.settings.read offline_access'

		emitEvent(ctx.eventsConfig, 'xero-auth-started', { scope })

		if (!ctx.json) {
			process.stderr.write('Opening Xero login in your browser...\n')
			process.stderr.write('Waiting for callback on 127.0.0.1:5555...\n')
		}

		const countdown = setInterval(() => {
			if (!ctx.json && !ctx.quiet) {
				process.stderr.write('Waiting for Xero login...\n')
			}
		}, 30_000)

		try {
			await authenticate(scope, {
				timeoutMs: options.authTimeoutMs ?? undefined,
				onTick: (remainingMs) => {
					if (ctx.json || ctx.quiet) return
					if (remainingMs % 60_000 < 1000) {
						const remaining = Math.max(1, Math.round(remainingMs / 1000))
						process.stderr.write(
							`Waiting for Xero login... (${remaining}s remaining)\n`,
						)
					}
				},
			})
		} finally {
			clearInterval(countdown)
		}

		const config = await loadXeroConfig()
		const orgName = config?.orgName ?? 'Unknown org'

		writeSuccess(
			ctx,
			{
				command: 'auth',
				tenantId: config?.tenantId ?? null,
				orgName,
			} satisfies AuthSuccessData,
			[
				`✓ Authenticated as "${orgName}"`,
				'Tenant ID saved to .xero-config.json',
			],
			'Authenticated',
		)
		emitEvent(ctx.eventsConfig, 'xero-auth-completed', {
			tenantId: config?.tenantId ?? null,
			orgName,
		})
		return EXIT_OK
	} catch (err) {
		if (err instanceof XeroAuthError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
			emitEvent(ctx.eventsConfig, 'xero-auth-failed', {
				message: err.message,
				code: err.code,
			})
			return EXIT_UNAUTHORIZED
		}
		if (err instanceof XeroConflictError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
			emitEvent(ctx.eventsConfig, 'xero-auth-failed', {
				message: err.message,
				code: err.code,
			})
			return EXIT_RUNTIME
		}
		if (err instanceof XeroApiError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
			emitEvent(ctx.eventsConfig, 'xero-auth-failed', {
				message: err.message,
				code: err.code,
			})
			return EXIT_RUNTIME
		}
		writeError(
			ctx,
			err instanceof Error ? err.message : String(err),
			'E_RUNTIME',
			'RuntimeError',
		)
		return EXIT_RUNTIME
	}
}
