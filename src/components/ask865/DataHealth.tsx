"use client";
import { useState } from "react";
import type { ImportHealth, SourceIssue } from "@/lib/ask865/types";
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-US", {timeZone: "America/New_York", timeZoneName: "short"}) : "Not received";
const labels: Record<string,string> = {
  removed_dealercenter_extra_blank_before_vehicle: "Extra blank field in the source file (repaired)",
  repaired_dealercenter_multiline_alert_quotes: "Multiline alert formatting (repaired)",
  invalid_date_value_additional_deferred_due_date: "Invalid additional deferred-down due date",
  right_padded_omitted_trailing_fields: "Missing trailing fields in the source file (repaired)",
};
const words = (value: string) => labels[value] ?? value.replaceAll("_", " ");
function IssueEditor({issue,organizationId,canReview,onSaved}: {issue: SourceIssue; organizationId:string;canReview:boolean; onSaved: () => Promise<void>}) {
  const [owner,setOwner]=useState(issue.owner_name);
  const [notes,setNotes]=useState(issue.notes);
  const [status,setStatus]=useState(issue.review_status);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function save() {
    if(!canReview) return;
    setBusy(true);setMessage("");
    try {
      const response=await fetch(`/api/ask865/source-issues?organization=${encodeURIComponent(organizationId)}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({reportKey:issue.report_key,issueCode:issue.issue_code,owner,notes,status})});
      if(!response.ok) throw new Error("Could not save. Your changes are still here; try again.");
      await onSaved();setMessage("Saved");
    } catch(error) {setMessage(error instanceof Error ? error.message : "Could not save");}
    finally {setBusy(false);}
  }
  return <article className="panel issue-editor">
    <h3>{words(issue.issue_code)}</h3>
    <p>{words(issue.report_key.replace("ask865_",""))} · {issue.resolved_at ? "Resolved in a later import" : `${issue.affected_rows} affected rows`}</p>
    <p>First observed: {date(issue.first_seen_at)} · Last observed: {date(issue.last_seen_at)}</p>
    {!issue.resolved_at && <p>Source row numbers: {issue.source_row_numbers.slice(0,30).join(", ")}{issue.source_row_numbers.length>30 ? "…" : ""}</p>}
    <fieldset disabled={!canReview || busy} className="filter-panel">
      <label>Owner<input value={owner} maxLength={160} onChange={e=>setOwner(e.target.value)} /></label>
      <label>Review status<select value={status} onChange={e=>setStatus(e.target.value as SourceIssue["review_status"])}><option value="open">Open</option><option value="in_review">In review</option></select></label>
      <label>Notes<textarea value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)} /></label>
      <button className="secondary-button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save review"}</button>
    </fieldset>{!canReview && <p>Source reviews are read-only for your account.</p>}<p role="status">{message}</p>
  </article>;
}
export function DataHealth({reports,issues,organizationId,canReview,onSaved}: {reports:ImportHealth[];issues:SourceIssue[];organizationId:string;canReview:boolean;onSaved:()=>Promise<void>}) {
  const problems=reports.filter(r=>!["healthy","warning"].includes(r.health_status));
  return <>
    <section className="panel"><h2>{problems.length ? `${problems.length} reports need attention` : (reports.length ? `All ${reports.length} reports are current` : "No report health data is available")}</h2>
      <p>Daily DealerCenter reports are expected by 3:00 a.m. Eastern, allowing time after the overnight import. Warnings identify source issues or formatting repairs; they are separate from failed imports.</p>
      <p>Checks run when each report finishes loading. Repeated files are checked again; unchanged content does not count as a missing delivery.</p>
      <div className="table-wrap"><table><thead><tr><th>Report</th><th>Status</th><th>Received</th><th>Checked</th><th>Source / stored</th><th>Rejected</th><th>Warnings</th><th>Checks needing attention</th></tr></thead><tbody>{reports.map(r=><tr key={r.report_key}><td>{r.canonical_name.replace("Ask 865 - ","")}</td><td>{words(r.health_status)}</td><td>{date(r.source_received_at)}</td><td>{date(r.checked_at)}</td><td>{r.source_row_count ?? "—"} / {r.stored_rows ?? "—"}</td><td>{r.rejected_row_count ?? "—"}</td><td>{r.warning_count ?? "—"}</td><td>{r.problems?.length ? r.problems.map(words).join(", ") : "—"}</td></tr>)}</tbody></table></div>
    </section>
    <section><h2>Source issue register</h2><p>Assign an owner and record follow-up. Issues resolve automatically when absent from a later successful source import; editing a note does not correct the source data.</p>
      {issues.length ? issues.map(issue=><IssueEditor key={`${issue.report_key}:${issue.issue_code}`} issue={issue} organizationId={organizationId} canReview={canReview} onSaved={onSaved}/>) : <p>No tracked source issues.</p>}
    </section>
  </>;
}
