import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { configure, getConsoleSink } from '@logtape/logtape'
import { parseCli, runCli } from '../../src/cli/command'

interface Capture {
	readonly getStdout: () => string
	readonly getStderr: () => string
	restore: () => void
}

function captureOutput(): Capture {
	let stdout = ''
	let stderr = ''
	const originalStdout = process.stdout.write.bind(process.stdout)
	const originalStderr = process.stderr.write.bind(process.stderr)

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	process.stdout.write = ((chunk: any) => {
		stdout += chunk.toString()
		return true
	}) as typeof process.stdout.write

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	process.stderr.write = ((chunk: any) => {
		stderr += chunk.toString()
		return true
	}) as typeof process.stderr.write

	return {
		getStdout: () => stdout,
		getStderr: () => stderr,
		restore: () => {
			process.stdout.write = originalStdout
			process.stderr.write = originalStderr
		},
	}
}

describe('cli output invariants', () => {
	beforeEach(async () => {
		await configure({
			reset: true,
			sinks: { stderr: getConsoleSink() },
			loggers: [],
		})
	})

	afterEach(() => {
		delete process.env.XERO_EVENTS_URL
		delete process.env.XERO_EVENTS
	})

	it('emits JSON envelope with schemaVersion', async () => {
		const capture = captureOutput()
		const exitCode = await runCli(['node', 'xero-cli', 'help', '--json'])
		capture.restore()

		expect(exitCode).toBe(0)
		expect(capture.getStderr()).toBe('')
		const payload = JSON.parse(capture.getStdout())
		expect(payload.status).toBe('data')
		expect(payload.schemaVersion).toBe(1)
		expect(payload.data.command).toBe('help')
	})

	it('emits structured error on invalid args', async () => {
		const capture = captureOutput()
		const exitCode = await runCli(['node', 'xero-cli', '--unknown', '--json'])
		capture.restore()

		expect(exitCode).toBe(2)
		expect(capture.getStdout()).toBe('')
		const payload = JSON.parse(capture.getStderr())
		expect(payload.status).toBe('error')
		expect(payload.error.action).toBeDefined()
		expect(payload.error.retryable).toBeDefined()
	})

	it('keeps stderr clean in --quiet mode', async () => {
		const capture = captureOutput()
		const exitCode = await runCli(['node', 'xero-cli', 'help', '--quiet'])
		capture.restore()

		expect(exitCode).toBe(0)
		expect(capture.getStderr()).toBe('')
	})
})

describe('--fields flag routing', () => {
	it('rejects --fields for reconcile command', () => {
		const result = parseCli(['node', 'xero-cli', 'reconcile', '--fields', 'Total', '--json'])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.message).toContain('--fields is only valid for list commands')
		}
	})

	it('rejects --fields for help command', () => {
		const result = parseCli(['node', 'xero-cli', 'help', '--fields', 'Total'])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.message).toContain('--fields is only valid for list commands')
		}
	})

	it('accepts --fields for accounts command', () => {
		const result = parseCli(['node', 'xero-cli', 'accounts', '--fields', 'Code,Name', '--json'])
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.options.command).toBe('accounts')
			expect(result.options).toHaveProperty('fields', ['Code', 'Name'])
		}
	})

	it('accepts --fields for transactions command', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'transactions',
			'--fields',
			'Total,Contact',
			'--json',
		])
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.options.command).toBe('transactions')
			expect(result.options).toHaveProperty('fields', ['Total', 'Contact'])
		}
	})

	it('accepts --fields for history command', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'history',
			'--since',
			'2025-01-01',
			'--fields',
			'Contact,Count',
			'--json',
		])
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.options.command).toBe('history')
			expect(result.options).toHaveProperty('fields', ['Contact', 'Count'])
		}
	})

	it('accepts --fields for invoices command', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'invoices',
			'--fields',
			'InvoiceID,Total',
			'--json',
		])
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.options.command).toBe('invoices')
			expect(result.options).toHaveProperty('fields', ['InvoiceID', 'Total'])
		}
	})
})

describe('date range flag conflicts', () => {
	it('rejects --this-quarter combined with --since', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'transactions',
			'--this-quarter',
			'--since',
			'2025-01-01',
			'--json',
		])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.message).toContain(
				'--this-quarter/--last-quarter cannot be combined with --since/--until',
			)
		}
	})

	it('rejects --last-quarter combined with --until', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'transactions',
			'--last-quarter',
			'--until',
			'2025-12-31',
			'--json',
		])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.message).toContain(
				'--this-quarter/--last-quarter cannot be combined with --since/--until',
			)
		}
	})

	it('rejects triple combination --this-quarter --since --until', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'transactions',
			'--this-quarter',
			'--since',
			'2025-01-01',
			'--until',
			'2025-12-31',
			'--json',
		])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.message).toContain(
				'--this-quarter/--last-quarter cannot be combined with --since/--until',
			)
		}
	})

	it('still allows --this-quarter alone', () => {
		const result = parseCli(['node', 'xero-cli', 'transactions', '--this-quarter', '--json'])
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.options.command).toBe('transactions')
		}
	})

	it('still allows --since and --until without quarter flags', () => {
		const result = parseCli([
			'node',
			'xero-cli',
			'transactions',
			'--since',
			'2025-01-01',
			'--until',
			'2025-12-31',
			'--json',
		])
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.options.command).toBe('transactions')
		}
	})
})
