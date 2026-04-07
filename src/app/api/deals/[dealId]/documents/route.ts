import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { canAccessStep } from "@/lib/deals/canAccessStep";
import {
  assertDealInCurrentOrganization,
  getDealForCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";
import { scopeQueryToOrganization } from "@/lib/deals/childOrganizationScope";

const ALLOWED_TYPES = new Set([
  "credit_bureau",
  "proof_of_income",
  "proof_of_residence",
  "driver_license",
  "insurance",
  "references",
  "other",
]);

const BUCKET_DEAL_DOCS = "deal-docs";
const BUCKET_CREDIT_BUREAU_RAW = "credit_reports_raw";

type DealDocumentRow = {
  id: string;
  deal_id: string;
  doc_type: string;
  storage_bucket: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

const GENERAL_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function isPdf(file: File) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  return name.endsWith(".pdf") || type === "application/pdf";
}

function isAllowedGeneralFile(file: File) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  return (
    GENERAL_ALLOWED_MIME_TYPES.has(type) ||
    name.endsWith(".pdf") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

function safeDocType(v: unknown): string | null {
  const s = String(v ?? "").toLowerCase();
  return ALLOWED_TYPES.has(s) ? s : null;
}

function safeFileName(name: string) {
  return (name || "upload")
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
  const scopedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!scopedDeal.organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (scopedDeal.error) {
    return NextResponse.json(
      { error: "Failed to load deal", details: scopedDeal.error.message },
      { status: 500 }
    );
  }

  if (!scopedDeal.data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const { data, error } = await scopeQueryToOrganization(
    supabase
      .from("deal_documents")
      .select(
        "id, deal_id, doc_type, storage_bucket, storage_path, original_name, mime_type, size_bytes, created_at"
      ),
    scopedDeal.organizationId
  )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load documents", details: error.message },
      { status: 500 }
    );
  }

  const latest: Record<string, DealDocumentRow | null | undefined> = {};
  const grouped: Record<string, DealDocumentRow[]> = {};

  for (const row of (data ?? []) as DealDocumentRow[]) {
    if (!latest[row.doc_type]) latest[row.doc_type] = row;
    if (!grouped[row.doc_type]) grouped[row.doc_type] = [];
    grouped[row.doc_type].push(row);
  }

  return NextResponse.json({
    ok: true,
    documents: {
      credit_bureau: latest["credit_bureau"] ?? null,
      proof_of_income: grouped["proof_of_income"] ?? [],
      proof_of_residence: grouped["proof_of_residence"] ?? [],
      driver_license: grouped["driver_license"] ?? [],
      insurance: grouped["insurance"] ?? [],
      references: grouped["references"] ?? [],
      other: grouped["other"] ?? [],
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = await supabaseServer();
  const authorizedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!authorizedDeal.organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (authorizedDeal.error) {
    return NextResponse.json(
      { error: "Failed to load deal", details: authorizedDeal.error.message },
      { status: 500 }
    );
  }

  if (!authorizedDeal.data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

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

  if (docType === "credit_bureau") {
    if (!isPdf(file)) {
      return NextResponse.json(
        { error: "Credit bureau upload must be a PDF" },
        { status: 400 }
      );
    }
  } else {
    if (!isAllowedGeneralFile(file)) {
      return NextResponse.json(
        {
          error:
            "Allowed file types: PDF, JPG, JPEG, PNG, WEBP, HEIC, HEIF",
        },
        { status: 400 }
      );
    }
  }

  const userRes = await supabase.auth.getUser();
  const uploadedBy = userRes.data.user?.id ?? null;

  if (!uploadedBy) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (docType !== "credit_bureau") {
    const { data: deal, error: dealErr } = await getDealForCurrentOrganization<{
      submit_status: string | null;
      submitted_at: string | null;
    }>(supabase, dealId, "submit_status, submitted_at");

    if (dealErr) {
      return NextResponse.json(
        { error: "Failed to load deal", details: dealErr.message },
        { status: 500 }
      );
    }

    const { data: structure, error: structureErr } = await scopeQueryToOrganization(
      supabase.from("deal_structure").select("vehicle_id"),
      authorizedDeal.organizationId
    )
      .eq("deal_id", dealId)
      .maybeSingle();

    if (structureErr) {
      return NextResponse.json(
        { error: "Failed to load deal structure", details: structureErr.message },
        { status: 500 }
      );
    }

    const access = await canAccessStep({
      supabase,
      step: "submit",
      deal: {
        selected_vehicle_id: structure?.vehicle_id ?? null,
        submit_status: deal?.submit_status ?? null,
        submitted_at: deal?.submitted_at ?? null,
      },
    });

    if (!access.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "STEP_BLOCKED",
          redirectTo: access.redirectTo ?? "vehicle",
          reason: access.reason,
        },
        { status: 403 }
      );
    }
  }

  const ts = Date.now();
  const safeName = safeFileName(file.name);

  const bucket =
    docType === "credit_bureau"
      ? BUCKET_CREDIT_BUREAU_RAW
      : BUCKET_DEAL_DOCS;

  const storagePath =
    docType === "credit_bureau"
      ? `deal/${dealId}/bureau/${ts}_${safeName}`
      : `deals/${dealId}/${docType}/${ts}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (upErr) {
    return NextResponse.json(
      { error: "Storage upload failed", details: upErr.message },
      { status: 500 }
    );
  }

  const { data: docRow, error: insErr } = await supabase
    .from("deal_documents")
    .insert({
      organization_id: authorizedDeal.organizationId,
      deal_id: dealId,
      doc_type: docType,
      storage_bucket: bucket,
      storage_path: storagePath,
      original_name: file.name ?? null,
      mime_type: file.type || null,
      size_bytes: file.size ?? null,
      uploaded_by: uploadedBy,
    })
    .select(
      "id, deal_id, doc_type, storage_bucket, storage_path, original_name, mime_type, size_bytes, created_at"
    )
    .single();

  if (insErr) {
    await supabase.storage.from(bucket).remove([storagePath]);

    return NextResponse.json(
      { error: "Failed to save document record", details: insErr.message },
      { status: 500 }
    );
  }

  if (docType === "credit_bureau") {
    await supabase.from("credit_reports").delete().eq("deal_id", dealId);

    await supabase
      .from("credit_report_jobs")
      .update({ status: "failed", error_message: "Superseded by newer upload" })
      .eq("deal_id", dealId)
      .in("status", ["queued", "uploaded", "parsing", "redacting", "scoring"]);

    const { error: jobErr } = await supabase.from("credit_report_jobs").insert({
      deal_id: dealId,
      uploaded_by: uploadedBy,
      bureau: "unknown",
      raw_bucket: BUCKET_CREDIT_BUREAU_RAW,
      raw_path: storagePath,
      status: "queued",
    });

    if (jobErr) {
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
