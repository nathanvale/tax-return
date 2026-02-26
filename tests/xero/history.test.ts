import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, unlink } from 'node:fs/promises'
import { runHistory } from '../../src/cli/commands/history'
import { resolveEventsConfig } from '../../src/events'

const TEST_TOKENS = {
	accessToken: 'token',
	refreshToken: 'refresh',
	expiresAt: Date.now() + 60_000,
}

describe('history', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		delete process.env.XERO_TEST_TOKENS
		globalThis.fetch = originalFetch
	})

	it('requires --since', async () => {
		const ctx = {
			json: true,
			quiet: true,
			logLevel: 'silent' as const,
			progressMode: 'off' as const,
			eventsConfig: resolveEventsConfig(),
		}
		const exitCode = await runHistory(ctx, {
			command: 'history',
			since: null,
			contact: null,
			accountCode: null,
			fields: null,
		})
		expect(exitCode).toBe(2)
	})

	it('groups transactions', async () => {
		process.env.XERO_TEST_TOKENS = JSON.stringify(TEST_TOKENS)
		await Bun.write('.xero-config.json', JSON.stringify({ tenantId: 'tenant', orgName: 'Test' }), {
			mode: 0o600,
		})
		await chmod('.xero-config.json', 0o600)
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					BankTransactions: [
						{
							BankTransactionID: 'tx-1',
							Contact: { Name: 'ACME' },
							Total: -10,
							DateString: '2026-01-01',
							Type: 'SPEND',
							CurrencyCode: 'AUD',
							LineItems: [{ AccountCode: '400' }],
						},
						{
							BankTransactionID: 'tx-2',
							Contact: { Name: 'ACME' },
							Total: -15,
							DateString: '2026-01-02',
							Type: 'SPEND',
							CurrencyCode: 'AUD',
							LineItems: [{ AccountCode: '400' }],
						},
					],
				}),
				{ status: 200 },
			)

		const ctx = {
			json: true,
			quiet: true,
			logLevel: 'silent' as const,
			progressMode: 'off' as const,
			eventsConfig: resolveEventsConfig(),
		}
		const exitCode = await runHistory(ctx, {
			command: 'history',
			since: '2026-01-01',
			contact: null,
			accountCode: null,
			fields: null,
		})
		expect(exitCode).toBe(0)
		await unlink('.xero-config.json').catch(() => undefined)
	})
})
