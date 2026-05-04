import { parse } from "csv-parse/sync";
import type { DmsCsvRow } from "./reportTypes";

export type ParsedDmsCsv = {
  headers: string[];
  rows: DmsCsvRow[];
};

export function parseDmsCsv(csvContent: string): ParsedDmsCsv {
  const records = parse(csvContent, {
    bom: true,
    columns: false,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false,
  }) as string[][];

  if (!records.length) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((header) => String(header ?? "").trim());
  const rows = records.slice(1).map((record) => {
    const row: DmsCsvRow = {};
    headers.forEach((header, index) => {
      row[header] = String(record[index] ?? "");
    });
    return row;
  });

  return { headers, rows };
}
