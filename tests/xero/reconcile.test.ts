import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, unlink } from 'node:fs/promises'
import { runReconcile } from '../../src/cli/commands/reconcile'
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
