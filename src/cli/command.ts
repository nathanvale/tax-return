import { randomUUID } from 'node:crypto'
import { resolveEventsConfig } from '../events'
import { setupLogging, shutdownLogging, withContext } from '../logging'
import { runAccounts } from './commands/accounts'
import { runAuth } from './commands/auth'
import { runHistory } from './commands/history'
import { runInvoices } from './commands/invoices'
import { runReconcile } from './commands/reconcile'
import { runStatus } from './commands/status'
import { runTransactions } from './commands/transactions'

const EXIT_OK = 0
const EXIT_RUNTIME = 1
const EXIT_USAGE = 2
const _EXIT_NOT_FOUND = 3
const _EXIT_UNAUTHORIZED = 4
const _EXIT_CONFLICT = 5
const EXIT_INTERRUPTED = 130

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130

const SCHEMA_VERSION_OUTPUT = 1

type LogLevel = 'silent' | 'info' | 'debug'
type ProgressMode = 'animated' | 'static' | 'off'

interface OutputContext {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: LogLevel
	readonly progressMode: ProgressMode
	readonly eventsConfig: ReturnType<typeof resolveEventsConfig>
}

interface GlobalFlags {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: LogLevel
	readonly progressMode: ProgressMode
	readonly eventsConfig: ReturnType<typeof resolveEventsConfig>
}

interface AuthCommand extends GlobalFlags {
	readonly command: 'auth'
	readonly authTimeoutMs: number | null
}

interface StatusCommand extends GlobalFlags {
	readonly command: 'status'
}

interface AccountsCommand extends GlobalFlags {
	readonly command: 'accounts'
	readonly type: string | null
	readonly fields: readonly string[] | null
}

