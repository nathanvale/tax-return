import { existsSync } from 'node:fs'
import {
	appendFile,
	mkdir,
	readdir,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { emitEvent } from '../../events'
import { acquireLock, releaseLock } from '../../state/lock'
import {
	isProcessed,
	loadState,
	markProcessed,
	saveState,
} from '../../state/state'
import { xeroFetch } from '../../xero/api'
import { loadValidTokens } from '../../xero/auth'
import { loadEnvConfig, loadXeroConfig } from '../../xero/config'
import {
	XeroApiError,
	XeroAuthError,
	XeroConflictError,
} from '../../xero/errors'

const EXIT_OK = 0
const EXIT_RUNTIME = 1
const EXIT_USAGE = 2
const EXIT_UNAUTHORIZED = 4
const EXIT_INTERRUPTED = 130

const MAX_STDIN_BYTES = 5 * 1024 * 1024
const AUDIT_DIR = '.xero-reconcile-runs'
const AUDIT_MODE = 0o600
const AUDIT_DIR_MODE = 0o700
const UUID_SHAPE =
	/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/
const ACCOUNT_CODE_SHAPE = /^[A-Za-z0-9]{1,10}$/

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130

interface OutputContext {
	readonly json: boolean
	readonly quiet: boolean
	readonly logLevel: 'silent' | 'info' | 'debug'
	readonly progressMode: 'animated' | 'static' | 'off'
	readonly eventsConfig: ReturnType<
		typeof import('../../events').resolveEventsConfig
	>
}

interface ReconcileCommand {
	readonly command: 'reconcile'
	readonly execute: boolean
	readonly fromCsv: string | null
}

const ReconcileItemSchema = z
	.object({
		BankTransactionID: z
			.string()
			.regex(UUID_SHAPE, 'Invalid BankTransactionID'),
		AccountCode: z
			.string()
			.regex(ACCOUNT_CODE_SHAPE, 'Invalid AccountCode')
			.optional(),
		InvoiceID: z.string().regex(UUID_SHAPE, 'Invalid InvoiceID').optional(),
		Amount: z.number().positive().optional(),
		CurrencyCode: z.string().min(1).optional(),
	})
	.strict()
	.refine((value) => !(value.AccountCode && value.InvoiceID), {
		message: 'AccountCode and InvoiceID are mutually exclusive',
	})

const ReconcileArraySchema = z.array(ReconcileItemSchema).min(1).max(1000)

class ProgressDisplay {
	private lastLineLength = 0

	constructor(private readonly mode: 'animated' | 'static' | 'off') {}

	update(current: number, total: number, message?: string): void {
		if (this.mode === 'off') return
		const base = `Progress ${current}/${total}`
		const line = message ? `${base} - ${message}` : base
		this.writeLine(line, this.mode === 'animated')
	}

	pause(message: string): void {
		if (this.mode === 'off') return
		this.writeLine(`Rate limit pause: ${message}`, false)
	}

	finish(): void {
		if (this.mode === 'off') return
		if (this.mode === 'animated') {
			process.stderr.write('\n')
		}
	}

	private writeLine(line: string, overwrite: boolean): void {
		if (!overwrite) {
			process.stderr.write(`${line}\n`)
			this.lastLineLength = 0
			return
		}
		const padding =
			this.lastLineLength > line.length
				? ' '.repeat(this.lastLineLength - line.length)
				: ''
		process.stderr.write(`\r${line}${padding}`)
		this.lastLineLength = line.length
	}
}

interface ReconcileInputBase {
	readonly BankTransactionID: string
	readonly AccountCode?: string
	readonly InvoiceID?: string
	readonly Amount?: number
	readonly CurrencyCode?: string
}

interface ReconcileResult {
	readonly BankTransactionID: string
	readonly status: 'reconciled' | 'skipped' | 'failed' | 'dry-run'
	readonly AccountCode?: string
	readonly InvoiceID?: string
	readonly PaymentID?: string
	readonly error?: string
}

interface BankTransactionRecord {
	readonly BankTransactionID: string
	readonly Type?: string
	readonly Total?: number
	readonly DateString?: string
	readonly LineItems?: LineItemRecord[]
	readonly BankAccount?: { AccountID?: string }
	readonly HasValidationErrors?: boolean
	readonly StatusAttributeString?: string
	readonly HasErrors?: boolean
}

interface LineItemRecord {
	readonly Description?: string
	readonly Quantity?: number
	readonly UnitAmount?: number
	readonly TaxType?: string
	readonly TaxAmount?: number
	readonly LineAmount?: number
	readonly AccountCode?: string
}

interface BankTransactionsResponse {
	readonly BankTransactions: BankTransactionRecord[]
}

interface AccountsResponse {
	readonly Accounts: { Code?: string; Status?: string }[]
}

interface InvoicesResponse {
	readonly Invoices: {
		InvoiceID: string
		Status: string
		AmountDue: number
		CurrencyCode: string
	}[]
}

interface PaymentsResponse {
	readonly Payments: {
		PaymentID?: string
		StatusAttributeString?: string
		HasErrors?: boolean
		HasValidationErrors?: boolean
		Amount?: number
	}[]
}

interface RetryInfo {
	readonly reason: 'rate-limit' | 'server-error' | 'timeout'
	readonly backoffMs: number
	readonly status?: number
}

const ERROR_CODE_ACTIONS: Record<
	string,
	{ action: string; retryable: boolean }
> = {
	E_RUNTIME: { action: 'ESCALATE', retryable: false },
	E_USAGE: { action: 'FIX_ARGS', retryable: false },
	E_UNAUTHORIZED: { action: 'RUN_AUTH', retryable: false },
	E_CONFLICT: { action: 'WAIT_AND_RETRY', retryable: true },
}

function writeSuccess<T>(
	ctx: OutputContext,
	data: T,
	humanLines: string[],
	quietLine: string,
): void {
	if (ctx.json) {
		process.stdout.write(
			`${JSON.stringify({ status: 'data', schemaVersion: 1, data })}\n`,
		)
		return
	}
	if (ctx.quiet) {
		process.stdout.write(`${quietLine}\n`)
		return
	}
	process.stdout.write(`${humanLines.join('\n')}\n`)
}

function writeError(
	ctx: OutputContext,
	message: string,
	errorCode: string,
	errorName: string,
	context?: Record<string, unknown>,
): void {
	if (ctx.json) {
		const fallback = { action: 'ESCALATE', retryable: false }
		const action = ERROR_CODE_ACTIONS[errorCode] ?? fallback
		const errorPayload: Record<string, unknown> = {
			name: errorName,
			code: errorCode,
			action: action.action,
			retryable: action.retryable,
		}
		if (context) errorPayload.context = context
		process.stderr.write(
			`${JSON.stringify({
				status: 'error',
				message,
				error: errorPayload,
			})}\n`,
		)
		return
	}
	const line = ctx.quiet ? message : `[xero-cli] ${message}`
	process.stderr.write(`${line}\n`)
}

/** Validate BankTransaction API responses before mutating state. */
export function assertValidBankTransactionResponse(
	response: BankTransactionsResponse,
	options?: { readonly expectedTotal?: number },
): BankTransactionRecord {
	if (!response || typeof response !== 'object') {
		throw new Error('Invalid BankTransaction response payload')
	}
	const txn = response.BankTransactions?.[0]
	if (!txn || typeof txn !== 'object') {
		throw new Error('Missing BankTransaction in response')
	}
	if (!txn.BankTransactionID) {
		throw new Error('Missing BankTransactionID in response')
	}
	if (
		txn.HasErrors ||
		txn.HasValidationErrors ||
		txn.StatusAttributeString === 'ERROR'
	) {
		throw new Error('BankTransaction response has validation errors')
	}
	if (
		typeof options?.expectedTotal === 'number' &&
		typeof txn.Total === 'number' &&
		Math.abs(options.expectedTotal - txn.Total) > 0.01
	) {
		throw new Error('BankTransaction total mismatch')
	}
	return txn
}

/** Validate Payment API responses before mutating state. */
export function assertValidPaymentResponse(
	payment: PaymentsResponse['Payments'][number],
): void {
	if (!payment || typeof payment !== 'object') {
		throw new Error('Invalid Payment response payload')
	}
	if (!payment.PaymentID) {
		throw new Error('Missing PaymentID in response')
	}
	if (
		payment.HasErrors ||
		payment.HasValidationErrors ||
		payment.StatusAttributeString === 'ERROR'
	) {
		throw new Error('Payment response has validation errors')
	}
	if (typeof payment.Amount !== 'number') {
		throw new Error('Missing Amount in payment response')
	}
}

function ensureNoDuplicates(inputs: ReconcileInputBase[]): string[] {
	const seen = new Set<string>()
	const duplicates: string[] = []
	for (const item of inputs) {
		if (seen.has(item.BankTransactionID)) {
			duplicates.push(item.BankTransactionID)
		} else {
			seen.add(item.BankTransactionID)
		}
	}
	return duplicates
}

function validateInputs(inputs: ReconcileInputBase[]): ReconcileInputBase[] {
	const validated = ReconcileArraySchema.safeParse(inputs)
	if (!validated.success) {
		throw new Error(
			validated.error.issues.map((issue) => issue.message).join('; '),
		)
	}
	const duplicates = ensureNoDuplicates(validated.data)
	if (duplicates.length > 0) {
		throw new Error(`Duplicate BankTransactionID(s): ${duplicates.join(', ')}`)
	}
	return validated.data
}

function parseJsonInput(raw: string): ReconcileInputBase[] {
	const parsed = JSON.parse(raw) as unknown
	return validateInputs(parsed as ReconcileInputBase[])
}

async function readStdinWithLimit(): Promise<string> {
	const chunks: Uint8Array[] = []
	let total = 0
	for await (const chunk of Bun.stdin.stream()) {
		const buffer = new Uint8Array(chunk)
		total += buffer.length
		if (total > MAX_STDIN_BYTES) {
			throw new Error('Input exceeds 5MB limit')
		}
		chunks.push(buffer)
	}
	return Buffer.concat(chunks).toString('utf8')
}

function parseCsvLine(line: string): string[] {
	return line.split(',').map((part) => part.trim())
}

async function loadCsv(pathname: string): Promise<ReconcileInputBase[]> {
	const raw = await Bun.file(pathname).text()
	const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
	if (lines.length === 0) throw new Error('CSV is empty')
	const firstLine = lines[0] as string
	const header = parseCsvLine(firstLine)
	const required = ['BankTransactionID', 'AccountCode']
	for (const col of required) {
		if (!header.includes(col)) {
			throw new Error(`CSV missing required column: ${col}`)
		}
	}
	const inputs: ReconcileInputBase[] = []
	for (const line of lines.slice(1)) {
		const values = parseCsvLine(line)
		const record: Record<string, string> = {}
		header.forEach((key, idx) => {
			record[key] = values[idx] ?? ''
		})
		if (!record.BankTransactionID || !record.AccountCode) continue
		inputs.push({
			BankTransactionID: record.BankTransactionID,
			AccountCode: record.AccountCode,
			InvoiceID: record.InvoiceID || undefined,
			Amount: record.Amount ? Number(record.Amount) : undefined,
			CurrencyCode: record.CurrencyCode || undefined,
		})
	}
	return validateInputs(inputs)
}

async function ensureAuditDir(): Promise<string> {
	const dir = path.join(process.cwd(), AUDIT_DIR)
	await mkdir(dir, { recursive: true, mode: AUDIT_DIR_MODE })
	return dir
}

async function pruneAudits(): Promise<void> {
	const dir = path.join(process.cwd(), AUDIT_DIR)
	if (!existsSync(dir)) return
	const entries = await readdir(dir)
	const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
	await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir, entry)
			const info = await stat(fullPath)
			if (info.mtimeMs < cutoff) {
				await unlink(fullPath)
			}
		}),
	)
}

