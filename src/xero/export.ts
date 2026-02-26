import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const EXPORT_MODE = 0o600

export interface UncertainTransactionRow {
	readonly BankTransactionID: string
	readonly Date: string
	readonly Amount: number
	readonly Contact: string
	readonly Description: string
	readonly SuggestedAccountCode: string
	readonly Confidence: string
	readonly Notes: string
}

function escapeCsv(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`
	}
	return value
}

/** Export uncertain transactions to CSV for manual review. */
export async function exportUncertainCsv(
	rows: UncertainTransactionRow[],
	outputPath: string,
): Promise<void> {
	const header = [
		'BankTransactionID',
		'Date',
		'Amount',
		'Contact',
		'Description',
		'SuggestedAccountCode',
		'Confidence',
		'Notes',
	]
	const lines = [header.join(',')]
	for (const row of rows) {
		lines.push(
			[
				row.BankTransactionID,
				row.Date,
				row.Amount.toFixed(2),
				escapeCsv(row.Contact),
				escapeCsv(row.Description),
				row.SuggestedAccountCode,
				row.Confidence,
				escapeCsv(row.Notes),
			].join(','),
		)
	}
	await mkdir(path.dirname(outputPath), { recursive: true })
	await writeFile(outputPath, `${lines.join('\n')}\n`, {
		encoding: 'utf8',
		mode: EXPORT_MODE,
	})
}