interface TransactionsCommand extends GlobalFlags {
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

interface HistoryCommand extends GlobalFlags {
	readonly command: 'history'
	readonly since: string | null
	readonly contact: string | null
	readonly accountCode: string | null
	readonly fields: readonly string[] | null
}

interface InvoicesCommand extends GlobalFlags {
	readonly command: 'invoices'
	readonly status: string | null
	readonly type: string | null
	readonly fields: readonly string[] | null
}

interface HelpCommand extends GlobalFlags {
	readonly command: 'help'
	readonly topic: string | null
}

interface ReconcileCommand extends GlobalFlags {
	readonly command: 'reconcile'
	readonly execute: boolean
	readonly fromCsv: string | null
}

type CliOptions =
	| AuthCommand
	| StatusCommand
	| AccountsCommand
	| TransactionsCommand
	| HistoryCommand
	| InvoicesCommand
	| ReconcileCommand
	| HelpCommand

interface ParseCliError {
	readonly ok: false
	readonly exitCode: ExitCode
	readonly message: string
	readonly output: string
	readonly errorCode: string
	readonly context?: Record<string, unknown>
	readonly json: boolean
	readonly quiet: boolean
}

interface ParseCliOk {
	readonly ok: true
	readonly options: CliOptions
}

type ParseCliResult = ParseCliError | ParseCliOk

/** Parse argv into structured command options.
 *  Returns a discriminated union instead of throwing to preserve output mode. */
function parseCli(argv: readonly string[]): ParseCliResult {
	const args = argv.slice(2)
	const preFlags = new Set(args)
	let commandToken: string | null = null
	let json = preFlags.has('--json')
	let quiet = preFlags.has('--quiet')
	let verbose = preFlags.has('--verbose')
	let debug = preFlags.has('--debug')
	let help = false
	let topic: string | null = null
	let eventsUrl: string | null = null
	let authTimeoutRaw: string | null = null
	let fieldsRaw: string | null = null
	let typeRaw: string | null = null
	let sinceRaw: string | null = null
	let untilRaw: string | null = null
	let pageRaw: string | null = null
	let limitRaw: string | null = null
	let unreconciled = false
	let summary = false
	let thisQuarter = false
	let lastQuarter = false
	let execute = false
	let fromCsv: string | null = null
	let contactRaw: string | null = null
	let accountCodeRaw: string | null = null
	let statusRaw: string | null = null

	for (let i = 0; i < args.length; i += 1) {
		const token = args[i]
		if (!token) continue
		if (token === '--json') {
			json = true
			continue
		}
		if (token === '--quiet') {
			quiet = true
			continue
		}
		if (token === '--verbose') {
			verbose = true
			continue
		}
		if (token === '--debug') {
			debug = true
			continue
		}
		if (token === '--unreconciled') {
			unreconciled = true
			continue
		}
		if (token === '--summary') {
			summary = true
			continue
		}
		if (token === '--this-quarter') {
			thisQuarter = true
			continue
		}
		if (token === '--last-quarter') {
			lastQuarter = true
			continue
		}
		if (token === '--execute') {
			execute = true
			continue
		}
		if (token === '--dry-run') {
			execute = false
			continue
		}
		if (token === '--from-csv') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --from-csv', json, quiet)
			}
			fromCsv = value
			i += 1
			continue
		}
		if (token === '--contact') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --contact', json, quiet)
			}
			contactRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--contact=')) {
			const value = token.slice('--contact='.length)
			if (!value) {
				return parseUsageError('Missing value for --contact', json, quiet)
			}
			contactRaw = value
			continue
		}
		if (token === '--account-code') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --account-code', json, quiet)
			}
			accountCodeRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--account-code=')) {
			const value = token.slice('--account-code='.length)
			if (!value) {
				return parseUsageError('Missing value for --account-code', json, quiet)
			}
			accountCodeRaw = value
			continue
		}
		if (token === '--status') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --status', json, quiet)
			}
			statusRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--status=')) {
			const value = token.slice('--status='.length)
			if (!value) {
				return parseUsageError('Missing value for --status', json, quiet)
			}
			statusRaw = value
			continue
		}
		if (token.startsWith('--from-csv=')) {
			const value = token.slice('--from-csv='.length)
			if (!value) {
				return parseUsageError('Missing value for --from-csv', json, quiet)
			}
			fromCsv = value
			continue
		}
		if (token === '--events-url') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --events-url', json, quiet)
			}
			eventsUrl = value
			i += 1
			continue
		}
		if (token.startsWith('--events-url=')) {
			const value = token.slice('--events-url='.length)
			if (!value) {
				return parseUsageError('Missing value for --events-url', json, quiet)
			}
			eventsUrl = value
			continue
		}
		if (token === '--auth-timeout') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --auth-timeout', json, quiet)
			}
			authTimeoutRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--auth-timeout=')) {
			const value = token.slice('--auth-timeout='.length)
			if (!value) {
				return parseUsageError('Missing value for --auth-timeout', json, quiet)
			}
			authTimeoutRaw = value
			continue
		}
		if (token === '--help' || token === '-h') {
			help = true
			continue
		}
		if (token === '--fields') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --fields', json, quiet)
			}
			fieldsRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--fields=')) {
			const value = token.slice('--fields='.length)
			if (!value) {
				return parseUsageError('Missing value for --fields', json, quiet)
			}
			fieldsRaw = value
			continue
		}
		if (token === '--type') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --type', json, quiet)
			}
			typeRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--type=')) {
			const value = token.slice('--type='.length)
			if (!value) {
				return parseUsageError('Missing value for --type', json, quiet)
			}
			typeRaw = value
			continue
		}
		if (token === '--since') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --since', json, quiet)
			}
			sinceRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--since=')) {
			const value = token.slice('--since='.length)
			if (!value) {
				return parseUsageError('Missing value for --since', json, quiet)
			}
			sinceRaw = value
			continue
		}
		if (token === '--until') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --until', json, quiet)
			}
			untilRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--until=')) {
			const value = token.slice('--until='.length)
			if (!value) {
				return parseUsageError('Missing value for --until', json, quiet)
			}
			untilRaw = value
			continue
		}
		if (token === '--page') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --page', json, quiet)
			}
			pageRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--page=')) {
			const value = token.slice('--page='.length)
			if (!value) {
				return parseUsageError('Missing value for --page', json, quiet)
			}
			pageRaw = value
			continue
		}
		if (token === '--limit') {
			const value = args[i + 1]
			if (!value || value.startsWith('--')) {
				return parseUsageError('Missing value for --limit', json, quiet)
			}
			limitRaw = value
			i += 1
			continue
		}
		if (token.startsWith('--limit=')) {
			const value = token.slice('--limit='.length)
			if (!value) {
				return parseUsageError('Missing value for --limit', json, quiet)
			}
			limitRaw = value
			continue
		}
		if (token.startsWith('-')) {
			return parseUsageError(`Unknown option: ${token}`, json, quiet)
		}
		if (!commandToken) {
			commandToken = token
			continue
		}
		if (!topic) {
			topic = token
			continue
		}
		return parseUsageError(`Unexpected extra argument: ${token}`, json, quiet)
	}

	if (!commandToken) {
		commandToken = 'help'
	}

	if (help) {
		commandToken = 'help'
	}
	if (commandToken === '--version') {
		commandToken = 'version'
	}
	if (commandToken === 'tx') commandToken = 'transactions'
	if (commandToken === 'acct') commandToken = 'accounts'
	if (commandToken === 'inv') commandToken = 'invoices'
	if (commandToken === 'rec') commandToken = 'reconcile'
	if (commandToken === 'hist') commandToken = 'history'

	const outputMode = resolveOutputMode({
		json,
		quiet,
		verbose,
		debug,
		eventsUrl,
	})

	if (commandToken === 'auth') {
		const authTimeoutMs = authTimeoutRaw ? Number(authTimeoutRaw) * 1000 : null
		if (authTimeoutRaw && (!authTimeoutMs || authTimeoutMs <= 0)) {
			return parseUsageError('Invalid --auth-timeout value', json, quiet)
		}
		return {
			ok: true,
			options: {
				command: 'auth',
				...outputMode,
				authTimeoutMs,
			},
		}
	}
	if (commandToken === 'status') {
		return { ok: true, options: { command: 'status', ...outputMode } }
	}
	if (commandToken === 'accounts') {
		const { fields, error } = parseFields(fieldsRaw, json, quiet)
		if (error) return error
		return {
			ok: true,
			options: {
				command: 'accounts',
				...outputMode,
				type: typeRaw,
				fields,
			},
		}
	}
	if (commandToken === 'transactions') {
		const { fields, error } = parseFields(fieldsRaw, json, quiet)
		if (error) return error
		if (thisQuarter && lastQuarter) {
			return parseUsageError(
				'Use only one of --this-quarter or --last-quarter',
				json,
				quiet,
			)
		}
		const page = pageRaw ? Number(pageRaw) : null
		const limit = limitRaw ? Number(limitRaw) : null
		if (pageRaw && (page === null || !Number.isInteger(page) || page <= 0)) {
			return parseUsageError('Invalid --page value', json, quiet)
		}
		if (
			limitRaw &&
			(limit === null || !Number.isInteger(limit) || limit <= 0)
		) {
			return parseUsageError('Invalid --limit value', json, quiet)
		}
		return {
			ok: true,
			options: {
				command: 'transactions',
				...outputMode,
				unreconciled,
				since: sinceRaw,
				until: untilRaw,
				thisQuarter,
				lastQuarter,
				page,
				limit,
				summary,
				fields,
			},
		}
	}
	if (fieldsRaw) {
		return parseUsageError(
			'--fields is only valid for list commands (accounts, transactions, history, invoices)',
			json,
			quiet,
		)
	}
	if (commandToken === 'history') {
		const { fields, error } = parseFields(fieldsRaw, json, quiet)
		if (error) return error
		if (!sinceRaw) {
			return parseUsageError(
				'Missing required --since for history',
				json,
				quiet,
			)
		}
		return {
			ok: true,
			options: {
				command: 'history',
				...outputMode,
				since: sinceRaw,
				contact: contactRaw,
				accountCode: accountCodeRaw,
				fields,
			},
		}
	}
	if (commandToken === 'invoices') {
		const { fields, error } = parseFields(fieldsRaw, json, quiet)
		if (error) return error
		return {
			ok: true,
			options: {
				command: 'invoices',
				...outputMode,
				status: statusRaw,
				type: typeRaw,
				fields,
			},
		}
	}
	if (commandToken === 'reconcile') {
		return {
			ok: true,
			options: {
				command: 'reconcile',
				...outputMode,
				execute,
				fromCsv,
			},
		}
	}
	if (commandToken === 'help') {
		return {
			ok: true,
			options: { command: 'help', ...outputMode, topic },
		}
	}
	if (commandToken === 'version') {
		return {
			ok: true,
			options: { command: 'help', ...outputMode, topic: 'version' },
		}
	}

	return parseUsageError(`Unknown command: ${commandToken}`, json, quiet)
}