async function createAuditFile(auditPath: string): Promise<void> {
	await writeFile(auditPath, '', {
		encoding: 'utf8',
		mode: AUDIT_MODE,
		flag: 'wx',
	})
}

async function writeAuditLine(
	auditPath: string,
	payload: Record<string, unknown>,
): Promise<void> {
	const line = `${JSON.stringify(payload)}\n`
	await appendFile(auditPath, line, { encoding: 'utf8' })
}

async function fetchUnreconciledSnapshot(
	accessToken: string,
	tenantId: string,
	options: {
		readonly eventsConfig: OutputContext['eventsConfig']
		readonly onRetry?: (info: RetryInfo) => void
	},
): Promise<Map<string, { Type?: string; Total?: number }>> {
	const response = await xeroFetch<BankTransactionsResponse>(
		'/BankTransactions?where=IsReconciled==false',
		{ method: 'GET' },
		{
			accessToken,
			tenantId,
			eventsConfig: options.eventsConfig,
			onRetry: options.onRetry,
		},
	)
	const snapshot = new Map<string, { Type?: string; Total?: number }>()
	for (const txn of response.BankTransactions ?? []) {
		if (!txn.BankTransactionID) continue
		snapshot.set(txn.BankTransactionID, {
			Type: txn.Type,
			Total: txn.Total,
		})
	}
	return snapshot
}

