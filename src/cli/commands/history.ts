import { xeroFetch } from '../../xero/api'
import { loadValidTokens } from '../../xero/auth'
import { loadEnvConfig, loadXeroConfig } from '../../xero/config'
import { escapeODataValue } from '../../xero/odata'
import type { ExitCode, OutputContext } from '../output'
import {
	EXIT_OK,
	EXIT_UNAUTHORIZED,
	EXIT_USAGE,
	handleCommandError,
	projectFields,
	writeError,
	writeSuccess,
} from '../output'

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
			whereClauses.push(`Contact.Name=="${escapeODataValue(options.contact)}"`)
		}
		if (options.accountCode) {
			whereClauses.push(
				`LineItems.AccountCode=="${escapeODataValue(options.accountCode)}"`,
			)
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
		return handleCommandError(ctx, err)
	}
}
