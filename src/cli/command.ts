import { randomUUID } from 'node:crypto'
import { emitEvent, resolveEventsConfig } from '../events'
import {
	getXeroLogger,
	setupLogging,
	shutdownLogging,
	withContext,
} from '../logging'
import { isHeadless } from '../xero/auth'
import { runAccounts } from './commands/accounts'
import { runAuth } from './commands/auth'
import { runHistory } from './commands/history'
import { runInvoices } from './commands/invoices'
import { runReconcile } from './commands/reconcile'
import { runStatus } from './commands/status'
import { runTransactions } from './commands/transactions'
import type { ExitCode, OutputContext } from './output'
import {
	EXIT_INTERRUPTED,
	EXIT_OK,
	EXIT_RUNTIME,
	EXIT_USAGE,
	sanitizeErrorMessage,
	writeError,
	writeSuccess,
} from './output'

/** Logger for CLI arg parsing, command dispatch, and output formatting. */
const cliLogger = getXeroLogger(['cli'])

type LogLevel = 'silent' | 'info' | 'debug'
type ProgressMode = 'animated' | 'static' | 'off'

interface AuthCommand extends OutputContext {
	readonly command: 'auth'
	readonly authTimeoutMs: number | null
}

interface StatusCommand extends OutputContext {
	readonly command: 'status'
}

interface AccountsCommand extends OutputContext {
	readonly command: 'accounts'
	readonly type: string | null
	readonly fields: readonly string[] | null
}

