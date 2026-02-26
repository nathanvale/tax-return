import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { configure, getConsoleSink } from '@logtape/logtape'
import { runCli } from '../../src/cli/command'

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