/** Map error codes to action hints for agents. */
const ERROR_CODE_ACTIONS: Record<
	string,
	{ action: string; retryable: boolean }
> = {
	E_OK: { action: 'NONE', retryable: false },
	E_NETWORK: { action: 'CHECK_NETWORK', retryable: false },
	E_FORBIDDEN: { action: 'CHECK_SCOPES', retryable: false },
	E_SERVER_ERROR: { action: 'RETRY_WITH_BACKOFF', retryable: true },
	E_RATE_LIMITED: { action: 'WAIT_AND_RETRY', retryable: true },
	E_API_ERROR: { action: 'RETRY_WITH_BACKOFF', retryable: true },
	E_RUNTIME: { action: 'ESCALATE', retryable: false },
	E_USAGE: { action: 'FIX_ARGS', retryable: false },
	E_NOT_FOUND: { action: 'ESCALATE', retryable: false },
	E_UNAUTHORIZED: { action: 'RUN_AUTH', retryable: false },
	E_LOCK_CONTENTION: { action: 'WAIT_AND_RETRY', retryable: true },
	E_STALE_DATA: { action: 'REFETCH_AND_RETRY', retryable: true },
	E_API_CONFLICT: { action: 'INSPECT_AND_RESOLVE', retryable: false },
	E_CONFLICT: { action: 'WAIT_AND_RETRY', retryable: true },
	E_INTERRUPTED: { action: 'NONE', retryable: false },
}