interface TransactionsCommand extends OutputContext {
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

interface HistoryCommand extends OutputContext {
	readonly command: 'history'
	readonly since: string | null
	readonly contact: string | null
	readonly accountCode: string | null
	readonly fields: readonly string[] | null
}

interface InvoicesCommand extends OutputContext {
	readonly command: 'invoices'
	readonly status: string | null
	readonly type: string | null
	readonly fields: readonly string[] | null
}

interface HelpCommand extends OutputContext {
	readonly command: 'help'
	readonly topic: string | null
}

interface ReconcileCommand extends OutputContext {
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

/**
 * Result of attempting to parse a value-taking flag (e.g. --flag value or --flag=value).
 * Returns null when the token does not match the flag name at all.
 */
type ValueFlagResult =
	| null
	| { readonly value: string; readonly nextIndex: number }
	| ParseCliError

/**
 * Parse a value-taking flag that supports both `--flag value` and `--flag=value` forms.
 * Returns null if the token does not match the flag, a ParseCliError if the value is
 * missing, or the parsed value and next loop index on success.
 */
function parseValueFlag(
	token: string,
	args: readonly string[],
	index: number,
	flag: string,
	json: boolean,
	quiet: boolean,
): ValueFlagResult {
	if (token === flag) {
		const value = args[index + 1]
		if (!value || value.startsWith('--')) {
			return parseUsageError(`Missing value for ${flag}`, json, quiet)
		}
		return { value, nextIndex: index + 1 }
	}
	const prefix = `${flag}=`
	if (token.startsWith(prefix)) {
		const value = token.slice(prefix.length)
		if (!value) {
			return parseUsageError(`Missing value for ${flag}`, json, quiet)
		}
		return { value, nextIndex: index }
	}
	return null
}

/** Parse argv into structured command options.
 *  Returns a discriminated union instead of throwing to preserve output mode. */
export function parseCli(argv: readonly string[]): ParseCliResult {
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
		// -- Value-taking flags (--flag value / --flag=value) --
		// Each flag is parsed via parseValueFlag to avoid ~14 lines of boilerplate per flag.
		const valueFlagDefs: Array<{
			flag: string
			assign: (v: string) => void
		}> = [
			{
				flag: '--from-csv',
				assign: (v) => {
					fromCsv = v
				},
			},
			{
				flag: '--contact',
				assign: (v) => {
					contactRaw = v
				},
			},
			{
				flag: '--account-code',
				assign: (v) => {
					accountCodeRaw = v
				},
			},
			{
				flag: '--status',
				assign: (v) => {
					statusRaw = v
				},
			},
			{
				flag: '--events-url',
				assign: (v) => {
					eventsUrl = v
				},
			},
			{
				flag: '--auth-timeout',
				assign: (v) => {
					authTimeoutRaw = v
				},
			},
			{
				flag: '--fields',
				assign: (v) => {
					fieldsRaw = v
				},
			},
			{
				flag: '--type',
				assign: (v) => {
					typeRaw = v
				},
			},
			{
				flag: '--since',
				assign: (v) => {
					sinceRaw = v
				},
			},
			{
				flag: '--until',
				assign: (v) => {
					untilRaw = v
				},
			},
			{
				flag: '--page',
				assign: (v) => {
					pageRaw = v
				},
			},
			{
				flag: '--limit',
				assign: (v) => {
					limitRaw = v
				},
			},
		]
		let valueFlagMatched = false
		for (const { flag, assign } of valueFlagDefs) {
			const result = parseValueFlag(token, args, i, flag, json, quiet)
			if (result === null) continue
			if ('ok' in result) return result // ParseCliError
			assign(result.value)
			i = result.nextIndex
			valueFlagMatched = true
			break
		}
		if (valueFlagMatched) continue

		if (token === '--help' || token === '-h') {
			help = true
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
		if ((thisQuarter || lastQuarter) && (sinceRaw || untilRaw)) {
			return parseUsageError(
				'--this-quarter/--last-quarter cannot be combined with --since/--until',
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
	if (fieldsRaw) {
		return parseUsageError(
			'--fields is only valid for list commands (accounts, transactions, history, invoices)',
			json,
			quiet,
		)
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
		headless: json || isHeadless(),
		logLevel,
		progressMode,
		eventsConfig: resolveEventsConfig({ eventsUrl: flags.eventsUrl }),
	}
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

/**
 * Strip sensitive fields (tokens, secrets) from CLI options before logging.
 * Returns a plain object safe for structured log properties.
 */
function sanitizeCliOptions(options: CliOptions): Record<string, unknown> {
	const { json, quiet, logLevel, progressMode, eventsConfig, ...rest } =
		options as unknown as Record<string, unknown>
	return {
		command: options.command,
		json,
		quiet,
		logLevel,
		progressMode,
		...rest,
	}
}

/** Derive the output mode label for events: json > quiet > human. */
function resolveMode(ctx: OutputContext): 'json' | 'quiet' | 'human' {
	if (ctx.json) return 'json'
	if (ctx.quiet) return 'quiet'
	return 'human'
}

/** Run the CLI and return an exit code for process exit. */
export async function runCli(argv: readonly string[]): Promise<ExitCode> {
	const parsed = parseCli(argv)
	if (!parsed.ok) {
		const ctx: OutputContext = {
			json: parsed.json,
			quiet: parsed.quiet,
			headless: parsed.json || isHeadless(),
			logLevel: 'silent',
			progressMode: parsed.json || parsed.quiet ? 'off' : 'static',
			eventsConfig: resolveEventsConfig(),
		}
		writeError(
			ctx,
			parsed.message,
			parsed.errorCode,
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
		headless: options.headless,
		logLevel: options.logLevel,
		progressMode: options.progressMode,
		eventsConfig: options.eventsConfig,
	}

	return await withContext({ runId: randomUUID() }, async () => {
		const startTime = Date.now()
		const mode = resolveMode(ctx)
		try {
			setupLogging(ctx)
			cliLogger.info('CLI started: {command}', {
				command: options.command,
			})
			emitEvent(ctx.eventsConfig, 'xero-cli-started', {
				command: options.command,
				mode,
			})
			cliLogger.debug('Parsed options: {options}', {
				options: sanitizeCliOptions(options),
			})
			let exitCode: ExitCode
			switch (options.command) {
				case 'auth':
					exitCode = await runAuth(ctx, options)
					break
				case 'status':
					exitCode = await runStatus(ctx)
					break
				case 'accounts':
					exitCode = await runAccounts(ctx, options)
					break
				case 'transactions':
					exitCode = await runTransactions(ctx, options)
					break
				case 'history':
					exitCode = await runHistory(ctx, options)
					break
				case 'invoices':
					exitCode = await runInvoices(ctx, options)
					break
				case 'reconcile':
					exitCode = await runReconcile(ctx, options)
					break
				case 'help': {
					if (options.topic === 'version') {
						writeSuccess(
							ctx,
							{ command: 'version', version: '0.0.0' },
							['xero-cli v0.0.0'],
							'0.0.0',
						)
						exitCode = EXIT_OK
						break
					}
					writeSuccess(
						ctx,
						{ command: 'help', topic: options.topic },
						[usageText()],
						'xero-cli help',
					)
					exitCode = EXIT_OK
					break
				}
				default: {
					const _exhaustive: never = options
					return _exhaustive
				}
			}
			const durationMs = Date.now() - startTime
			cliLogger.info(
				'CLI completed: {command} exitCode={exitCode} duration={durationMs}ms',
				{
					command: options.command,
					exitCode,
					durationMs,
				},
			)
			emitEvent(ctx.eventsConfig, 'xero-cli-completed', {
				command: options.command,
				exitCode,
				durationMs,
				mode,
			})
			return exitCode
		} catch (err) {
			const durationMs = Date.now() - startTime
			if (err instanceof Error && err.name === 'AbortError') {
				cliLogger.info('CLI interrupted: {command} duration={durationMs}ms', {
					command: options.command,
					durationMs,
				})
				emitEvent(ctx.eventsConfig, 'xero-cli-completed', {
					command: options.command,
					exitCode: EXIT_INTERRUPTED,
					durationMs,
					mode,
				})
				return EXIT_INTERRUPTED
			}
			const rawMessage = err instanceof Error ? err.message : String(err)
			const message = sanitizeErrorMessage(rawMessage)
			cliLogger.error(
				'CLI failed: {command} error={error} duration={durationMs}ms',
				{
					command: options.command,
					error: message,
					durationMs,
				},
			)
			writeError(ctx, message, 'E_RUNTIME', 'RuntimeError')
			emitEvent(ctx.eventsConfig, 'xero-cli-completed', {
				command: options.command,
				exitCode: EXIT_RUNTIME,
				durationMs,
				mode,
			})
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