async function fetchAccounts(
	accessToken: string,
	tenantId: string,
	options: {
		readonly eventsConfig: OutputContext['eventsConfig']
		readonly onRetry?: (info: RetryInfo) => void
	},
): Promise<Set<string>> {
	const response = await xeroFetch<AccountsResponse>(
		'/Accounts',
		{ method: 'GET' },
		{
			accessToken,
			tenantId,
			eventsConfig: options.eventsConfig,
			onRetry: options.onRetry,
		},
	)
	return new Set(
		(response.Accounts ?? [])
			.filter((account) => account.Status === 'ACTIVE')
			.map((account) => account.Code)
			.filter(Boolean) as string[],
	)
}

async function fetchBankTransaction(
	accessToken: string,
	tenantId: string,
	id: string,
	options: {
		readonly eventsConfig: OutputContext['eventsConfig']
		readonly onRetry?: (info: RetryInfo) => void
	},
): Promise<BankTransactionRecord> {
	const response = await xeroFetch<BankTransactionsResponse>(
		`/BankTransactions/${id}`,
		{ method: 'GET' },
		{
			accessToken,
			tenantId,
			eventsConfig: options.eventsConfig,
			onRetry: options.onRetry,
		},
	)
	return assertValidBankTransactionResponse(response)
}

