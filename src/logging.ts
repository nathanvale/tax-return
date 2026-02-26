import { AsyncLocalStorage } from 'node:async_hooks'
import { Writable } from 'node:stream'
import {
	configure,
	dispose,
	fingersCrossed,
	getConsoleSink,
	getLogger,
	getStreamSink,
	jsonLinesFormatter,
} from '@logtape/logtape'

type LogLevel = 'silent' | 'info' | 'debug'

interface LogContext {
	readonly runId: string
}

interface LoggingOptions {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: LogLevel
}

let loggingConfigured = false
const logContext = new AsyncLocalStorage<LogContext>()

function resolveLogLevel(level: LogLevel): 'warning' | 'info' | 'debug' {
	if (level === 'debug') return 'debug'
	if (level === 'info') return 'info'
	return 'warning'
}

function shouldUseJsonLogs(options: LoggingOptions): boolean {
	if (process.env.XERO_LOG_FORMAT === 'text') return false
	if (process.env.XERO_LOG_FORMAT === 'json') return true
	if (options.json) return true
	return !process.stderr.isTTY
}

function shouldUseFingersCrossed(options: LoggingOptions): boolean {
	return (
		process.env.XERO_LOG_FORMAT !== 'json' &&
		!options.json &&
		!options.quiet &&
		options.logLevel === 'silent'
	)
}

/** Configure LogTape logging for the CLI. */
export function setupLogging(options: LoggingOptions): void {
	if (loggingConfigured) return
	const jsonLogs = shouldUseJsonLogs(options)
	const stderrStream = Writable.toWeb(process.stderr)
	const baseSink = jsonLogs
		? getStreamSink(stderrStream, { formatter: jsonLinesFormatter })
		: getConsoleSink()
	const sink = shouldUseFingersCrossed(options)
		? fingersCrossed(baseSink, {
				triggerLevel: 'error',
				maxBufferSize: 500,
			})
		: baseSink

	configure({
		reset: true,
		contextLocalStorage: logContext as unknown as AsyncLocalStorage<
			Record<string, unknown>
		>,
		sinks: {
			stderr: sink,
		},
		loggers: [
			{
				category: ['logtape', 'meta'],
				sinks: ['stderr'],
				lowestLevel: 'warning',
			},
			{
				category: ['xero'],
				sinks: ['stderr'],
				lowestLevel: resolveLogLevel(options.logLevel),
			},
		],
	}).catch((err: unknown) => {
		console.error('[xero] Failed to configure logging:', err)
	})

	loggingConfigured = true
}

/** Shut down logging safely (idempotent). Flushes sinks with a timeout. */
export async function shutdownLogging(): Promise<void> {
	if (!loggingConfigured) return
	loggingConfigured = false
	const timeoutMs = 500
	await Promise.race([
		dispose(),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	])
}

/** Get a namespaced logger under the xero root category. */
export function getXeroLogger(
	category: string[],
): ReturnType<typeof getLogger> {
	return getLogger(['xero', ...category])
}

/** Run a function with a scoped logging context. */
export async function withContext<T>(
	context: LogContext,
	fn: () => Promise<T> | T,
): Promise<T> {
	return await logContext.run(context, async () => await fn())
}

/** Read the current logging context (if any). */
export function getLogContext(): LogContext | null {
	return logContext.getStore() ?? null
}
