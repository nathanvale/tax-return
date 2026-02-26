import { xeroFetch } from '../../xero/api'
import { loadValidTokens } from '../../xero/auth'
import { loadEnvConfig, loadXeroConfig } from '../../xero/config'
import { escapeODataValue } from '../../xero/odata'
import type { ExitCode, OutputContext } from '../output'
import {
	EXIT_OK,
	EXIT_UNAUTHORIZED,
	handleCommandError,
	projectFields,
	writeError,
	writeSuccess,
} from '../output'

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
			whereClauses.push(`Status=="${escapeODataValue(options.status)}"`)
		}
		if (options.type) {
			whereClauses.push(`Type=="${escapeODataValue(options.type)}"`)
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
		return handleCommandError(ctx, err)
	}
}
