"use client";

import { useEffect, useState } from "react";
import { categories, isEligible, reviewStatuses, type CallRecord, type coachingTrends } from "@/lib/ask865/calls/domain";
import type { AuditEntry } from "@/lib/ask865/calls/store";
import { Button } from "@/components/ui/button";
import { NoticeBanner, PageHeader, SectionCard } from "@/components/atlas/page";

type InboxData = { employeeNames: Record<string, string>; calls: CallRecord[]; total: number; trends: ReturnType<typeof coachingTrends>; trendsLimited: boolean; ingestionEnabled: boolean;
  playbackEnabled: boolean; recordings: { queued: number; running: number; failed: number; availableProviderCallIds: string[] } };
const label = (value: string) => value.replaceAll("_", " ");
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function Review({ call, organizationId, saved, recordingAvailable }: { call: CallRecord; organizationId: string; saved: () => void; recordingAvailable: boolean }) {
  const [category, setCategory] = useState(call.category);
  const [score, setScore] = useState(call.score === null ? "" : String(call.score));
  const [status, setStatus] = useState(call.status === "not_required" ? "in_review" : call.status);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const url = `/api/ask865/calls/${call.id}?organization=${encodeURIComponent(organizationId)}`;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expectedRevision: call.revision, category, score: score === "" ? null : Number(score), status, reason,
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Save failed.");
      saved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed."); }
    finally { setBusy(false); }
  }
  async function history() {
    setMessage("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "History unavailable.");
      setAudit(result.audit);
    } catch (error) { setMessage(error instanceof Error ? error.message : "History unavailable."); }
  }
  return <div className="grid gap-4 border-t pt-4">
    <p className="text-sm">Original AI result: {label(call.ai_category)} · {call.ai_score === null ? "Unscored" : `${call.ai_score}/100`} · Rubric {call.evaluation.rubricVersion}</p>
    {call.evaluation.assessment && <>
      <p>{call.evaluation.assessment.summary}</p>
      <p className="text-sm text-muted-foreground">Classification confidence {Math.round(call.evaluation.assessment.classificationConfidence * 100)}% · Grading confidence {Math.round(call.evaluation.assessment.gradingConfidence * 100)}%</p>
      <ul className="grid gap-2 text-sm">{call.evaluation.assessment.criticalFlags.map((flag, i) => <li key={i} className="font-medium text-destructive">Potential {label(flag.code)} at {flag.atSeconds}s: {flag.reason}</li>)}</ul>
      <ul className="grid gap-2 text-sm">{call.evaluation.assessment.criteria.map(item => <li key={item.criterion}><strong className="capitalize">{label(item.criterion)}</strong>: {item.rating === null ? "Not applicable" : `${item.rating}/4`}{item.atSeconds === null ? "" : ` at ${item.atSeconds}s`} — {item.reason}</li>)}</ul>
    </>}
    {recordingAvailable && isEligible(call.category)
      ? <audio controls preload="none" src={`/api/ask865/calls/${call.id}/recording?organization=${encodeURIComponent(organizationId)}`} aria-label="Private call recording" />
      : <p className="text-sm text-muted-foreground">An archived recording is not available for playback here. Verify timestamps in the approved recording source.</p>}
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <label className="grid gap-1 text-sm">Classification<select className={field} value={category} disabled={busy} onChange={e => { setCategory(e.target.value as CallRecord["category"]); setScore(""); }}>
        {categories.map(c => <option key={c} value={c}>{label(c)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm">Manager score (optional)<input className={field} type="number" min="0" max="100" step="1" value={score} disabled={busy || !isEligible(category) || call.evaluation.state === "not_evaluable"} onChange={e => setScore(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">Review status<select className={field} value={status} disabled={busy} onChange={e => setStatus(e.target.value as typeof status)}>{reviewStatuses.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
      <label className="grid gap-1 text-sm sm:col-span-3">Reason for change<textarea className={field} minLength={5} maxLength={1000} required value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="Explain the correction or coaching decision. Omit customer personal details." /></label>
      <div className="flex flex-wrap gap-2 sm:col-span-3"><Button disabled={busy}>{busy ? "Saving…" : "Save review"}</Button><Button type="button" variant="outline" onClick={history}>View audit history</Button></div>
    </form>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    {audit && <div className="grid gap-3 text-sm"><h4 className="font-semibold">Latest 100 changes</h4>{!audit.length && <p>No manager changes yet.</p>}{audit.map(entry => <div key={entry.id} className="rounded border p-3"><p>{new Date(entry.created_at).toLocaleString()} · Manager {entry.actor_id}</p><p>{entry.reason}</p><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(entry.before_state)} → {JSON.stringify(entry.after_state)}</pre></div>)}</div>}
  </div>;
}

export function CallInbox({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [data, setData] = useState<InboxData | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState("inbox");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ask865/calls?organization=${encodeURIComponent(organizationId)}&page=${page}&view=${view}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Call inbox unavailable."); return result as InboxData; })
      .then(result => { setData(result); setError(""); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Call inbox unavailable."); setLoading(false); setData(null); } });
    return () => controller.abort();
  }, [organizationId, page, view, version]);
  function refresh(saved = false) { setLoading(true); setData(null); setVersion(v => v + 1); if (saved) setNotice("Review saved with an audit entry."); }
  return <div className="grid gap-5">
    <PageHeader eyebrow={`${organizationName} · Ask 865`} title="Call Intelligence" description="Sales and Service · Inbound and outbound" actions={<a className="text-sm underline" href="/ask865">Back to reporting</a>} />
    <NoticeBanner tone="notice">Pilot rubrics require calibration against manager-reviewed calls. Uncertain calls remain unscored. AI flags require human verification.</NoticeBanner>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <NoticeBanner tone="error">{error}</NoticeBanner>}
    {data && !data.ingestionEnabled && <NoticeBanner tone="notice">Live call ingestion is disabled. No live processing is implied by this screen.</NoticeBanner>}
    {data && data.recordings.failed > 0 && <NoticeBanner tone="error">{data.recordings.failed} recording(s) could not be processed and need technical review. These calls are not included in the coaching totals.</NoticeBanner>}
    {data && (data.recordings.queued > 0 || data.recordings.running > 0) && <p role="status" className="text-sm text-muted-foreground">{data.recordings.queued} recordings waiting · {data.recordings.running} processing</p>}
    <SectionCard title="Management review" description="Scores below 70, critical flags, and calls needing verification appear here." actions={<div className="flex gap-2"><Button variant={view === "inbox" ? "default" : "outline"} onClick={() => { setLoading(true); setData(null); setView("inbox"); setPage(0); setVersion(v=>v+1); }}>Needs attention</Button><Button variant={view === "all" ? "default" : "outline"} onClick={() => { setLoading(true); setData(null); setView("all"); setPage(0); setVersion(v=>v+1); }}>All calls</Button><Button variant="outline" onClick={() => refresh()}>Refresh</Button></div>}>
      {loading && <p role="status">Loading call reviews…</p>}
      {data && <div className="grid gap-3">
        {!data.calls.length && <p>{view === "inbox" ? "No calls currently need review." : "No retained calls have been imported."}</p>}
        {data.calls.map(call => <details key={`${call.id}:${call.revision}`} className="rounded-lg border p-4">
          <summary className="cursor-pointer space-y-2"><div className="flex flex-wrap justify-between gap-2"><strong>{(call.employee_id && data.employeeNames?.[call.employee_id]) || call.employee_id || "Unmapped employee"} · {label(call.category)}</strong><strong>{call.score === null ? "Unscored" : `${call.score}/100`}</strong></div><div className="text-sm text-muted-foreground">{new Date(call.started_at).toLocaleString()} · {call.direction} · {label(call.status)}</div><div className="text-sm">{call.evaluation.reasons.map(label).join(" · ") || "No automatic escalation"}{call.revision > 1 ? " · Manager reviewed" : ""}</div></summary>
          <div className="pt-4"><Review call={call} organizationId={organizationId} saved={() => refresh(true)} recordingAvailable={data.playbackEnabled && data.recordings.availableProviderCallIds.includes(call.provider_call_id)} /></div>
        </details>)}
        <div className="flex items-center gap-3"><Button variant="outline" disabled={!page || loading} onClick={() => { setLoading(true); setData(null); setPage(p => p - 1); }}>Previous</Button><span className="text-sm">Page {page + 1} · {data.total} calls</span><Button variant="outline" disabled={(page + 1) * 50 >= data.total || loading} onClick={() => { setLoading(true); setData(null); setPage(p => p + 1); }}>Next</Button></div>
      </div>}
    </SectionCard>
    <SectionCard title="Coaching · past 7 days" description={data?.trendsLimited ? "Limited to the latest 1,000 calls. These are partial trends." : "Scored Sales and Service calls only. Manager corrections are reflected in these totals."}>
      {data && !data.trends.length && <p>No eligible scored calls in this period.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{data?.trends.map(trend => <div key={trend.employee} className="rounded-lg border p-4"><h3 className="font-semibold">{data.employeeNames?.[trend.employee] || trend.employee}</h3><p>{trend.average}/100 average · {trend.count} graded calls</p><p className="text-sm">{trend.below70} below 70 · {trend.opportunities} below 85 · {trend.critical} flagged</p>{trend.below70 > 1 && <p className="text-sm font-medium text-destructive">Repeated low scores — review coaching needs.</p>}</div>)}</div>
    </SectionCard>
  </div>;
}
