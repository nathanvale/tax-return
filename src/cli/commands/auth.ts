import { existsSync } from 'node:fs'
import path from 'node:path'
import { emitEvent } from '../../events'
import { getXeroLogger } from '../../logging'
import { authenticate } from '../../xero/auth'
import { loadXeroConfig } from '../../xero/config'
import type { ExitCode, OutputContext } from '../output'
import {
	EXIT_OK,
	EXIT_USAGE,
	handleCommandError,
	writeError,
	writeSuccess,
} from '../output'

/** Logger for the auth command handler. */
const authCmdLogger = getXeroLogger(['cli', 'auth'])

interface AuthSuccessData {
	readonly command: 'auth'
	readonly tenantId: string | null
	readonly orgName: string
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
	authCmdLogger.debug('Checking for .env file')
	const envPath = path.join(process.cwd(), '.env')
	if (!existsSync(envPath)) {
		printSetupGuide()
		writeError(ctx, 'Missing .env file', 'E_USAGE', 'UsageError')
		return EXIT_USAGE
	}

	try {
		const scope =
			'accounting.banktransactions accounting.payments accounting.invoices accounting.contacts accounting.settings.read offline_access'

		authCmdLogger.info('Starting OAuth2 PKCE flow with scope={scope}', {
			scope,
		})
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
				headless: ctx.headless,
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
		authCmdLogger.info('Auth completed for org={orgName}', { orgName })

		writeSuccess(
			ctx,
			{
				command: 'auth',
				tenantId: config?.tenantId ?? null,
				orgName,
			} satisfies AuthSuccessData,
			[`Authenticated as "${orgName}"`, 'Tenant ID saved to .xero-config.json'],
			'Authenticated',
			undefined,
			ctx.headless ? 'result' : undefined,
		)
		emitEvent(ctx.eventsConfig, 'xero-auth-completed', {
			tenantId: config?.tenantId ?? null,
			orgName,
		})
		return EXIT_OK
	} catch (err) {
		const errorForEvent =
			err instanceof Error ? { message: err.message, code: 'E_RUNTIME' } : null
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			typeof err.code === 'string' &&
			errorForEvent
		) {
			errorForEvent.code = err.code
		}
		if (errorForEvent) {
			emitEvent(ctx.eventsConfig, 'xero-auth-failed', errorForEvent)
		}
		return handleCommandError(ctx, err)
	}
}
