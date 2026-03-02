import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; documentId: string }> }
) {
  const { dealId, documentId } = await params;
  const supabase = await supabaseServer();

  // load doc row (include doc_type)
  const { data: doc, error: loadErr } = await supabase
    .from("deal_documents")
    .select("id, deal_id, doc_type, storage_bucket, storage_path")
    .eq("id", documentId)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { error: "Failed to load document", details: loadErr.message },
      { status: 500 }
    );
  }

  if (!doc?.id) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // If deleting a bureau doc, also delete the long-term record + jobs (+ redacted file if present)
  if (doc.doc_type === "credit_bureau") {
    // remove redacted pdf if your worker created one
    const { data: reportRow } = await supabase
      .from("credit_reports")
      .select("redacted_bucket, redacted_path")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (reportRow?.redacted_bucket && reportRow?.redacted_path) {
      await supabase.storage
        .from(reportRow.redacted_bucket)
        .remove([reportRow.redacted_path]);
    }

    await supabase.from("credit_reports").delete().eq("deal_id", dealId);
    await supabase.from("credit_report_jobs").delete().eq("deal_id", dealId);
  }

  // remove from storage (raw or app doc)
  const { error: rmErr } = await supabase.storage
    .from(doc.storage_bucket)
    .remove([doc.storage_path]);

  if (rmErr) {
    return NextResponse.json(
      { error: "Failed to delete storage object", details: rmErr.message },
      { status: 500 }
    );
  }

  // delete row
  const { error: delErr } = await supabase
    .from("deal_documents")
    .delete()
    .eq("id", documentId)
    .eq("deal_id", dealId);

  if (delErr) {
    return NextResponse.json(
      { error: "Failed to delete document record", details: delErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}