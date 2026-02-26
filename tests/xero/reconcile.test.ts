import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, unlink } from 'node:fs/promises'
import { parseCsvLine, runReconcile, validateCsvPath } from '../../src/cli/commands/reconcile'
import { resolveEventsConfig } from '../../src/events'

const TEST_TOKENS = {
	accessToken: 'token',
	refreshToken: 'refresh',
	expiresAt: Date.now() + 10 * 60_000,
}

const BASE_INPUT = JSON.stringify([
	{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
])

describe('reconcile', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		delete process.env.XERO_API_BASE_URL
		delete process.env.XERO_TEST_TOKENS
		globalThis.fetch = originalFetch
	})

	it('fails on duplicate BankTransactionID', async () => {
		const ctx = {
			json: true,
			quiet: true,
			logLevel: 'silent' as const,
			progressMode: 'off' as const,
			eventsConfig: resolveEventsConfig(),
		}
		const input = JSON.stringify([
			{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
			{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
		])

		await Bun.write('.xero-config.json', JSON.stringify({ tenantId: 'tenant', orgName: 'Test' }), {
			mode: 0o600,
		})
		await chmod('.xero-config.json', 0o600)
		const original = Bun.stdin.stream
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		;(Bun.stdin as any).stream = () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(input))
					controller.close()
				},
			})

		process.env.XERO_TEST_TOKENS = JSON.stringify(TEST_TOKENS)

		const exitCode = await runReconcile(ctx, {
			command: 'reconcile',
			execute: false,
			fromCsv: null,
		})
		expect(exitCode).toBe(1)
		;(Bun.stdin as any).stream = original
		await unlink('.xero-config.json').catch(() => undefined)
	})

	it('dry-run returns ok with mock server', async () => {
		globalThis.fetch = async (url) => {
			const pathname = new URL(url.toString()).pathname
			if (pathname.startsWith('/BankTransactions')) {
				return new Response(
					JSON.stringify({
						BankTransactions: [{ BankTransactionID: '11111111-1111-1111-1111-111111111111' }],
					}),
					{
						status: 200,
					},
				)
			}
			if (pathname.startsWith('/Accounts')) {
				return new Response(JSON.stringify({ Accounts: [{ Code: '400', Status: 'ACTIVE' }] }), {
					status: 200,
				})
			}
			return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
		}

		await Bun.write('.xero-config.json', JSON.stringify({ tenantId: 'tenant', orgName: 'Test' }), {
			mode: 0o600,
		})
		await chmod('.xero-config.json', 0o600)

		const original = Bun.stdin.stream
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		;(Bun.stdin as any).stream = () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(BASE_INPUT))
					controller.close()
				},
			})

		process.env.XERO_TEST_TOKENS = JSON.stringify(TEST_TOKENS)

		const ctx = {
			json: true,
			quiet: true,
			logLevel: 'silent' as const,
			progressMode: 'off' as const,
			eventsConfig: resolveEventsConfig(),
		}
		const exitCode = await runReconcile(ctx, {
			command: 'reconcile',
			execute: false,
			fromCsv: null,
		})
		expect(exitCode).toBe(0)

		;(Bun.stdin as any).stream = original
		await unlink('.xero-config.json').catch(() => undefined)
	})

	it('returns typed status enums', async () => {
		globalThis.fetch = async (url) => {
			const pathname = new URL(url.toString()).pathname
			if (pathname.startsWith('/BankTransactions')) {
				return new Response(
					JSON.stringify({
						BankTransactions: [{ BankTransactionID: '11111111-1111-1111-1111-111111111111' }],
					}),
					{ status: 200 },
				)
			}
			if (pathname.startsWith('/Accounts')) {
				return new Response(JSON.stringify({ Accounts: [{ Code: '400', Status: 'ACTIVE' }] }), {
					status: 200,
				})
			}
			return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
		}

		await Bun.write('.xero-config.json', JSON.stringify({ tenantId: 'tenant', orgName: 'Test' }), {
			mode: 0o600,
		})
		await chmod('.xero-config.json', 0o600)

		const original = Bun.stdin.stream
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		;(Bun.stdin as any).stream = () =>
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(BASE_INPUT))
					controller.close()
				},
			})

		process.env.XERO_TEST_TOKENS = JSON.stringify(TEST_TOKENS)

		let stdout = ''
		const originalStdout = process.stdout.write.bind(process.stdout)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		process.stdout.write = ((chunk: any) => {
			stdout += chunk.toString()
			return true
		}) as typeof process.stdout.write

		const ctx = {
			json: true,
			quiet: true,
			logLevel: 'silent' as const,
			progressMode: 'off' as const,
			eventsConfig: resolveEventsConfig(),
		}
		const exitCode = await runReconcile(ctx, {
			command: 'reconcile',
			execute: false,
			fromCsv: null,
		})
		expect(exitCode).toBe(0)
		process.stdout.write = originalStdout

		const payload = JSON.parse(stdout)
		const statuses = payload.data.results.map((result: { status: string }) => result.status)
		for (const status of statuses) {
			expect(['reconciled', 'skipped', 'failed', 'dry-run']).toContain(status)
		}

		;(Bun.stdin as any).stream = original
		await unlink('.xero-config.json').catch(() => undefined)
	})
})

