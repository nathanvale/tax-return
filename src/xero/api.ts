import { setTimeout as delay } from 'node:timers/promises'
import { type EventsConfig, emitEvent } from '../events'
import { getLogContext, getXeroLogger } from '../logging'
import { XeroApiError, XeroAuthError, XeroConflictError } from './errors'

const DEFAULT_BASE_URL = 'https://api.xero.com/api.xro/2.0'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_LIMIT = 2

interface XeroFetchOptions {
	readonly accessToken: string
	readonly tenantId: string
	readonly timeoutMs?: number
	readonly retryLimit?: number
	readonly eventsConfig?: EventsConfig
	readonly onRetry?: (info: {
		readonly reason: 'rate-limit' | 'server-error' | 'timeout'
		readonly backoffMs: number
		readonly status?: number
	}) => void
}

const apiLogger = getXeroLogger(['api'])

function resolveBaseUrl(): string {
	return process.env.XERO_API_BASE_URL ?? DEFAULT_BASE_URL
}

function shouldRetryStatus(status: number): boolean {
	return (
		status === 429 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504
	)
}

function mapHttpError(status: number, message: string): XeroApiError {
	if (status === 401 || status === 403) {
		throw new XeroAuthError(message, {
			code: 'E_UNAUTHORIZED',
			recoverable: false,
		})
	}
	if (status === 409 || status === 412) {
		return new XeroConflictError(message, {
			code: 'E_CONFLICT',
			recoverable: true,
		})
	}
	if (status === 429) {
		return new XeroApiError(message, {
			code: 'E_RATE_LIMITED',
			recoverable: true,
			status,
		})
	}
	if (status >= 500) {
		return new XeroApiError(message, {
			code: 'E_SERVER_ERROR',
			recoverable: true,
			status,
		})
	}
	return new XeroApiError(message, {
		code: 'E_API_ERROR',
		recoverable: false,
		status,
	})
}

/** Perform a Xero API request with retry + timeout handling. */
export async function xeroFetch<T>(
	path: string,
	init: RequestInit,
	options: XeroFetchOptions,
): Promise<T> {
	const baseUrl = resolveBaseUrl()
	const url = new URL(path, baseUrl)
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT

	let attempt = 0
	while (true) {
		attempt += 1
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			apiLogger.debug('Request {method} {url}', {
				method: init.method ?? 'GET',
				url: url.toString(),
				...getLogContext(),
			})
			emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-started', {
				method: init.method ?? 'GET',
				url: url.toString(),
			})

			const response = await fetch(url, {
				...init,
				signal: controller.signal,
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Authorization: `Bearer ${options.accessToken}`,
					'Xero-tenant-id': options.tenantId,
					...(init.headers ?? {}),
				},
			})

			if (!response.ok) {
				const payload = await response.text().catch(() => '')
				const message = payload
					? `Xero API error (${response.status}): ${payload}`
					: `Xero API error (${response.status})`

				if (shouldRetryStatus(response.status) && attempt <= retryLimit + 1) {
					const retryAfter = Number(response.headers.get('retry-after') ?? '0')
					const backoff = retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt
					const reason = response.status === 429 ? 'rate-limit' : 'server-error'
					if (response.status === 429) {
						apiLogger.warn('Rate limited. Retrying after {backoff}ms', {
							status: response.status,
							backoff,
							...getLogContext(),
						})
					} else {
						apiLogger.info('Retrying after HTTP {status} in {backoff}ms', {
							status: response.status,
							backoff,
							...getLogContext(),
						})
					}
					options.onRetry?.({
						reason,
						backoffMs: backoff,
						status: response.status,
					})
					emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-retry', {
						status: response.status,
						backoffMs: backoff,
						reason,
					})
					await delay(backoff)
					continue
				}

				throw mapHttpError(response.status, message)
			}

			const data = (await response.json()) as T
			emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-completed', {
				method: init.method ?? 'GET',
				url: url.toString(),
				status: response.status,
			})
			return data
		} catch (err) {
			if (
				err instanceof XeroApiError ||
				err instanceof XeroAuthError ||
				err instanceof XeroConflictError
			) {
				emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-error', {
					message: err.message,
					code: err.code,
				})
				throw err
			}
			if (err instanceof Error && err.name === 'AbortError') {
				if (attempt <= retryLimit + 1) {
					apiLogger.info('Retrying after timeout in {backoff}ms', {
						backoff: 1000 * attempt,
						...getLogContext(),
					})
					options.onRetry?.({
						reason: 'timeout',
						backoffMs: 1000 * attempt,
					})
					emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-retry', {
						reason: 'timeout',
						backoffMs: 1000 * attempt,
					})
					await delay(1000 * attempt)
					continue
				}
				emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-error', {
					message: 'Request timed out',
					code: 'E_NETWORK',
				})
				throw new XeroApiError('Request timed out', {
					code: 'E_NETWORK',
					recoverable: true,
				})
			}
			emitEvent(options.eventsConfig ?? { url: null }, 'xero-fetch-error', {
				message: 'Network error',
				code: 'E_NETWORK',
			})
			throw new XeroApiError('Network error', {
				code: 'E_NETWORK',
				recoverable: true,
			})
		} finally {
			clearTimeout(timeout)
		}
	}
}

/** POST helper that returns unknown so callers must validate. */
export async function xeroPost(
	path: string,
	body: Record<string, unknown>,
	options: XeroFetchOptions,
): Promise<unknown> {
	return await xeroFetch<unknown>(
		path,
		{
			method: 'POST',
			body: JSON.stringify(body),
		},
		options,
	)
}
