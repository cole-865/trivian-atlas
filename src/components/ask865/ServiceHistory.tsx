"use client";

import { useState } from "react";
import type { ServiceMonth } from "@/lib/ask865/types";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const monthName = (month: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
const amountKeys = ["salesBeforeTax", "tax", "salesWithTax", "labor", "partsAndTires", "sublets", "fees"] as const;

function totals(rows: ServiceMonth[]) {
  // Sum cents so the displayed component totals reconcile to the source export.
  const amounts = Object.fromEntries(amountKeys.map((key) => [key, rows.reduce((sum, row) => sum + Math.round(row[key] * 100), 0) / 100])) as Record<typeof amountKeys[number], number>;
  return { ...amounts, closedOrders: rows.reduce((sum, row) => sum + row.closedOrders, 0) };
}

export function ServiceHistory({ rows,canExport,onRefresh }: {rows:ServiceMonth[]|null;canExport:boolean;onRefresh:()=>Promise<void>}) {
  const [month,setMonth]=useState("");
  const filtered = (rows ?? []).filter((row) => !month || row.month === month);
  const groups = ["865 Autos", "Other customers", ...Array.from(new Set((rows ?? []).map((row) => row.billingGroup))).filter((group) => !["865 Autos", "Other customers"].includes(group))];

  function exportCsv() {
    if(!canExport) return;
    const columns: Array<[keyof ServiceMonth, string]> = [["month", "Closed month"], ["billingGroup", "Billed customer group"], ["closedOrders", "Closed invoices"], ["salesBeforeTax", "Sales before tax"], ["tax", "Tax"], ["salesWithTax", "Total with tax"], ["labor", "Labor after discount"], ["partsAndTires", "Parts and tires after discount"], ["sublets", "Sublets"], ["fees", "Hazmat and shop supplies"]];
    const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = [columns.map(([, label]) => escape(label)).join(","), ...filtered.map((row) => columns.map(([key]) => escape(row[key])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `ask865-shopware-${month || "2026-imported-history"}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <section className="service-history">
    <article className="panel service-coverage">
      <div className="panel-heading"><div><p className="eyebrow">Shop-Ware · 2026 history</p><h2>Closed invoices by billed customer</h2></div><span className="source-pill waiting">Tekmetric approval pending</span></div>
      <p className="definition">Imported report: January 1–September 15, 2026. Actual invoice close dates: January 8–September 11. September is partial. This is a saved historical import.</p>
      <p className="definition">Closed invoices can be paid, unpaid, partially paid, or credited. These amounts are billed sales, not cash collected. Tekmetric invoices are not included; transition overlap remains under review.</p>
    </article>
    <div className="service-toolbar">
      <label>Closed month<select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">All imported 2026 months</option>{Array.from(new Set((rows ?? []).map((row) => row.month))).map((value) => <option key={value} value={value}>{monthName(value)}{value === "2026-09" ? " (partial)" : ""}</option>)}</select></label>
      <div className="table-actions"><button className="secondary-button" disabled={!rows || !canExport} onClick={exportCsv}>Export monthly CSV</button><button className="secondary-button" onClick={onRefresh}>Refresh</button></div>
    </div>
    {!rows && <p className="empty" role="status">Loading service history…</p>}
    {rows && !rows.length && <p className="empty">No imported Shop-Ware invoices are available.</p>}
    {rows && rows.length > 0 && <>
      <section className="grid two-column">{groups.map((group) => {
        const groupRows = filtered.filter((row) => row.billingGroup === group);
        const total = totals(groupRows);
        return <article className="panel service-group" key={group}>
          <p className="eyebrow">{group === "865 Autos" ? "Billed to the dealership" : group === "Other customers" ? "Billed to other customers" : "Customer classification needs review"}</p>
          <h2>{group}</h2><div className="service-total">{money.format(total.salesBeforeTax)}</div><p className="definition">Sales before tax · {total.closedOrders} closed invoices</p>
          <dl className="service-breakdown"><div><dt>Average invoice before tax</dt><dd>{total.closedOrders ? money.format(total.salesBeforeTax / total.closedOrders) : "—"}</dd></div><div><dt>Labor after discount</dt><dd>{money.format(total.labor)}</dd></div><div><dt>Parts and tires after discount</dt><dd>{money.format(total.partsAndTires)}</dd></div><div><dt>Sublets</dt><dd>{money.format(total.sublets)}</dd></div><div><dt>Hazmat and shop supplies</dt><dd>{money.format(total.fees)}</dd></div><div><dt>Tax</dt><dd>{money.format(total.tax)}</dd></div><div><dt>Total with tax</dt><dd>{money.format(total.salesWithTax)}</dd></div></dl>
        </article>;
      })}</section>
      <article className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Monthly detail</p><h2>{month ? monthName(month) : "2026 imported months"}</h2></div><span>{filtered.length} monthly group rows</span></div>
        <div className="table-wrap"><table><caption className="visually-hidden">Shop-Ware closed invoices separated by month and billed customer group</caption><thead><tr><th>Closed month</th><th>Billed customer</th><th>Invoices</th><th>Sales before tax</th><th>Tax</th><th>Total with tax</th></tr></thead><tbody>{filtered.map((row) => <tr key={`${row.month}-${row.billingGroup}`}><td>{monthName(row.month)}{row.month === "2026-09" ? " (partial)" : ""}</td><td>{row.billingGroup}</td><td>{row.closedOrders}</td><td>{money.format(row.salesBeforeTax)}</td><td>{money.format(row.tax)}</td><td>{money.format(row.salesWithTax)}</td></tr>)}</tbody></table></div>
      </article>
    </>}
    <article className="panel service-coverage"><h2>What comes next</h2><p className="definition">Live workload and service updates will follow Tekmetric API approval. Gross profit requires labor-cost detail; advisor and technician production need further validation. The current export cannot support those measures yet.</p></article>
  </section>;
}
