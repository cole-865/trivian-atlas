import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const ALLOWED_TYPES = new Set(["credit_app", "credit_bureau"]);

const BUCKET_CREDIT_APP = "deal-docs";
const BUCKET_CREDIT_BUREAU_RAW = "credit_reports_raw";

function isPdf(file: File) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  return name.endsWith(".pdf") || type === "application/pdf";
}

function safeDocType(v: any): "credit_app" | "credit_bureau" | null {
  const s = String(v ?? "").toLowerCase();
  return ALLOWED_TYPES.has(s) ? (s as any) : null;
}

function safeFileName(name: string) {
  return (name || "upload.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .toLowerCase()
    .slice(0, 120);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("deal_documents")
    .select(
      "id, deal_id, doc_type, storage_bucket, storage_path, original_name, mime_type, size_bytes, created_at"
    )
    .eq("deal_id", dealId)
    .in("doc_type", ["credit_app", "credit_bureau"])
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load documents", details: error.message },
      { status: 500 }
    );
  }

  const latest: Record<string, any> = {};
  for (const row of data ?? []) {
    if (!latest[row.doc_type]) latest[row.doc_type] = row;
  }

  return NextResponse.json({
    ok: true,
    documents: {
      credit_app: latest["credit_app"] ?? null,
      credit_bureau: latest["credit_bureau"] ?? null,
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const docType = safeDocType(form.get("doc_type"));
  if (!docType) {
    return NextResponse.json({ error: "Invalid doc_type" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  if (!isPdf(file)) {
    return NextResponse.json({ error: "PDF only" }, { status: 400 });
  }

  const userRes = await supabase.auth.getUser();
  console.log("UPLOAD USER:", userRes.data.user?.id);
  const uploadedBy = userRes.data.user?.id ?? null;
  if (!uploadedBy) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const ts = Date.now();
  const safeName = safeFileName(file.name);

  // Choose bucket + path based on doc type
  const bucket =
    docType === "credit_bureau" ? BUCKET_CREDIT_BUREAU_RAW : BUCKET_CREDIT_APP;

  const storagePath =
    docType === "credit_bureau"
      ? `deal/${dealId}/bureau/${ts}_${safeName}`
      : `deals/${dealId}/${docType}/${ts}-${safeName}`;

  // Upload to Storage
  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, arrayBuffer, {
    contentType: "application/pdf",
    upsert: false, // don't overwrite silently
  });

  if (upErr) {
    return NextResponse.json(
      { error: "Storage upload failed", details: upErr.message },
      { status: 500 }
    );
  }

  // Track in deal_documents (UI uses this)
  const { data: docRow, error: insErr } = await supabase
    .from("deal_documents")
    .insert({
      deal_id: dealId,
      doc_type: docType,
      storage_bucket: bucket,
      storage_path: storagePath,
      original_name: file.name ?? null,
      mime_type: "application/pdf",
      size_bytes: file.size ?? null,
      uploaded_by: uploadedBy,
    })
    .select(
      "id, deal_id, doc_type, storage_bucket, storage_path, original_name, mime_type, size_bytes, created_at"
    )
    .single();

  if (insErr) {
    // avoid orphan file
    await supabase.storage.from(bucket).remove([storagePath]);
    return NextResponse.json(
      { error: "Failed to save document record", details: insErr.message },
      { status: 500 }
    );
  }

  // If credit bureau: create processing job + clean long-term tables
  if (docType === "credit_bureau") {
    // Clean “official” record (we only want the latest bureau to be the truth)
    await supabase.from("credit_reports").delete().eq("deal_id", dealId);

    // Mark any in-progress jobs as superseded (optional but recommended)
    await supabase
      .from("credit_report_jobs")
      .update({ status: "failed", error_message: "Superseded by newer upload" })
      .eq("deal_id", dealId)
      .in("status", ["queued", "uploaded", "parsing", "redacting", "scoring"]);

    // Insert new job that the worker will pick up
    const { error: jobErr } = await supabase.from("credit_report_jobs").insert({
      deal_id: dealId,
      uploaded_by: uploadedBy,
      bureau: "unknown",
      raw_bucket: BUCKET_CREDIT_BUREAU_RAW,
      raw_path: storagePath,
      status: "queued",
    });

    if (jobErr) {
      // rollback-ish: remove file + doc row to keep system consistent
      await supabase.storage.from(bucket).remove([storagePath]);
      await supabase.from("deal_documents").delete().eq("id", docRow.id);

      return NextResponse.json(
        { error: "Failed to queue processing job", details: jobErr.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, document: docRow });
}