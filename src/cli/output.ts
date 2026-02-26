import type { EventsConfig } from '../events'
import {
	StructuredError,
	XeroApiError,
	XeroAuthError,
	XeroConflictError,
} from '../xero/errors'

/** Standard exit codes for the CLI process. */
export const EXIT_OK = 0 as const
export const EXIT_RUNTIME = 1 as const
export const EXIT_USAGE = 2 as const
export const EXIT_NOT_FOUND = 3 as const
export const EXIT_UNAUTHORIZED = 4 as const
export const EXIT_CONFLICT = 5 as const
export const EXIT_INTERRUPTED = 130 as const

/** Union of all valid CLI exit codes. */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130

/** Schema version embedded in all JSON output envelopes. */
const SCHEMA_VERSION_OUTPUT = 1

type LogLevel = 'silent' | 'info' | 'debug'
type ProgressMode = 'animated' | 'static' | 'off'

/** Shared context threaded through every command for output formatting. */
export interface OutputContext {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: LogLevel
	readonly progressMode: ProgressMode
	readonly eventsConfig: EventsConfig
}

/**
 * Map error codes to action hints for agents.
 * Used by writeError to populate the `action` and `retryable` fields
 * in JSON error output, giving calling agents a machine-readable hint
 * about what to do next.
 */
export const ERROR_CODE_ACTIONS: Record<
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
export function writeSuccess<T>(
	ctx: OutputContext,
	data: T,
	humanLines: string[],
	quietLine: string,
	warnings?: readonly string[],
): void {
	const activeWarnings = warnings && warnings.length > 0 ? warnings : undefined
	if (ctx.json) {
		const envelope: Record<string, unknown> = {
			status: 'data',
			schemaVersion: SCHEMA_VERSION_OUTPUT,
			data,
		}
		if (activeWarnings) envelope.warnings = activeWarnings
		process.stdout.write(`${JSON.stringify(envelope)}\n`)
		return
	}
	if (activeWarnings) {
		for (const w of activeWarnings) {
			process.stderr.write(`Warning: ${w}\n`)
		}
	}
	if (ctx.quiet) {
		process.stdout.write(`${quietLine}\n`)
		return
	}
	process.stdout.write(`${humanLines.join('\n')}\n`)
}

/** Write structured errors to stderr (JSON in machine mode). */
export function writeError(
	ctx: OutputContext,
	message: string,
	errorCode: string,
	errorName: string,
	context?: Record<string, unknown>,
): void {
	const sanitized = sanitizeErrorMessage(message)
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
				message: sanitized,
				error: errorPayload,
			})}\n`,
		)
		return
	}
	const line = ctx.quiet ? sanitized : `[xero-cli] ${sanitized}`
	process.stderr.write(`${line}\n`)
}

/**
 * Project a subset of fields from each record using dot-path notation.
 * Returns the original records unchanged when fields is null.
 */
export function projectFields<T extends Record<string, unknown>>(
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

/**
 * Detect projected fields that are undefined in ALL records.
 * When every record has undefined for a given field, it is almost certainly
 * a typo rather than legitimately missing data. Returns warning messages
 * for each such field. Skips detection when there are no records (empty
 * result sets should not produce false positives).
 */
export function detectAllUndefinedFields(
	records: Record<string, unknown>[],
	fields: readonly string[] | null,
): string[] {
	if (!fields || records.length === 0) return []
	const warnings: string[] = []
	for (const field of fields) {
		const allUndefined = records.every((record) => record[field] === undefined)
		if (allUndefined) {
			warnings.push(
				`field '${field}' was undefined in all records -- check spelling.`,
			)
		}
	}
	return warnings
}

/**
 * Sanitize error messages to prevent token/secret leakage in output.
 * Redacts Bearer tokens, OAuth params, and tenant IDs.
 */
export function sanitizeErrorMessage(message: string): string {
	return message
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
		.replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]')
		.replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[REDACTED]')
		.replace(/code=[^&\s]+/gi, 'code=[REDACTED]')
		.replace(/code_verifier=[^&\s]+/gi, 'code_verifier=[REDACTED]')
		.replace(/client_id=[^&\s]+/gi, 'client_id=[REDACTED]')
		.replace(/xero-tenant-id:\s*[^\s,}]+/gi, 'xero-tenant-id: [REDACTED]')
}

/**
 * Standardized error catch handler for command functions.
 * Maps StructuredError subclasses to appropriate exit codes and
 * writes consistent agent error metadata. Sanitizes all messages.
 */
export function handleCommandError(ctx: OutputContext, err: unknown): ExitCode {
	if (err instanceof XeroAuthError) {
		writeError(ctx, err.message, err.code, err.name, err.context)
		return EXIT_UNAUTHORIZED
	}
	if (err instanceof XeroConflictError) {
		writeError(ctx, err.message, err.code, err.name, err.context)
		return EXIT_CONFLICT
	}
	if (err instanceof XeroApiError) {
		writeError(ctx, err.message, err.code, err.name, err.context)
		return EXIT_RUNTIME
	}
	if (err instanceof StructuredError) {
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
