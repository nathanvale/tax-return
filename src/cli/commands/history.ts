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
const EXIT_USAGE = 2
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

interface HistoryCommand {
	readonly command: 'history'
	readonly since: string | null
	readonly contact: string | null
	readonly accountCode: string | null
	readonly fields: readonly string[] | null
}

interface BankTransactionRecord {
	readonly BankTransactionID?: string
	readonly Contact?: { Name?: string }
	readonly Total?: number
	readonly DateString?: string
	readonly Type?: string
	readonly CurrencyCode?: string
	readonly LineItems?: { AccountCode?: string }[]
}

interface TransactionsResponse {
	readonly BankTransactions: BankTransactionRecord[]
}

interface HistoryRow {
	readonly Contact: string
	readonly AccountCode: string
	readonly Count: number
	readonly AmountMin: number
	readonly AmountMax: number
	readonly Type: string
	readonly CurrencyCode: string
	readonly MostRecentDate: string
	readonly ExampleTransactionIDs: string[]
}

interface HistorySuccessData {
	readonly command: 'history'
	readonly count: number
	readonly transactions: HistoryRow[]
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

function groupHistory(transactions: BankTransactionRecord[]): HistoryRow[] {
	const groups = new Map<string, HistoryRow>()
	for (const txn of transactions) {
		const contact = txn.Contact?.Name ?? 'Unknown'
		const accountCode = txn.LineItems?.[0]?.AccountCode ?? 'UNKNOWN'
		const key = `${contact}::${accountCode}`
		const amount = txn.Total ?? 0
		const date = txn.DateString ?? ''
		const type = txn.Type ?? 'UNKNOWN'
		const currency = txn.CurrencyCode ?? 'UNKNOWN'
		const existing = groups.get(key)
		if (!existing) {
			groups.set(key, {
				Contact: contact,
				AccountCode: accountCode,
				Count: 1,
				AmountMin: amount,
				AmountMax: amount,
				Type: type,
				CurrencyCode: currency,
				MostRecentDate: date,
				ExampleTransactionIDs: txn.BankTransactionID
					? [txn.BankTransactionID]
					: [],
			})
		} else {
			const updated: HistoryRow = {
				...existing,
				Count: existing.Count + 1,
				AmountMin: Math.min(existing.AmountMin, amount),
				AmountMax: Math.max(existing.AmountMax, amount),
				MostRecentDate:
					date && date > existing.MostRecentDate
						? date
						: existing.MostRecentDate,
				ExampleTransactionIDs:
					existing.ExampleTransactionIDs.length < 3 && txn.BankTransactionID
						? [...existing.ExampleTransactionIDs, txn.BankTransactionID]
						: existing.ExampleTransactionIDs,
			}
			groups.set(key, updated)
		}
	}
	return Array.from(groups.values())
}

/** Group past reconciled transactions by contact + account code. */
export async function runHistory(
	ctx: OutputContext,
	options: HistoryCommand,
): Promise<ExitCode> {
	try {
		loadEnvConfig()
		if (!options.since) {
			writeError(ctx, 'history requires --since', 'E_USAGE', 'UsageError')
			return EXIT_USAGE
		}
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

		const whereClauses = [
			'IsReconciled==true',
			`Date>=DateTime(${options.since.split('-').join(',')})`,
		]
		if (options.contact) {
			whereClauses.push(`Contact.Name=="${options.contact}"`)
		}
		if (options.accountCode) {
			whereClauses.push(`LineItems.AccountCode=="${options.accountCode}"`)
		}
		const params = new URLSearchParams()
		params.set('where', whereClauses.join(' && '))

		const response = await xeroFetch<TransactionsResponse>(
			`/BankTransactions?${params.toString()}`,
			{ method: 'GET' },
			{
				accessToken: tokens.accessToken,
				tenantId: config.tenantId,
				eventsConfig: ctx.eventsConfig,
			},
		)
		const grouped = groupHistory(response.BankTransactions ?? [])
		const projected = options.fields
			? projectFields(
					grouped as unknown as Record<string, unknown>[],
					options.fields,
				)
			: grouped

		writeSuccess(
			ctx,
			{
				command: 'history',
				count: grouped.length,
				transactions: projected as HistoryRow[],
			} satisfies HistorySuccessData,
			[`Found ${grouped.length} grouped transactions`],
			`${grouped.length}`,
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
