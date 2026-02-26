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

interface InvoicesCommand {
	readonly command: 'invoices'
	readonly status: string | null
	readonly type: string | null
	readonly fields: readonly string[] | null
}

interface InvoiceRecord {
	readonly InvoiceID?: string
	readonly Contact?: { Name?: string }
	readonly Total?: number
	readonly AmountDue?: number
	readonly Status?: string
	readonly Type?: string
	readonly CurrencyCode?: string
}

interface InvoicesResponse {
	readonly Invoices: InvoiceRecord[]
}

interface InvoicesSuccessData {
	readonly command: 'invoices'
	readonly count: number
	readonly invoices: Record<string, unknown>[]
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

/** List outstanding invoices. */
export async function runInvoices(
	ctx: OutputContext,
	options: InvoicesCommand,
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

		const whereClauses = []
		if (options.status) {
			whereClauses.push(`Status=="${options.status}"`)
		}
		if (options.type) {
			whereClauses.push(`Type=="${options.type}"`)
		}

		const params = new URLSearchParams()
		if (whereClauses.length > 0) {
			params.set('where', whereClauses.join(' && '))
		}
		const path = params.toString()
			? `/Invoices?${params.toString()}`
			: '/Invoices?where=Status=="AUTHORISED"'

		const response = await xeroFetch<InvoicesResponse>(
			path,
			{ method: 'GET' },
			{
				accessToken: tokens.accessToken,
				tenantId: config.tenantId,
				eventsConfig: ctx.eventsConfig,
			},
		)
		const invoices = response.Invoices ?? []
		const projected = projectFields(
			invoices as Record<string, unknown>[],
			options.fields,
		)

		writeSuccess(
			ctx,
			{
				command: 'invoices',
				count: invoices.length,
				invoices: projected,
			} satisfies InvoicesSuccessData,
			[`Found ${invoices.length} invoices`],
			`${invoices.length}`,
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
