import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
	detectAllUndefinedFields,
	EXIT_CONFLICT,
	EXIT_RUNTIME,
	EXIT_UNAUTHORIZED,
	handleCommandError,
	type OutputContext,
	projectFields,
	writeSuccess,
} from '../../src/cli/output'
import {
	StructuredError,
	XeroApiError,
	XeroAuthError,
	XeroConflictError,
} from '../../src/xero/errors'

/** Minimal OutputContext that suppresses all output. */
function quietCtx(): OutputContext {
	return {
		json: false,
		quiet: true,
		logLevel: 'silent',
		progressMode: 'off',
		eventsConfig: { url: null },
	}
}

describe('handleCommandError', () => {
	it('returns EXIT_CONFLICT for XeroConflictError', () => {
		const err = new XeroConflictError('already reconciled')
		const code = handleCommandError(quietCtx(), err)
		expect(code).toBe(EXIT_CONFLICT)
	})

	it('returns EXIT_UNAUTHORIZED for XeroAuthError', () => {
		const err = new XeroAuthError('token expired')
		const code = handleCommandError(quietCtx(), err)
		expect(code).toBe(EXIT_UNAUTHORIZED)
	})

	it('returns EXIT_RUNTIME for XeroApiError', () => {
		const err = new XeroApiError('server error', { status: 500 })
		const code = handleCommandError(quietCtx(), err)
		expect(code).toBe(EXIT_RUNTIME)
	})

	it('returns EXIT_RUNTIME for generic StructuredError', () => {
		const err = new StructuredError('something broke', {
			code: 'E_RUNTIME',
			category: 'runtime',
		})
		const code = handleCommandError(quietCtx(), err)
		expect(code).toBe(EXIT_RUNTIME)
	})

	it('returns EXIT_RUNTIME for plain Error', () => {
		const err = new Error('unexpected')
		const code = handleCommandError(quietCtx(), err)
		expect(code).toBe(EXIT_RUNTIME)
	})
})

describe('detectAllUndefinedFields', () => {
	it('returns warning for field that is undefined in all records', () => {
		const records = [
			{ Name: 'Acme', 'Contcat.Name': undefined },
			{ Name: 'Globex', 'Contcat.Name': undefined },
		]
		const warnings = detectAllUndefinedFields(records, ['Name', 'Contcat.Name'])
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("field 'Contcat.Name'")
		expect(warnings[0]).toContain('check spelling')
	})

	it('does not warn for fields that have values in some records', () => {
		const records = [
			{ Status: 'ACTIVE', Notes: undefined },
			{ Status: 'ARCHIVED', Notes: 'some note' },
		]
		const warnings = detectAllUndefinedFields(records, ['Status', 'Notes'])
		expect(warnings).toHaveLength(0)
	})

	it('does not warn when fields is null', () => {
		const records = [{ Name: 'Acme' }]
		const warnings = detectAllUndefinedFields(records, null)
		expect(warnings).toHaveLength(0)
	})

	it('does not warn when records array is empty', () => {
		const warnings = detectAllUndefinedFields([], ['Name', 'Typo'])
		expect(warnings).toHaveLength(0)
	})

	it('warns for multiple typo fields', () => {
		const records = [{ Name: undefined, Cde: undefined }]
		const warnings = detectAllUndefinedFields(records, ['Name', 'Cde'])
		expect(warnings).toHaveLength(2)
	})
})

describe('projectFields + detectAllUndefinedFields integration', () => {
	it('detects typo after projection through the full pipeline', () => {
		const records = [
			{ Contact: { Name: 'Acme' }, Status: 'ACTIVE' },
			{ Contact: { Name: 'Globex' }, Status: 'ARCHIVED' },
		]
		const fields = ['Contact.Name', 'Contcat.Name'] as const
		const projected = projectFields(records as Record<string, unknown>[], fields)
		const warnings = detectAllUndefinedFields(projected, fields)

		// Contact.Name resolves fine, Contcat.Name is a typo
		expect(projected[0]['Contact.Name']).toBe('Acme')
		expect(projected[0]['Contcat.Name']).toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("field 'Contcat.Name'")
	})
})