describe('validateCsvPath', () => {
	it('rejects absolute paths outside cwd', () => {
		expect(() => validateCsvPath('/etc/passwd')).toThrow(/CSV path must be within/)
	})

	it('rejects traversal paths', () => {
		expect(() => validateCsvPath('../../../etc/passwd')).toThrow(/CSV path must be within/)
	})

	it('rejects paths without .csv extension', () => {
		expect(() => validateCsvPath('./data.txt')).toThrow(/must have a .csv extension/)
	})

	it('rejects paths with no extension', () => {
		expect(() => validateCsvPath('./data')).toThrow(/must have a .csv extension/)
	})

	it('accepts relative .csv path within cwd', () => {
		expect(() => validateCsvPath('./data.csv')).not.toThrow()
	})

	it('accepts nested .csv path within cwd', () => {
		expect(() => validateCsvPath('./exports/reconcile.csv')).not.toThrow()
	})

	it('accepts absolute .csv path within cwd', () => {
		const csvPath = `${process.cwd()}/data.csv`
		expect(() => validateCsvPath(csvPath)).not.toThrow()
	})

	it('rejects traversal disguised with .csv extension', () => {
		expect(() => validateCsvPath('../../../etc/passwd.csv')).toThrow(/CSV path must be within/)
	})

	it('accepts path with custom base directory', () => {
		expect(() => validateCsvPath('/tmp/exports/data.csv', '/tmp/exports')).not.toThrow()
	})

	it('rejects path outside custom base directory', () => {
		expect(() => validateCsvPath('/etc/passwd.csv', '/tmp/exports')).toThrow(
			/CSV path must be within/,
		)
	})
})

describe('parseCsvLine', () => {
	it('splits plain unquoted fields', () => {
		expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
	})

	it('trims whitespace from unquoted fields', () => {
		expect(parseCsvLine(' a , b , c ')).toEqual(['a', 'b', 'c'])
	})

	it('handles quoted fields containing commas', () => {
		expect(parseCsvLine('"Smith, John",400,USD')).toEqual(['Smith, John', '400', 'USD'])
	})

	it('handles escaped double-quotes inside quoted fields', () => {
		expect(parseCsvLine('"He said ""hello""",b')).toEqual(['He said "hello"', 'b'])
	})

	it('preserves empty fields', () => {
		expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c'])
	})

	it('handles a single field', () => {
		expect(parseCsvLine('only')).toEqual(['only'])
	})

	it('handles empty input', () => {
		expect(parseCsvLine('')).toEqual([''])
	})

	it('handles quoted field at end of line', () => {
		expect(parseCsvLine('a,"b,c"')).toEqual(['a', 'b,c'])
	})

	it('handles multiple quoted fields', () => {
		expect(parseCsvLine('"a,1","b,2","c,3"')).toEqual(['a,1', 'b,2', 'c,3'])
	})

	it('handles mixed quoted and unquoted fields', () => {
		expect(parseCsvLine('id,"last, first",code')).toEqual(['id', 'last, first', 'code'])
	})
})