async function updateBankTransaction(
	accessToken: string,
	tenantId: string,
	transactionId: string,
	lineItems: LineItemRecord[],
	expectedTotal: number | undefined,
	options: {
		readonly eventsConfig: OutputContext['eventsConfig']
		readonly onRetry?: (info: RetryInfo) => void
	},
): Promise<BankTransactionRecord> {
	const response = await xeroFetch<BankTransactionsResponse>(
		`/BankTransactions/${transactionId}`,
		{
			method: 'POST',
			body: JSON.stringify({
				BankTransactions: [
					{
						BankTransactionID: transactionId,
						IsReconciled: true,
						LineItems: lineItems,
					},
				],
			}),
		},
		{
			accessToken,
			tenantId,
			eventsConfig: options.eventsConfig,
			onRetry: options.onRetry,
		},
	)
	return assertValidBankTransactionResponse(response, {
		expectedTotal,
	})
}

async function fetchInvoices(
	accessToken: string,
	tenantId: string,
	ids: string[],
	options: {
		readonly eventsConfig: OutputContext['eventsConfig']
		readonly onRetry?: (info: RetryInfo) => void
	},
): Promise<Map<string, InvoicesResponse['Invoices'][number]>> {
	const byId = new Map<string, InvoicesResponse['Invoices'][number]>()
	const chunkSize = 50
	for (let i = 0; i < ids.length; i += chunkSize) {
		const batch = ids.slice(i, i + chunkSize)
		const response = await xeroFetch<InvoicesResponse>(
			`/Invoices?IDs=${batch.join(',')}`,
			{ method: 'GET' },
			{
				accessToken,
				tenantId,
				eventsConfig: options.eventsConfig,
				onRetry: options.onRetry,
			},
		)
		for (const invoice of response.Invoices ?? []) {
			byId.set(invoice.InvoiceID, invoice)
		}
	}
	return byId
}

async function createPayments(
	accessToken: string,
	tenantId: string,
	payments: Record<string, unknown>[],
	options: {
		readonly eventsConfig: OutputContext['eventsConfig']
		readonly onRetry?: (info: RetryInfo) => void
	},
): Promise<PaymentsResponse['Payments']> {
	const response = await xeroFetch<PaymentsResponse>(
		'/Payments',
		{
			method: 'PUT',
			body: JSON.stringify({ Payments: payments }),
		},
		{
			accessToken,
			tenantId,
			eventsConfig: options.eventsConfig,
			onRetry: options.onRetry,
		},
	)
	const list = response.Payments ?? []
	for (const payment of list) {
		assertValidPaymentResponse(payment)
	}
	return list
}

