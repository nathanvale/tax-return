import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runReconcile } from '../../src/cli/commands/reconcile'
import { resolveEventsConfig } from '../../src/events'
import { InMemoryAuthProvider, resetAuthProvider, setAuthProvider } from '../../src/xero/auth'
import { createXeroMockServer, type MockRoute } from '../helpers/xero-mock-server'

const TEST_TOKENS = {
	accessToken: 'token',
	refreshToken: 'refresh',
	expiresAt: Date.now() + 10 * 60_000,
}

interface Capture {
	readonly getStdout: () => string
	restore: () => void
}

function captureStdout(): Capture {
	let stdout = ''
	const originalStdout = process.stdout.write.bind(process.stdout)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	process.stdout.write = ((chunk: any) => {
		stdout += chunk.toString()
		return true
	}) as typeof process.stdout.write
	return {
		getStdout: () => stdout,
		restore: () => {
			process.stdout.write = originalStdout
		},
	}
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(path.join(tmpdir(), 'xero-cli-'))
	const originalCwd = process.cwd()
	process.chdir(dir)
	try {
		return await fn(dir)
	} finally {
		process.chdir(originalCwd)
		await rm(dir, { recursive: true, force: true })
	}
}

async function writeConfig(): Promise<void> {
	await writeFile('.xero-config.json', JSON.stringify({ tenantId: 'tenant', orgName: 'Test' }), {
		mode: 0o600,
	})
}

function baseRoutes(
	ids: string[],
	totals: number[],
	options?: { includePost?: boolean },
): MockRoute[] {
	const routes: MockRoute[] = [
		{
			method: 'GET',
			path: '/BankTransactions',
			response: {
				status: 200,
				body: {
					BankTransactions: ids.map((id, index) => ({
						BankTransactionID: id,
						Type: 'SPEND',
						Total: totals[index] ?? 0,
					})),
				},
			},
		},
		{
			method: 'GET',
			path: '/Accounts',
			response: {
				status: 200,
				body: { Accounts: [{ Code: '400', Status: 'ACTIVE' }] },
			},
		},
		{
			method: 'GET',
			path: /^\/BankTransactions\//,
			response: (req) => {
				const id = new URL(req.url).pathname.split('/').pop() ?? ''
				return {
					status: 200,
					body: {
						BankTransactions: [
							{
								BankTransactionID: id,
								Total: 10,
								BankAccount: { AccountID: 'bank-1' },
								LineItems: [],
							},
						],
					},
				}
			},
		},
	]
	if (options?.includePost ?? true) {
		routes.push({
			method: 'POST',
			path: /^\/BankTransactions\//,
			response: (req) => {
				const id = new URL(req.url).pathname.split('/').pop() ?? ''
				return {
					status: 200,
					body: {
						BankTransactions: [{ BankTransactionID: id, Total: 10 }],
					},
				}
			},
		})
	}
	return routes
}

afterEach(() => {
	resetAuthProvider()
	delete process.env.XERO_API_BASE_URL
	delete process.env.XERO_EVENTS_URL
	delete process.env.XERO_EVENTS
})

