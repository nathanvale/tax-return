import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { getLogContext } from './logging'

interface EventEnvelope {
	readonly name: string
	readonly timestamp: string
	readonly payload: Record<string, unknown>
}

export interface EventsConfig {
	readonly url: string | null
}

function resolvePortFileUrl(): string | null {
	const portFile = path.join(
		homedir(),
		'.cache',
		'side-quest-observability',
		'events.port',
	)
	if (!existsSync(portFile)) return null
	try {
		const raw = readFileSync(portFile, 'utf8').trim()
		if (!raw) return null
		const port = Number(raw)
		if (!Number.isFinite(port) || port <= 0) return null
		return `http://127.0.0.1:${port}`
	} catch {
		return null
	}
}

export function resolveEventsConfig(flags?: {
	readonly eventsUrl?: string | null
}): EventsConfig {
	if (process.env.XERO_EVENTS === '0') return { url: null }
	if (flags?.eventsUrl) return { url: flags.eventsUrl }
	if (process.env.XERO_EVENTS_URL) return { url: process.env.XERO_EVENTS_URL }
	const portUrl = resolvePortFileUrl()
	if (portUrl) return { url: portUrl }
	return { url: null }
}

/** Emit an event to the observability server (fire-and-forget). */
export function emitEvent(
	config: EventsConfig,
	name: string,
	payload: Record<string, unknown>,
): void {
	if (!config.url) return

	const context = getLogContext()
	const envelope: EventEnvelope = {
		name,
		timestamp: new Date().toISOString(),
		payload: context ? { ...payload, runId: context.runId } : payload,
	}

	const endpoint = new URL(`/events/${name}`, config.url)
	void fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(envelope),
	}).catch(() => undefined)
}
