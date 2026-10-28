import { MediaError } from "./media";
export type DiscoveryWindow = { dateFrom: string; dateTo: string };
export function discoveryPlan(cursorAt: string, approvedFrom: string, approvedThrough: string, now = Date.now()) {
  const cursor = Date.parse(cursorAt), from = Date.parse(approvedFrom), through = Date.parse(approvedThrough);
  const end = Math.min(now - 5 * 60000, through);
  if (![cursor,from,through,now].every(Number.isFinite) || from >= through || cursor < from || cursor > now) throw new MediaError("invalid_discovery_policy");
  if (end <= cursor) return { windows: [] as DiscoveryWindow[], nextCursor: cursorAt };
  const advance = Math.min(cursor + 6 * 3600000, end);
  const windows = [{ dateFrom: new Date(Math.max(from,cursor - 3600000)).toISOString(), dateTo: new Date(advance).toISOString() }];
  // Always revisit the latest day for delayed recording publication, even while catching up.
  const recentFrom = Math.max(from,end - 24 * 3600000);
  if (recentFrom < windows.map(w => Date.parse(w.dateFrom))[0] || end > advance) windows.push({ dateFrom: new Date(recentFrom).toISOString(), dateTo: new Date(end).toISOString() });
  return { windows, nextCursor: new Date(advance).toISOString() };
}
export async function discoverWithCheckpoint(plan: ReturnType<typeof discoveryPlan>, discover: (window: DiscoveryWindow) => Promise<void>, finish: (cursor: string) => Promise<void>) {
  // Enqueue before advancing. Partial success is safe because jobs have stable unique identities.
  for (const window of plan.windows) await discover(window);
  await finish(plan.nextCursor);
}
