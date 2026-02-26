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
			params.set('where', `Type=="${escapeODataValue(options.type)}"`)
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
		return handleCommandError(ctx, err)
	}
}
