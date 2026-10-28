import { z } from "zod";
import type { RecordingDiscovery } from "./ringcentral";
import { MediaError } from "./media";

const schema = z.array(z.object({ extensionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), employeeId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),
  employeeName: z.string().min(1).max(120).optional(), validFrom: z.iso.datetime({ offset: true }), validThrough: z.iso.datetime({ offset: true }),
}).strict()).max(1000);
export function employeeMapper(configuration: string | undefined) {
  let mappings: z.infer<typeof schema>;
  try { mappings = schema.parse(JSON.parse(configuration ?? "[]")); } catch { throw new MediaError("invalid_employee_mapping"); }
  if (mappings.some(m => Date.parse(m.validFrom) >= Date.parse(m.validThrough))) throw new MediaError("invalid_employee_mapping");
  return (call: RecordingDiscovery): string | null => {
    // Stable RingCentral IDs, not reusable display extension numbers or inferred
    // voices. Transfers/multiple matched people require manual attribution.
    if (call.extensionIds.length !== 1) return null;
    const start = Date.parse(call.startedAt), end = start + call.durationSeconds * 1000;
    const matched = mappings.filter(m => m.extensionId === call.extensionIds[0] && Date.parse(m.validFrom) <= start && Date.parse(m.validThrough) >= end);
    return matched.length === 1 ? matched[0].employeeId : null;
  };
}

export function employeeNames(configuration: string | undefined) {
  const entries = schema.parse(JSON.parse(configuration ?? "[]"));
  return Object.fromEntries(entries.filter(m => m.employeeName).map(m => [m.employeeId, m.employeeName!]));
}
