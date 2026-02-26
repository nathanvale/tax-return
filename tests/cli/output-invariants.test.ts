import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { configure } from '@logtape/logtape'
import { runCli } from '../../src/cli/command'

interface Capture {
	readonly getStdout: () => string
	readonly getStderr: () => string
	restore: () => void
}

/** Capture process.stdout and process.stderr writes into buffers. */
function captureOutput(): Capture {
	let stdout = ''
	let stderr = ''
	const originalStdout = process.stdout.write.bind(process.stdout)
	const originalStderr = process.stderr.write.bind(process.stderr)

	process.stdout.write = ((chunk: string) => {
		stdout += chunk.toString()
		return true
	}) as typeof process.stdout.write

	process.stderr.write = ((chunk: string) => {
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

/** No-op sink that discards all log records. */
function noopSink() {
	return () => {}
}

describe('stdout/stderr separation invariants', () => {
	beforeEach(async () => {
		// Reset LogTape between tests. The reset may throw if a previous stream
		// sink was already closed (LogTape limitation), so we catch and retry.
		try {
			await configure({
				reset: true,
				sinks: { noop: noopSink() },
				loggers: [{ category: [], sinks: ['noop'], lowestLevel: 'fatal' }],
			})
		} catch {
			// Reset threw during sink disposal but config may still be active.
			// Retry with reset: true and no sinks to dispose.
			try {
				await configure({
					reset: true,
					sinks: { noop: noopSink() },
					loggers: [{ category: [], sinks: ['noop'], lowestLevel: 'fatal' }],
				})
			} catch {
				// Config was already cleared by the first reset; configure fresh.
				await configure({
					sinks: { noop: noopSink() },
					loggers: [{ category: [], sinks: ['noop'], lowestLevel: 'fatal' }],
				})
			}
		}
		// Force text log format for deterministic non-TTY output.
		process.env.XERO_LOG_FORMAT = 'text'
	})

	afterEach(() => {
		delete process.env.XERO_LOG_FORMAT
		delete process.env.XERO_EVENTS_URL
		delete process.env.XERO_EVENTS
	})

	it('stdout contains only JSON envelope in --json mode (no log messages)', async () => {
		const capture = captureOutput()
		const exitCode = await runCli(['node', 'xero-cli', 'help', '--json'])
		capture.restore()

		expect(exitCode).toBe(0)
		const stdoutText = capture.getStdout()
		// stdout must be valid JSON (the envelope) and nothing else
		const parsed = JSON.parse(stdoutText.trim())
		expect(parsed.status).toBe('data')
		expect(parsed.schemaVersion).toBe(1)
		// Ensure no stray log lines leaked into stdout
		const lines = stdoutText.trim().split('\n')
		expect(lines.length).toBe(1)
	})

	it('stderr contains no JSON envelope fragments', async () => {
		const capture = captureOutput()
		await runCli(['node', 'xero-cli', 'help', '--json'])
		capture.restore()

		const stderrText = capture.getStderr()
		// stderr must not contain any JSON envelope keys
		expect(stderrText).not.toContain('"schemaVersion"')
		expect(stderrText).not.toContain('"status":"data"')
	})

	it('--quiet stderr is empty on success', async () => {
		const capture = captureOutput()
		const exitCode = await runCli(['node', 'xero-cli', 'help', '--quiet'])
		capture.restore()

		expect(exitCode).toBe(0)
		expect(capture.getStderr()).toBe('')
	})

	it('stdout is empty when --json error is written to stderr', async () => {
		const capture = captureOutput()
		const exitCode = await runCli(['node', 'xero-cli', '--unknown', '--json'])
		capture.restore()

		expect(exitCode).toBe(2)
		// Error output goes to stderr, not stdout
		expect(capture.getStdout()).toBe('')
		const stderrParsed = JSON.parse(capture.getStderr().trim())
		expect(stderrParsed.status).toBe('error')
	})
})
