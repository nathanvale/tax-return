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

interface TransactionsCommand {
	readonly command: 'transactions'
	readonly unreconciled: boolean
	readonly since: string | null
	readonly until: string | null
	readonly thisQuarter: boolean
	readonly lastQuarter: boolean
	readonly page: number | null
	readonly limit: number | null
	readonly summary: boolean
	readonly fields: readonly string[] | null
}

interface BankTransactionRecord {
	readonly BankTransactionID?: string
	readonly Type?: string
	readonly Date?: string
	readonly DateString?: string
	readonly Total?: number
	readonly Contact?: { Name?: string }
	readonly Reference?: string
}

interface TransactionsResponse {
	readonly BankTransactions: BankTransactionRecord[]
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

function parseDateParts(date: string): string {
	const [year, month, day] = date.split('-').map((part) => Number(part))
	if (!year || !month || !day) throw new Error('Invalid date format')
	return `DateTime(${year},${month},${day})`
}

function resolveQuarterRange(
	kind: 'this' | 'last',
	now: Date = new Date(),
): { since: string; until: string } {
	const year = now.getFullYear()
	const quarter = Math.floor(now.getMonth() / 3)
	const targetQuarter = kind === 'this' ? quarter : quarter - 1
	const targetYear = targetQuarter < 0 ? year - 1 : year
	const quarterIndex = (targetQuarter + 4) % 4
	const startMonth = quarterIndex * 3
	const start = new Date(Date.UTC(targetYear, startMonth, 1))
	const end = new Date(Date.UTC(targetYear, startMonth + 3, 0))
	const since = start.toISOString().slice(0, 10)
	const until = end.toISOString().slice(0, 10)
	return { since, until }
}

function summarizeTransactions(
	transactions: BankTransactionRecord[],
): string[] {
	const totalsByType = new Map<string, { count: number; total: number }>()
	const totalsByMonth = new Map<string, number>()
	const totalsByContact = new Map<string, number>()

	for (const txn of transactions) {
		const type = txn.Type ?? 'UNKNOWN'
		const amount = txn.Total ?? 0
		const current = totalsByType.get(type) ?? { count: 0, total: 0 }
		current.count += 1
		current.total += amount
		totalsByType.set(type, current)

		const dateRaw = txn.DateString ?? txn.Date ?? ''
		const month = dateRaw.slice(0, 7)
		if (month) {
			totalsByMonth.set(month, (totalsByMonth.get(month) ?? 0) + 1)
		}

		const contact = txn.Contact?.Name ?? 'Unknown'
		totalsByContact.set(contact, (totalsByContact.get(contact) ?? 0) + 1)
	}

	const typeLine = Array.from(totalsByType.entries())
		.map(
			([type, stats]) => `${type}: ${stats.count} (${stats.total.toFixed(2)})`,
		)
		.join(' | ')

	const monthLine = Array.from(totalsByMonth.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([month, count]) => `${month}: ${count}`)
		.join(' | ')

	const topContacts = Array.from(totalsByContact.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => `${name} (${count}x)`)
		.join(' | ')

	return [
		`By Type: ${typeLine}`,
		`By Month: ${monthLine}`,
		`Top 5: ${topContacts}`,
	]
}

/** List bank transactions with filters and summary options. */
export async function runTransactions(
	ctx: OutputContext,
	options: TransactionsCommand,
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

		let since = options.since
		let until = options.until
		if (options.thisQuarter) {
			const range = resolveQuarterRange('this')
			since = range.since
			until = range.until
		}
		if (options.lastQuarter) {
			const range = resolveQuarterRange('last')
			since = range.since
			until = range.until
		}
		if (!since && !until && options.summary) {
			const range = resolveQuarterRange('this')
			since = range.since
			until = range.until
		}
		const params = new URLSearchParams()
		const whereClauses: string[] = []

		if (options.unreconciled) {
			const unreconciledFilter =
				process.env.XERO_IS_RECONCILED_STRING === '1'
					? 'IsReconciled=="false"'
					: 'IsReconciled==false'
			whereClauses.push(unreconciledFilter)
		}
		if (since) {
			whereClauses.push(`Date>=${parseDateParts(since)}`)
		}
		if (until) {
			whereClauses.push(`Date<=${parseDateParts(until)}`)
		}

		if (whereClauses.length > 0) {
			params.set('where', whereClauses.join(' && '))
		}
		if (options.page) {
			params.set('page', String(options.page))
		}

		const path = params.toString()
			? `/BankTransactions?${params.toString()}`
			: '/BankTransactions'

		const response = await xeroFetch<TransactionsResponse>(
			path,
			{ method: 'GET' },
			{
				accessToken: tokens.accessToken,
				tenantId: config.tenantId,
				eventsConfig: ctx.eventsConfig,
			},
		)
		const transactions = response.BankTransactions ?? []
		const limited = options.limit
			? transactions.slice(0, options.limit)
			: transactions
		const projected = projectFields(
			limited as Record<string, unknown>[],
			options.fields,
		)

		if (!ctx.json && (options.summary || transactions.length > 50)) {
			const summaryLines = summarizeTransactions(transactions)
			writeSuccess(
				ctx,
				{
					command: 'transactions',
					count: transactions.length,
					transactions: projected,
				},
				[
					`Found ${transactions.length} transactions`,
					...summaryLines,
					'Use --limit 20 to see first 20 rows, or --json for full data.',
				],
				`${transactions.length}`,
			)
			return EXIT_OK
		}

		writeSuccess(
			ctx,
			{
				command: 'transactions',
				count: transactions.length,
				transactions: projected,
			},
			[`Found ${transactions.length} transactions`],
			`${transactions.length}`,
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