describe('writeSuccess with phase discriminator', () => {
	let stdoutOutput: string
	let originalStdout: typeof process.stdout.write

	beforeEach(() => {
		stdoutOutput = ''
		originalStdout = process.stdout.write.bind(process.stdout)
		process.stdout.write = ((chunk: string) => {
			stdoutOutput += chunk.toString()
			return true
		}) as typeof process.stdout.write
	})

	afterEach(() => {
		process.stdout.write = originalStdout
	})

	it('includes phase field in JSON envelope when provided', () => {
		const ctx: OutputContext = {
			json: true,
			quiet: false,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(
			ctx,
			{ command: 'auth', tenantId: 't1', orgName: 'Acme' },
			['Authenticated'],
			'OK',
			undefined,
			'result',
		)
		const parsed = JSON.parse(stdoutOutput)
		expect(parsed.phase).toBe('result')
		expect(parsed.status).toBe('data')
		expect(parsed.data.command).toBe('auth')
	})

	it('omits phase field from JSON envelope when not provided', () => {
		const ctx: OutputContext = {
			json: true,
			quiet: false,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(ctx, { items: [] }, ['Items'], 'OK')
		const parsed = JSON.parse(stdoutOutput)
		expect(parsed.phase).toBeUndefined()
		expect(parsed.status).toBe('data')
	})

	it('does not include phase in human mode output', () => {
		const ctx: OutputContext = {
			json: false,
			quiet: false,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(ctx, { command: 'auth' }, ['Authenticated'], 'OK', undefined, 'result')
		// Human mode just prints the human lines, no JSON
		expect(stdoutOutput).toBe('Authenticated\n')
		expect(stdoutOutput).not.toContain('phase')
	})
})

describe('writeSuccess with warnings', () => {
	let stdoutOutput: string
	let stderrOutput: string
	let originalStdout: typeof process.stdout.write
	let originalStderr: typeof process.stderr.write

	beforeEach(() => {
		stdoutOutput = ''
		stderrOutput = ''
		originalStdout = process.stdout.write.bind(process.stdout)
		originalStderr = process.stderr.write.bind(process.stderr)
		process.stdout.write = ((chunk: string) => {
			stdoutOutput += chunk.toString()
			return true
		}) as typeof process.stdout.write
		process.stderr.write = ((chunk: string) => {
			stderrOutput += chunk.toString()
			return true
		}) as typeof process.stderr.write
	})

	afterEach(() => {
		process.stdout.write = originalStdout
		process.stderr.write = originalStderr
	})

	it('includes warnings array in JSON envelope', () => {
		const ctx: OutputContext = {
			json: true,
			quiet: false,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(ctx, { items: [] }, ['No items'], '0', [
			"field 'Typo' was undefined in all records -- check spelling.",
		])
		const parsed = JSON.parse(stdoutOutput)
		expect(parsed.warnings).toEqual([
			"field 'Typo' was undefined in all records -- check spelling.",
		])
		expect(parsed.status).toBe('data')
	})

	it('omits warnings array from JSON when no warnings', () => {
		const ctx: OutputContext = {
			json: true,
			quiet: false,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(ctx, { items: [] }, ['No items'], '0', [])
		const parsed = JSON.parse(stdoutOutput)
		expect(parsed.warnings).toBeUndefined()
	})

	it('emits warnings to stderr in human mode', () => {
		const ctx: OutputContext = {
			json: false,
			quiet: false,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(ctx, { items: [] }, ['No items'], '0', [
			"field 'Typo' was undefined in all records -- check spelling.",
		])
		expect(stderrOutput).toContain("Warning: field 'Typo'")
		expect(stdoutOutput).toContain('No items')
	})

	it('emits warnings to stderr in quiet mode', () => {
		const ctx: OutputContext = {
			json: false,
			quiet: true,
			logLevel: 'silent',
			progressMode: 'off',
			eventsConfig: { url: null },
		}
		writeSuccess(ctx, { items: [] }, ['No items'], '0', [
			"field 'Typo' was undefined in all records -- check spelling.",
		])
		expect(stderrOutput).toContain("Warning: field 'Typo'")
		expect(stdoutOutput).toBe('0\n')
	})
})