/** Reconcile bank transactions using AccountCode or InvoiceID. */
export async function runReconcile(
	ctx: OutputContext,
	options: ReconcileCommand,
): Promise<ExitCode> {
	let lockAcquired = false
	let interrupted = false
	const progress = new ProgressDisplay(ctx.progressMode)
	const handleSigint = () => {
		interrupted = true
	}
	process.once('SIGINT', handleSigint)
	try {
		loadEnvConfig()
		if (options.execute) {
			await acquireLock()
			lockAcquired = true
			await pruneAudits()
		}
		const tokens = await loadValidTokens()
		const config = await loadXeroConfig()
		if (!config) {
			writeError(
				ctx,
				'Missing tenant config. Run: bun run xero-cli auth',
				'E_UNAUTHORIZED',
				'XeroAuthError',
			)
			return EXIT_UNAUTHORIZED
		}

		let inputs: ReconcileInputBase[] = []
		if (options.fromCsv) {
			if (!existsSync(options.fromCsv)) {
				writeError(ctx, 'CSV file not found', 'E_USAGE', 'UsageError')
				return EXIT_USAGE
			}
			inputs = await loadCsv(options.fromCsv)
		} else {
			const raw = await readStdinWithLimit()
			inputs = parseJsonInput(raw)
		}

		const auditPath = options.execute
			? path.join(
					await ensureAuditDir(),
					`${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`,
				)
			: null
		if (auditPath) {
			await createAuditFile(auditPath)
		}

		const retryHandler = (info: RetryInfo) => {
			if (ctx.json || ctx.quiet) return
			if (info.reason === 'rate-limit') {
				const seconds = Math.max(1, Math.round(info.backoffMs / 1000))
				progress.pause(`${seconds}s`)
			}
		}

		const unreconciledSnapshot = await fetchUnreconciledSnapshot(
			tokens.accessToken,
			config.tenantId,
			{ eventsConfig: ctx.eventsConfig, onRetry: retryHandler },
		)
		const unreconciledSet = new Set(unreconciledSnapshot.keys())
		const accountCodes = await fetchAccounts(
			tokens.accessToken,
			config.tenantId,
			{ eventsConfig: ctx.eventsConfig, onRetry: retryHandler },
		)

		const invalidIds = inputs
			.filter((input) => !unreconciledSet.has(input.BankTransactionID))
			.map((input) => input.BankTransactionID)
		if (invalidIds.length > 0) {
			throw new Error(
				`Input contains reconciled/missing IDs: ${invalidIds.join(', ')}`,
			)
		}

		const invalidCodes = inputs
			.filter(
				(input) => input.AccountCode && !accountCodes.has(input.AccountCode),
			)
			.map((input) => input.AccountCode)
			.filter(Boolean)
		if (invalidCodes.length > 0) {
			throw new Error(`Invalid AccountCode(s): ${invalidCodes.join(', ')}`)
		}

		const invoiceIds = inputs
			.filter((input) => input.InvoiceID)
			.map((input) => input.InvoiceID) as string[]
		const invoicesById =
			invoiceIds.length > 0
				? await fetchInvoices(tokens.accessToken, config.tenantId, invoiceIds, {
						eventsConfig: ctx.eventsConfig,
						onRetry: retryHandler,
					})
				: new Map()

		const state = await loadState()
		const results: ReconcileResult[] = []
		let currentState = state
		let processedCount = 0
		const totalCount = inputs.length

		const reportResult = (result: ReconcileResult): void => {
			if (ctx.json || ctx.quiet) return
			let prefix = 'SKIP'
			if (result.status === 'reconciled') prefix = 'OK'
			if (result.status === 'failed') prefix = 'ERR'
			if (result.status === 'dry-run') prefix = 'DRY'
			const detail = result.AccountCode
				? `AccountCode ${result.AccountCode}`
				: result.InvoiceID
					? `Invoice ${result.InvoiceID}`
					: 'No detail'
			const message = result.error ? ` - ${result.error}` : ''
			process.stdout.write(
				`${prefix} ${result.BankTransactionID} (${detail}) ${result.status}${message}\n`,
			)
		}

		for (const input of inputs) {
			if (isProcessed(currentState, input.BankTransactionID)) {
				const result: ReconcileResult = {
					BankTransactionID: input.BankTransactionID,
					status: 'skipped',
					AccountCode: input.AccountCode,
					InvoiceID: input.InvoiceID,
				}
				results.push(result)
				processedCount += 1
				reportResult(result)
				progress.update(processedCount, totalCount)
				if (interrupted) break
				continue
			}

			if (!options.execute) {
				const result: ReconcileResult = {
					BankTransactionID: input.BankTransactionID,
					status: 'dry-run',
					AccountCode: input.AccountCode,
					InvoiceID: input.InvoiceID,
				}
				results.push(result)
				processedCount += 1
				reportResult(result)
				progress.update(processedCount, totalCount)
				if (interrupted) break
				continue
			}

			try {
				if (input.AccountCode) {
					const pre = await fetchBankTransaction(
						tokens.accessToken,
						config.tenantId,
						input.BankTransactionID,
						{ eventsConfig: ctx.eventsConfig, onRetry: retryHandler },
					)
					const existing = pre.LineItems ?? []
					const hasSplit =
						existing.length > 1 &&
						new Set(existing.map((item) => item.AccountCode)).size > 1
					if (hasSplit) {
						throw new Error('BankTransaction has split line items')
					}
					const lineItems =
						existing.length === 0
							? [
									{
										Description: 'Auto-reconciled via xero-cli',
										Quantity: 1,
										UnitAmount: pre.Total ?? 0,
										LineAmount: pre.Total ?? 0,
										TaxType: 'INPUT',
										AccountCode: input.AccountCode,
									},
								]
							: existing.map((item) => ({
									...item,
									AccountCode: input.AccountCode,
								}))

					await updateBankTransaction(
						tokens.accessToken,
						config.tenantId,
						input.BankTransactionID,
						lineItems,
						pre.Total,
						{ eventsConfig: ctx.eventsConfig, onRetry: retryHandler },
					)

					const result: ReconcileResult = {
						BankTransactionID: input.BankTransactionID,
						status: 'reconciled',
						AccountCode: input.AccountCode,
					}
					results.push(result)
					currentState = markProcessed(currentState, input.BankTransactionID)
					await saveState(currentState)
					if (auditPath) {
						await writeAuditLine(auditPath, {
							type: 'account-code',
							BankTransactionID: input.BankTransactionID,
							AccountCode: input.AccountCode,
							status: 'reconciled',
						})
					}
					processedCount += 1
					reportResult(result)
					progress.update(processedCount, totalCount)
				}

				if (input.InvoiceID) {
					if (!input.Amount || !input.CurrencyCode) {
						throw new Error('Invoice payments require Amount and CurrencyCode')
					}
					const invoice = invoicesById.get(input.InvoiceID)
					if (!invoice) {
						throw new Error(`Invoice not found: ${input.InvoiceID}`)
					}
					if (invoice.Status !== 'AUTHORISED') {
						throw new Error(`Invoice not AUTHORISED: ${input.InvoiceID}`)
					}
					if (invoice.CurrencyCode !== input.CurrencyCode) {
						throw new Error(`Invoice currency mismatch: ${input.InvoiceID}`)
					}
					if (invoice.AmountDue < input.Amount) {
						throw new Error(
							`Invoice amount due less than input: ${input.InvoiceID}`,
						)
					}
					const bankTxn = await fetchBankTransaction(
						tokens.accessToken,
						config.tenantId,
						input.BankTransactionID,
						{ eventsConfig: ctx.eventsConfig, onRetry: retryHandler },
					)
					const bankAccountId = bankTxn.BankAccount?.AccountID
					if (!bankAccountId) {
						throw new Error('Missing BankAccount.AccountID for payment')
					}
					const payments = await createPayments(
						tokens.accessToken,
						config.tenantId,
						[
							{
								Invoice: { InvoiceID: input.InvoiceID },
								Account: { AccountID: bankAccountId },
								Amount: input.Amount,
								Date: bankTxn.DateString,
							},
						],
						{ eventsConfig: ctx.eventsConfig, onRetry: retryHandler },
					)
					const payment = payments[0]
					if (!payment?.PaymentID) {
						throw new Error('Payment creation failed')
					}
					const result: ReconcileResult = {
						BankTransactionID: input.BankTransactionID,
						status: 'reconciled',
						InvoiceID: input.InvoiceID,
						PaymentID: payment.PaymentID,
					}
					results.push(result)
					currentState = markProcessed(currentState, input.BankTransactionID)
					await saveState(currentState)
					if (auditPath) {
						await writeAuditLine(auditPath, {
							type: 'invoice-payment',
							BankTransactionID: input.BankTransactionID,
							InvoiceID: input.InvoiceID,
							PaymentID: payment.PaymentID,
							status: 'reconciled',
						})
					}
					processedCount += 1
					reportResult(result)
					progress.update(processedCount, totalCount)
				}
			} catch (err) {
				if (err instanceof XeroConflictError && err.code === 'E_CONFLICT') {
					const result: ReconcileResult = {
						BankTransactionID: input.BankTransactionID,
						status: 'skipped',
						AccountCode: input.AccountCode,
						InvoiceID: input.InvoiceID,
						error: err.message,
					}
					results.push(result)
					if (auditPath) {
						await writeAuditLine(auditPath, {
							type: 'skipped',
							BankTransactionID: input.BankTransactionID,
							error: err.message,
						})
					}
					processedCount += 1
					reportResult(result)
					progress.update(processedCount, totalCount)
				} else {
					const message = err instanceof Error ? err.message : String(err)
					const result: ReconcileResult = {
						BankTransactionID: input.BankTransactionID,
						status: 'failed',
						AccountCode: input.AccountCode,
						InvoiceID: input.InvoiceID,
						error: message,
					}
					results.push(result)
					if (auditPath) {
						await writeAuditLine(auditPath, {
							type: 'failure',
							BankTransactionID: input.BankTransactionID,
							error: message,
						})
					}
					processedCount += 1
					reportResult(result)
					progress.update(processedCount, totalCount)
				}
			}
			if (interrupted) break
		}

		progress.finish()

		const summary = {
			total: results.length,
			succeeded: results.filter((r) => r.status === 'reconciled').length,
			failed: results.filter((r) => r.status === 'failed').length,
			skipped: results.filter((r) => r.status === 'skipped').length,
			dryRun: results.filter((r) => r.status === 'dry-run').length,
		}

		const byAccount = new Map<string, { count: number; total: number }>()
		const byType = new Map<string, { count: number; total: number }>()
		for (const result of results) {
			if (result.status !== 'reconciled') continue
			const snapshot = unreconciledSnapshot.get(result.BankTransactionID)
			const amount = snapshot?.Total ?? 0
			const type = snapshot?.Type ?? 'UNKNOWN'
			if (result.AccountCode) {
				const current = byAccount.get(result.AccountCode) ?? {
					count: 0,
					total: 0,
				}
				current.count += 1
				current.total += amount
				byAccount.set(result.AccountCode, current)
			}
			const typeCurrent = byType.get(type) ?? { count: 0, total: 0 }
			typeCurrent.count += 1
			typeCurrent.total += amount
			byType.set(type, typeCurrent)
		}

		const digestLines: string[] = []
		if (!ctx.json && !ctx.quiet && results.length > 0) {
			digestLines.push('Audit digest:')
			for (const [code, info] of byAccount.entries()) {
				digestLines.push(
					`  Account ${code}: ${info.count} (${info.total.toFixed(2)})`,
				)
			}
			for (const [type, info] of byType.entries()) {
				digestLines.push(
					`  Type ${type}: ${info.count} (${info.total.toFixed(2)})`,
				)
			}
		}

		writeSuccess(
			ctx,
			{ command: 'reconcile', summary, results },
			[
				`Reconcile ${options.execute ? 'execute' : 'dry-run'} complete`,
				`Succeeded: ${summary.succeeded}`,
				`Failed: ${summary.failed}`,
				...digestLines,
			],
			`${summary.succeeded}`,
		)
		emitEvent(ctx.eventsConfig, 'xero-reconcile-completed', {
			executed: options.execute,
			summary,
			interrupted,
		})
		if (interrupted) return EXIT_INTERRUPTED
		return EXIT_OK
	} catch (err) {
		if (err instanceof XeroAuthError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
			return EXIT_UNAUTHORIZED
		}
		if (err instanceof XeroConflictError || err instanceof XeroApiError) {
			writeError(ctx, err.message, err.code, err.name, err.context)
			return EXIT_RUNTIME
		}
		writeError(
			ctx,
			err instanceof Error ? err.message : String(err),
			'E_RUNTIME',
			'RuntimeError',
		)
		return EXIT_RUNTIME
	} finally {
		process.off('SIGINT', handleSigint)
		if (lockAcquired) {
			await releaseLock()
		}
	}
}