/** Write successful output in JSON or human mode. */
function writeSuccess<T>(
	ctx: OutputContext,
	data: T,
	humanLines: string[],
	quietLine: string,
): void {
	if (ctx.json) {
		process.stdout.write(
			`${JSON.stringify({
				status: 'data',
				schemaVersion: SCHEMA_VERSION_OUTPUT,
				data,
			})}\n`,
		)
		return
	}
	if (ctx.quiet) {
		process.stdout.write(`${quietLine}\n`)
		return
	}
	process.stdout.write(`${humanLines.join('\n')}\n`)
}

/** Write structured errors to stderr (JSON in machine mode). */
function writeError(
	ctx: OutputContext,
	message: string,
	errorCode: string,
	_exitCode: ExitCode,
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

function parseUsageError(
	message: string,
	json: boolean,
	quiet: boolean,
	context?: Record<string, unknown>,
): ParseCliError {
	return {
		ok: false,
		exitCode: EXIT_USAGE,
		message,
		output: usageText(),
		errorCode: 'E_USAGE',
		context,
		json,
		quiet,
	}
}

function parseFields(
	fieldsRaw: string | null,
	json: boolean,
	quiet: boolean,
): {
	fields: readonly string[] | null
	error?: ParseCliError
} {
	if (!fieldsRaw) return { fields: null }
	const rawFields = fieldsRaw
		.split(',')
		.map((field) => field.trim())
		.filter(Boolean)
	const invalidFields = rawFields.filter(
		(field) => !/^[A-Za-z0-9_.]+$/.test(field),
	)
	if (invalidFields.length > 0) {
		return {
			fields: null,
			error: parseUsageError('Invalid --fields value', json, quiet, {
				invalidFields,
				validFieldsHint:
					'Fields must be comma-separated dot paths (A-Z, a-z, 0-9, _, .).',
			}),
		}
	}
	return { fields: rawFields }
}

function resolveOutputMode(flags: {
	readonly json: boolean
	readonly quiet: boolean
	readonly verbose: boolean
	readonly debug: boolean
	readonly eventsUrl: string | null
}): OutputContext {
	let json = flags.json
	if (!json && !process.stdout.isTTY) {
		json = true
	}

	const logLevel: LogLevel = flags.debug
		? 'debug'
		: flags.quiet
			? 'silent'
			: flags.verbose
				? 'info'
				: 'silent'

	const progressMode: ProgressMode =
		json || flags.quiet
			? 'off'
			: process.stderr.isTTY
				? flags.verbose || flags.debug
					? 'static'
					: 'animated'
				: 'static'

	return {
		json,
		quiet: flags.quiet,
		logLevel,
		progressMode,
		eventsConfig: resolveEventsConfig({ eventsUrl: flags.eventsUrl }),
	}
}

function sanitizeErrorMessage(message: string): string {
	return message
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
		.replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]')
		.replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[REDACTED]')
		.replace(/code=[^&\s]+/gi, 'code=[REDACTED]')
		.replace(/code_verifier=[^&\s]+/gi, 'code_verifier=[REDACTED]')
		.replace(/client_id=[^&\s]+/gi, 'client_id=[REDACTED]')
		.replace(/xero-tenant-id:\s*[^\s,}]+/gi, 'xero-tenant-id: [REDACTED]')
}

