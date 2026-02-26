import { xeroFetch } from '../../xero/api'
import { loadValidTokens } from '../../xero/auth'
import { loadEnvConfig, loadXeroConfig } from '../../xero/config'
import {
	XeroApiError,
	XeroAuthError,
	XeroConflictError,
} from '../../xero/errors'

const EXIT_OK = 0
const EXIT_RUNTIME = 1
const EXIT_UNAUTHORIZED = 4

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130

interface OutputContext {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: 'silent' | 'info' | 'debug'
	readonly progressMode: 'animated' | 'static' | 'off'
	readonly eventsConfig: ReturnType<
		typeof import('../../events').resolveEventsConfig
	>
}

interface AccountsCommand {
	readonly command: 'accounts'
	readonly type: string | null
	readonly fields: readonly string[] | null
}

interface AccountRecord {
	readonly AccountID?: string
	readonly Code?: string
	readonly Name?: string
	readonly Type?: string
	readonly Status?: string
	readonly Description?: string
}

interface AccountsResponse {
	readonly Accounts: AccountRecord[]
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

function projectFields<T extends Record<string, unknown>>(
	records: T[],
	fields: readonly string[] | null,
): Record<string, unknown>[] {
	if (!fields) return records
	return records.map((record) => {
		const projected: Record<string, unknown> = {}
		for (const field of fields) {
			const parts = field.split('.')
			let value: unknown = record
			for (const part of parts) {
				if (value && typeof value === 'object' && part in value) {
					value = (value as Record<string, unknown>)[part]
				} else {
					value = undefined
					break
				}
			}
			projected[field] = value
		}
		return projected
	})
}

/** List chart of accounts with optional type filter. */
export async function runAccounts(
	ctx: OutputContext,
	options: AccountsCommand,
): Promise<ExitCode> {
	try {
		loadEnvConfig()
		const tokens = await loadValidTokens()
		const config = await loadXeroConfig()
		if (!config) {
			writeError(
				ctx,
				'Missing tenant config. Run: bun run xero-cli auth',
				'E_UNAUTHORIZED',
				'XeroAuthError',
			)
			return EXIT_UNAUTHORIZED
		}

		const params = new URLSearchParams()
		if (options.type) {
			params.set('where', `Type=="${options.type}"`)
		}
		const path = params.toString()
			? `/Accounts?${params.toString()}`
			: '/Accounts'

		const response = await xeroFetch<AccountsResponse>(
			path,
			{ method: 'GET' },
			{
				accessToken: tokens.accessToken,
				tenantId: config.tenantId,
				eventsConfig: ctx.eventsConfig,
			},
		)
		const accounts = response.Accounts ?? []
		const projected = projectFields(
			accounts as Record<string, unknown>[],
			options.fields,
		)

		writeSuccess(
			ctx,
			{
				command: 'accounts',
				count: accounts.length,
				accounts: projected,
			},
			[`Found ${accounts.length} accounts`],
			`${accounts.length}`,
		)
		return EXIT_OK
	} catch (err) {
		if (err instanceof XeroAuthError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
			return EXIT_UNAUTHORIZED
		}
		if (err instanceof XeroConflictError || err instanceof XeroApiError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
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
