import { afterEach, describe, expect, it } from 'bun:test'
import { xeroFetch } from '../../src/xero/api'

describe('xeroFetch', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		delete process.env.XERO_API_BASE_URL
		globalThis.fetch = originalFetch
	})

	it('retries on 500 and succeeds', async () => {
		let callCount = 0
		globalThis.fetch = async () => {
			callCount += 1
			if (callCount === 1) {
				return new Response(JSON.stringify({ error: 'oops' }), { status: 500 })
			}
			return new Response(JSON.stringify({ Organisations: [] }), { status: 200 })
		}

		const response = await xeroFetch(
			'/Organisation',
			{ method: 'GET' },
			{
				accessToken: 'token',
				tenantId: 'tenant',
				retryLimit: 1,
			},
		)

		expect(response).toEqual({ Organisations: [] })
	})

	it('throws on 404 without retry', async () => {
		globalThis.fetch = async () =>
			new Response(JSON.stringify({ error: 'missing' }), { status: 404 })

		await expect(
			xeroFetch(
				'/Organisation',
				{ method: 'GET' },
				{
					accessToken: 'token',
					tenantId: 'tenant',
					retryLimit: 0,
				},
			),
		).rejects.toThrow('Xero API error')
	})
})
