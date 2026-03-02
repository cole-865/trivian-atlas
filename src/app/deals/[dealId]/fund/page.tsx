"use client";

import { useParams } from "next/navigation";
import { DealStepNav } from "@/components/DealStepNav";

function asString(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value[0] : value;
}

export default function DealFundPage() {
  const params = useParams();
  const dealId = asString(params?.dealId);

  if (!dealId) {
    return (
      <div style={{ padding: 16, color: "crimson" }}>
        Missing dealId in route params. (Check folder name:{" "}
        <code>deals/[dealId]/fund</code>)
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <DealStepNav dealId={dealId} />

      <h2 style={{ marginTop: 14 }}>Step 6: Fund</h2>

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800 }}>UI stub</div>
        <div style={{ opacity: 0.75, marginTop: 6 }}>
          Later: show decision, stips, printable callback sheet, and status
          updates.
        </div>
      </div>
    </div>
  );
}