function usageText(): string {
	return [
		'xero-cli',
		'',
		'Usage:',
		'  bun run xero-cli <command> [flags]',
		'',
		'Commands:',
		'  auth           OAuth2 PKCE flow',
		'  status         Check auth + API connectivity',
		'  accounts       List chart of accounts',
		'  transactions   List bank transactions',
		'  history        Grouped reconciliation history',
		'  invoices       List outstanding invoices',
		'  reconcile      Reconcile transactions from stdin or CSV',
		'  help [topic]   Show help',
		'',
		'Global Flags:',
		'  --json         JSON output',
		'  --quiet        Minimal output',
		'  --verbose      Info logs on stderr',
		'  --debug        Debug logs on stderr (implies verbose)',
		'  --events-url   Observability server URL',
		'  --help         Show help',
		'  --version      Show version',
		'',
		'Auth Flags:',
		'  --auth-timeout  Auth timeout in seconds (default 300)',
		'',
		'Aliases:',
		'  tx   -> transactions',
		'  acct -> accounts',
		'  inv  -> invoices',
		'  rec  -> reconcile',
		'  hist -> history',
	].join('\n')
}

/** Run the CLI and return an exit code for process exit. */
/** Run the CLI and return an exit code for process exit. */
export async function runCli(argv: readonly string[]): Promise<ExitCode> {
	const parsed = parseCli(argv)
	if (!parsed.ok) {
		const ctx: OutputContext = {
			json: parsed.json,
			quiet: parsed.quiet,
			logLevel: 'silent',
			progressMode: parsed.json || parsed.quiet ? 'off' : 'static',
			eventsConfig: resolveEventsConfig(),
		}
		writeError(
			ctx,
			parsed.message,
			parsed.errorCode,
			parsed.exitCode,
			'UsageError',
			parsed.context,
		)
		if (!ctx.json && !ctx.quiet) {
			process.stderr.write(`${parsed.output}\n`)
		}
		return parsed.exitCode
	}

	const options = parsed.options
	const ctx: OutputContext = {
		json: options.json,
		quiet: options.quiet,
		logLevel: options.logLevel,
		progressMode: options.progressMode,
		eventsConfig: options.eventsConfig,
	}

	return await withContext({ runId: randomUUID() }, async () => {
		try {
			setupLogging(ctx)
			switch (options.command) {
				case 'auth':
					return await runAuth(ctx, options)
				case 'status':
					return await runStatus(ctx)
				case 'accounts':
					return await runAccounts(ctx, options)
				case 'transactions':
					return await runTransactions(ctx, options)
				case 'history':
					return await runHistory(ctx, options)
				case 'invoices':
					return await runInvoices(ctx, options)
				case 'reconcile':
					return await runReconcile(ctx, options)
				case 'help': {
					if (options.topic === 'version') {
						writeSuccess(
							ctx,
							{ command: 'version', version: '0.0.0' },
							['xero-cli v0.0.0'],
							'0.0.0',
						)
						return EXIT_OK
					}
					writeSuccess(
						ctx,
						{ command: 'help', topic: options.topic },
						[usageText()],
						'xero-cli help',
					)
					return EXIT_OK
				}
				default: {
					const _exhaustive: never = options
					return _exhaustive
				}
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				return EXIT_INTERRUPTED
			}
			const rawMessage = err instanceof Error ? err.message : String(err)
			const message = sanitizeErrorMessage(rawMessage)
			writeError(ctx, message, 'E_RUNTIME', EXIT_RUNTIME, 'RuntimeError')
			return EXIT_RUNTIME
		} finally {
			await shutdownLogging()
		}
	})
}

/** Execute the CLI when run directly. */
export async function main(): Promise<void> {
	process.once('SIGINT', () => {
		void shutdownLogging()
	})
	const code = await runCli(process.argv)
	process.exit(code)
}

if (import.meta.main) {
	void main()
}