describe('reconcile integration scenarios', () => {
	it('happy path writes state + audit', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			const routes = baseRoutes(
				[
					'11111111-1111-1111-1111-111111111111',
					'22222222-2222-2222-2222-222222222222',
					'33333333-3333-3333-3333-333333333333',
					'44444444-4444-4444-4444-444444444444',
					'55555555-5555-5555-5555-555555555555',
				],
				[10, 20, 30, 40, 50],
			)
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
									{ BankTransactionID: '22222222-2222-2222-2222-222222222222', AccountCode: '400' },
									{ BankTransactionID: '33333333-3333-3333-3333-333333333333', AccountCode: '400' },
									{ BankTransactionID: '44444444-4444-4444-4444-444444444444', AccountCode: '400' },
									{ BankTransactionID: '55555555-5555-5555-5555-555555555555', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const capture = captureStdout()
			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			capture.restore()
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode).toBe(0)
			const stateRaw = await readFile('.xero-reconcile-state.json', 'utf8')
			const state = JSON.parse(stateRaw) as { processed: Record<string, boolean> }
			expect(Object.keys(state.processed)).toHaveLength(5)

			const auditDir = path.join(process.cwd(), '.xero-reconcile-runs')
			const files = await readdir(auditDir)
			expect(files.length).toBeGreaterThan(0)
		})
	})

	it('mixed success and failures update state only for successes', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			const routes: MockRoute[] = [
				...baseRoutes(
					[
						'11111111-1111-1111-1111-111111111111',
						'22222222-2222-2222-2222-222222222222',
						'33333333-3333-3333-3333-333333333333',
						'44444444-4444-4444-4444-444444444444',
						'55555555-5555-5555-5555-555555555555',
					],
					[10, 20, 30, 40, 50],
					{ includePost: false },
				),
				{
					method: 'POST',
					path: '/BankTransactions/44444444-4444-4444-4444-444444444444',
					response: {
						status: 200,
						body: {
							BankTransactions: [
								{
									BankTransactionID: '44444444-4444-4444-4444-444444444444',
									HasValidationErrors: true,
								},
							],
						},
					},
				},
				{
					method: 'POST',
					path: '/BankTransactions/55555555-5555-5555-5555-555555555555',
					response: [
						{ status: 429, body: { error: 'rate limit' } },
						{ status: 400, body: { error: 'rate limit' } },
					],
				},
				{
					method: 'POST',
					path: /^\/BankTransactions\//,
					response: (req) => {
						const id = new URL(req.url).pathname.split('/').pop() ?? ''
						return {
							status: 200,
							body: {
								BankTransactions: [{ BankTransactionID: id, Total: 10 }],
							},
						}
					},
				},
			]
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
									{ BankTransactionID: '22222222-2222-2222-2222-222222222222', AccountCode: '400' },
									{ BankTransactionID: '33333333-3333-3333-3333-333333333333', AccountCode: '400' },
									{ BankTransactionID: '44444444-4444-4444-4444-444444444444', AccountCode: '400' },
									{ BankTransactionID: '55555555-5555-5555-5555-555555555555', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const capture = captureStdout()
			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			capture.restore()
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode).toBe(0)
			const payload = JSON.parse(capture.getStdout())
			expect(payload.data.summary.succeeded).toBe(3)
			expect(payload.data.summary.failed).toBe(2)

			const stateRaw = await readFile('.xero-reconcile-state.json', 'utf8')
			const state = JSON.parse(stateRaw) as { processed: Record<string, boolean> }
			expect(Object.keys(state.processed)).toHaveLength(3)
		})
	})

	it('resume after interruption skips processed items', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			let callCount = 0
			const routes: MockRoute[] = [
				...baseRoutes(
					[
						'11111111-1111-1111-1111-111111111111',
						'22222222-2222-2222-2222-222222222222',
						'33333333-3333-3333-3333-333333333333',
						'44444444-4444-4444-4444-444444444444',
						'55555555-5555-5555-5555-555555555555',
					],
					[10, 20, 30, 40, 50],
					{ includePost: false },
				),
				{
					method: 'POST',
					path: /^\/BankTransactions\//,
					response: (req) => {
						callCount += 1
						if (callCount === 3) {
							process.emit('SIGINT')
						}
						const id = new URL(req.url).pathname.split('/').pop() ?? ''
						return {
							status: 200,
							body: {
								BankTransactions: [{ BankTransactionID: id, Total: 10 }],
							},
						}
					},
				},
			]
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
									{ BankTransactionID: '22222222-2222-2222-2222-222222222222', AccountCode: '400' },
									{ BankTransactionID: '33333333-3333-3333-3333-333333333333', AccountCode: '400' },
									{ BankTransactionID: '44444444-4444-4444-4444-444444444444', AccountCode: '400' },
									{ BankTransactionID: '55555555-5555-5555-5555-555555555555', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const capture1 = captureStdout()
			const exitCode1 = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			capture1.restore()
			expect(exitCode1).toBe(130)

			const capture2 = captureStdout()
			const exitCode2 = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			capture2.restore()
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode2).toBe(0)
			const payload = JSON.parse(capture2.getStdout())
			const skipped = payload.data.results.filter((r: { status: string }) => r.status === 'skipped')
			const reconciled = payload.data.results.filter(
				(r: { status: string }) => r.status === 'reconciled',
			)
			expect(skipped.length).toBeGreaterThanOrEqual(3)
			expect(reconciled.length).toBe(2)
		})
	})

	it('rejects duplicate BankTransactionIDs', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			const routes = baseRoutes(['11111111-1111-1111-1111-111111111111'], [10])
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: 'dup', AccountCode: '400' },
									{ BankTransactionID: 'dup', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: false, fromCsv: null },
			)
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode).toBe(1)
		})
	})

	it('treats stale updates as skipped', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			const routes: MockRoute[] = [
				...baseRoutes(['11111111-1111-1111-1111-111111111111'], [10], { includePost: false }),
				{
					method: 'POST',
					path: '/BankTransactions/11111111-1111-1111-1111-111111111111',
					response: {
						status: 409,
						body: { error: 'conflict' },
					},
				},
			]
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const capture = captureStdout()
			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			capture.restore()
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode).toBe(0)
			const payload = JSON.parse(capture.getStdout())
			const skipped = payload.data.results.filter((r: { status: string }) => r.status === 'skipped')
			expect(skipped).toHaveLength(1)
		})
	})

	it('processes invoice payments in a batch', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			const routes: MockRoute[] = [
				{
					method: 'GET',
					path: '/BankTransactions',
					response: {
						status: 200,
						body: {
							BankTransactions: [
								{
									BankTransactionID: '11111111-1111-1111-1111-111111111111',
									Type: 'RECEIVE',
									Total: 120,
								},
								{
									BankTransactionID: '22222222-2222-2222-2222-222222222222',
									Type: 'RECEIVE',
									Total: 80,
								},
								{
									BankTransactionID: '33333333-3333-3333-3333-333333333333',
									Type: 'RECEIVE',
									Total: 50,
								},
							],
						},
					},
				},
				{
					method: 'GET',
					path: '/Accounts',
					response: {
						status: 200,
						body: { Accounts: [{ Code: '400', Status: 'ACTIVE' }] },
					},
				},
				{
					method: 'GET',
					path: /^\/Invoices/,
					response: {
						status: 200,
						body: {
							Invoices: [
								{
									InvoiceID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
									Status: 'AUTHORISED',
									AmountDue: 120,
									CurrencyCode: 'AUD',
								},
								{
									InvoiceID: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
									Status: 'AUTHORISED',
									AmountDue: 80,
									CurrencyCode: 'AUD',
								},
								{
									InvoiceID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
									Status: 'AUTHORISED',
									AmountDue: 50,
									CurrencyCode: 'AUD',
								},
							],
						},
					},
				},
				{
					method: 'GET',
					path: /^\/BankTransactions\//,
					response: (req) => {
						const id = new URL(req.url).pathname.split('/').pop() ?? ''
						return {
							status: 200,
							body: {
								BankTransactions: [
									{
										BankTransactionID: id,
										Total: 10,
										BankAccount: { AccountID: 'bank-1' },
										LineItems: [],
									},
								],
							},
						}
					},
				},
				{
					method: 'PUT',
					path: '/Payments',
					response: {
						status: 200,
						body: {
							Payments: [
								{ PaymentID: 'pay-1', Amount: 120 },
								{ PaymentID: 'pay-2', Amount: 80 },
								{ PaymentID: 'pay-3', Amount: 50 },
							],
						},
					},
				},
			]
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{
										BankTransactionID: '11111111-1111-1111-1111-111111111111',
										InvoiceID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
										Amount: 120,
										CurrencyCode: 'AUD',
									},
									{
										BankTransactionID: '22222222-2222-2222-2222-222222222222',
										InvoiceID: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
										Amount: 80,
										CurrencyCode: 'AUD',
									},
									{
										BankTransactionID: '33333333-3333-3333-3333-333333333333',
										InvoiceID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
										Amount: 50,
										CurrencyCode: 'AUD',
									},
								]),
							),
						)
						controller.close()
					},
				})

			const capture = captureStdout()
			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			capture.restore()
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode).toBe(0)
			const payload = JSON.parse(capture.getStdout())
			expect(payload.data.summary.succeeded).toBe(3)

			const stateRaw = await readFile('.xero-reconcile-state.json', 'utf8')
			const state = JSON.parse(stateRaw) as { processed: Record<string, boolean> }
			expect(Object.keys(state.processed)).toHaveLength(3)
		})
	})

	it('refreshes tokens mid-run when expired', async () => {
		await withTempDir(async () => {
			setAuthProvider(
				new InMemoryAuthProvider({
					accessToken: 'expired',
					refreshToken: 'refresh',
					expiresAt: Date.now() - 1000,
				}),
			)
			await writeConfig()

			let refreshCount = 0
			const originalFetch = globalThis.fetch
			globalThis.fetch = async (url, init) => {
				if (url.toString().startsWith('https://identity.xero.com/connect/token')) {
					refreshCount += 1
					return new Response(
						JSON.stringify({
							access_token: 'new-token',
							refresh_token: 'new-refresh',
							expires_in: 3600,
						}),
						{ status: 200 },
					)
				}
				return originalFetch(url, init)
			}

			const routes = baseRoutes(['11111111-1111-1111-1111-111111111111'], [10])
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: true, fromCsv: null },
			)
			;(Bun.stdin as any).stream = original
			server.stop()
			globalThis.fetch = originalFetch

			expect(exitCode).toBe(0)
			expect(refreshCount).toBe(1)
		})
	})

	it('dry-run does not write state or audit', async () => {
		await withTempDir(async () => {
			setAuthProvider(new InMemoryAuthProvider(TEST_TOKENS))
			await writeConfig()

			const routes = baseRoutes(['11111111-1111-1111-1111-111111111111'], [10])
			const server = createXeroMockServer(routes)
			process.env.XERO_API_BASE_URL = server.url

			const original = Bun.stdin.stream
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(Bun.stdin as any).stream = () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								JSON.stringify([
									{ BankTransactionID: '11111111-1111-1111-1111-111111111111', AccountCode: '400' },
								]),
							),
						)
						controller.close()
					},
				})

			const exitCode = await runReconcile(
				{
					json: true,
					quiet: true,
					logLevel: 'silent',
					progressMode: 'off',
					eventsConfig: resolveEventsConfig(),
				},
				{ command: 'reconcile', execute: false, fromCsv: null },
			)
			;(Bun.stdin as any).stream = original
			server.stop()

			expect(exitCode).toBe(0)
			await unlink('.xero-reconcile-state.json').then(
				() => {
					throw new Error('state file should not exist')
				},
				() => undefined,
			)
			await readdir(path.join(process.cwd(), '.xero-reconcile-runs')).then(
				() => {
					throw new Error('audit dir should not exist')
				},
				() => undefined,
			)
		})
	})
})
