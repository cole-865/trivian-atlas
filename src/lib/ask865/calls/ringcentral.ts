// Server/CLI transport only. No browser module should import this credentialed client.
// Deliberately accepts no provider URLs and never returns provider error bodies.
import { z } from "zod";
import { inspectAudio, limitedBytes, maxAudioBytes, MediaError } from "./media.ts";

const origin = "https://platform.ringcentral.com";
const identifier = z.union([z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), z.number().int().nonnegative().safe()]).transform(String);
const recording = z.object({ id: identifier });
const extension = z.object({ id: identifier });
const leg = z.object({ recording: recording.nullish(), extension: extension.nullish() });
const entry = z.object({
  id: identifier, direction: z.enum(["Inbound", "Outbound"]),
  startTime: z.iso.datetime({ offset: true }), duration: z.number().finite().nonnegative(),
  recording: recording.nullish(), extension: extension.nullish(), legs: z.array(leg).max(500).optional(),
});
const pageSchema = z.object({
  records: z.array(entry).max(100),
  paging: z.object({ page: z.number().int().positive(), totalPages: z.number().int().nonnegative().optional() }),
  navigation: z.object({ nextPage: z.object({ uri: z.string().min(1) }).optional() }).optional(),
}).refine(page => page.paging.totalPages !== undefined || page.navigation !== undefined);
export type RingCentralConfig = { clientId: string; clientSecret: string; jwt: string; accountId: string };
export type RecordingDiscovery = { callId: string; recordingIds: string[]; extensionIds: string[]; direction: "inbound" | "outbound"; startedAt: string; durationSeconds: number };
export type RingCentralFailure = "configuration_missing" | "authentication_failed" | "access_denied" | "account_mismatch" | "rate_limited" | "provider_unavailable" | "invalid_response" | "invalid_window";
export class RingCentralError extends Error {
  readonly code: RingCentralFailure;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: RingCentralFailure, retryAfterSeconds?: number) {
    super(`RingCentral connection check: ${code}`);
    this.name = "RingCentralError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const ringCentralEnvironmentKeys = ["ASK865_RINGCENTRAL_CLIENT_ID", "ASK865_RINGCENTRAL_CLIENT_SECRET", "ASK865_RINGCENTRAL_JWT", "ASK865_RINGCENTRAL_ACCOUNT_ID"] as const;
export function ringCentralConfig(env: Record<string, string | undefined>): RingCentralConfig {
  const values = ringCentralEnvironmentKeys.map(key => env[key]?.trim());
  if (values.some(value => !value) || !identifier.safeParse(values[3]).success) throw new RingCentralError("configuration_missing");
  return { clientId: values[0]!, clientSecret: values[1]!, jwt: values[2]!, accountId: values[3]! };
}

export class RingCentralClient {
  private readonly config: RingCentralConfig;
  private readonly send: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; until: number } | undefined;
  private authenticating: Promise<string> | undefined;
  private accountVerifiedUntil = 0;
  constructor(config: RingCentralConfig, send: typeof fetch = fetch, now = Date.now) {
    if (!config.clientId || !config.clientSecret || !config.jwt || !identifier.safeParse(config.accountId).success) throw new RingCentralError("configuration_missing");
    this.config = { ...config }; this.send = send; this.now = now;
  }
  private async request(path: string, init: RequestInit): Promise<unknown> {
    try {
      const options = { ...init, cache: "no-store" as const, redirect: "error" as const, signal: AbortSignal.timeout(15000) };
      const response = await this.send(origin + path, options);
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const delay = Number(response.headers.get("retry-after"));
          throw new RingCentralError("rate_limited", Number.isFinite(delay) && delay > 0 ? Math.min(Math.ceil(delay), 86400) : undefined);
        }
        if (response.status === 401 || (path.endsWith("/token") && response.status === 400)) throw new RingCentralError("authentication_failed");
        if (response.status === 403) throw new RingCentralError("access_denied");
        throw new RingCentralError("provider_unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new RingCentralError("invalid_response");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); throw new RingCentralError("invalid_response"); }
          chunks.push(part.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } finally { reader.releaseLock(); }
    } catch (error) {
      if (error instanceof RingCentralError) throw error;
      throw new RingCentralError(error instanceof SyntaxError ? "invalid_response" : "provider_unavailable");
    }
  }
  private async accessToken() {
    if (this.token && this.token.until > this.now()) return this.token.value;
    if (this.authenticating) return this.authenticating;
    this.accountVerifiedUntil = 0;
    this.authenticating = (async () => {
      const raw = await this.request("/restapi/oauth/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}` },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: this.config.jwt }).toString(),
      });
      const result = z.object({ access_token: z.string().min(1).max(8192), token_type: z.string().regex(/^bearer$/i), expires_in: z.number().int().min(1).max(86400) }).safeParse(raw);
      if (!result.success) throw new RingCentralError("invalid_response");
      this.token = { value: result.data.access_token, until: this.now() + Math.max(0, result.data.expires_in - 60) * 1000 };
      return this.token.value;
    })();
    try { return await this.authenticating; } finally { this.authenticating = undefined; }
  }
  private async get(path: string) {
    const token = await this.accessToken();
    try { return await this.request(path, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); }
    catch (error) {
      if (error instanceof RingCentralError && error.code === "authentication_failed") { this.token = undefined; this.accountVerifiedUntil = 0; }
      throw error;
    }
  }
  async verifyAccount() {
    await this.accessToken();
    if (this.accountVerifiedUntil > this.now()) return;
    const result = z.object({ id: identifier }).safeParse(await this.get("/restapi/v1.0/account/~"));
    if (!result.success) throw new RingCentralError("invalid_response");
    if (result.data.id !== this.config.accountId) throw new RingCentralError("account_mismatch");
    this.accountVerifiedUntil = this.token?.until ?? 0;
  }
  async discover(dateFrom: string, dateTo: string, maxPages = 3) {
    const from = Date.parse(dateFrom), to = Date.parse(dateTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 86400000 || to > this.now() || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) throw new RingCentralError("invalid_window");
    const calls = new Map<string, RecordingDiscovery>();
    let pagesRead = 0, complete = false;
    for (let page = 1; page <= maxPages; page++) {
      await this.verifyAccount();
      const query = new URLSearchParams({ view: "Detailed", type: "Voice", dateFrom: new Date(from).toISOString(), dateTo: new Date(to).toISOString(), perPage: "100", page: String(page) });
      // Never follow navigation.nextPage.uri or recording.contentUri supplied in a response.
      const result = pageSchema.safeParse(await this.get(`/restapi/v1.0/account/${this.config.accountId}/call-log?${query}`));
      if (!result.success || result.data.paging.page !== page) throw new RingCentralError("invalid_response");
      pagesRead++;
      for (const row of result.data.records) {
        const started = Date.parse(row.startTime);
        if (started < from || started > to) throw new RingCentralError("invalid_response");
        const recordingIds = [...new Set([row.recording?.id, ...(row.legs ?? []).map(leg => leg.recording?.id)].filter((id): id is string => !!id))];
        const previous = calls.get(row.id);
        const extensionIds = [row.extension?.id, ...(row.legs ?? []).map(leg => leg.extension?.id)].filter((id): id is string => !!id);
        calls.set(row.id, { callId: row.id, recordingIds: [...new Set([...(previous?.recordingIds ?? []), ...recordingIds])], extensionIds: [...new Set([...(previous?.extensionIds ?? []), ...extensionIds])], direction: row.direction === "Inbound" ? "inbound" : "outbound", startedAt: row.startTime, durationSeconds: row.duration });
      }
      const morePages = result.data.paging.totalPages !== undefined
        ? page < result.data.paging.totalPages : !!result.data.navigation?.nextPage;
      if (!morePages) { complete = true; break; }
      if (result.data.records.length === 0) throw new RingCentralError("invalid_response");
    }
    return { calls: [...calls.values()], pagesRead, complete };
  }
  async listExtensions() {
    const rows: { id: string; extensionNumber: string; name: string; type: string; status: string; email: string | null }[] = [];
    const schema = z.object({ records: z.array(z.object({ id: identifier, extensionNumber: z.string().default(""), name: z.string(), type: z.string(), status: z.string(),
      contact: z.object({ email: z.string().optional() }).optional() })), paging: z.object({ page: z.number().int(), totalPages: z.number().int().nonnegative() }) });
    for (let page = 1; page <= 10; page++) {
      await this.verifyAccount();
      const result = schema.safeParse(await this.get(`/restapi/v1.0/account/${this.config.accountId}/extension?perPage=100&page=${page}`));
      if (!result.success) throw new RingCentralError("invalid_response");
      if (result.data.paging.page !== page || result.data.paging.totalPages > 10) throw new RingCentralError("invalid_response");
      rows.push(...result.data.records.map(r => ({ id: r.id, extensionNumber: r.extensionNumber, name: r.name, type: r.type, status: r.status, email: r.contact?.email ?? null })));
      if (page >= result.data.paging.totalPages) return rows;
    }
    throw new RingCentralError("invalid_response");
  }
  async checkRecordingMetadata(recordingId: string) {
    if (!identifier.safeParse(recordingId).success) throw new RingCentralError("invalid_response");
    await this.verifyAccount();
    const result = recording.safeParse(await this.get(`/restapi/v1.0/account/${this.config.accountId}/recording/${recordingId}`));
    if (!result.success || result.data.id !== recordingId) throw new RingCentralError("invalid_response");
  }
  async downloadRecording(recordingId: string) {
    // Validate identity and metadata before retrieving content. No provider-supplied
    // contentUri/redirect is followed, so tokens cannot leave the pinned origin.
    await this.checkRecordingMetadata(recordingId);
    let bytes: Uint8Array | undefined;
    try {
      const token = await this.accessToken();
      const response = await this.send(`${origin}/restapi/v1.0/account/${this.config.accountId}/recording/${recordingId}/content`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) { this.token = undefined; this.accountVerifiedUntil = 0; }
        throw new MediaError(response.status === 429 ? "rate_limited" : "recording_unavailable");
      }
      bytes = await limitedBytes(response, maxAudioBytes);
      return inspectAudio(bytes, response.headers.get("content-type") ?? "");
    } catch (error) {
      bytes?.fill(0);
      throw error instanceof MediaError ? error : new MediaError("recording_unavailable");
    }
  }
}

export async function checkRingCentralConnection(client: RingCentralClient, now = Date.now()) {
  // A bounded one-time diagnostic, not a polling loop or a durable ingestion cursor.
  const dateTo = new Date(now - 5 * 60000).toISOString();
  const dateFrom = new Date(now - 5 * 60000 - 86400000).toISOString();
  const result = await client.discover(dateFrom, dateTo);
  const recordings = [...new Set(result.calls.flatMap(call => call.recordingIds))];
  let metadataAccess: "verified" | "not_tested_no_recordings" = "not_tested_no_recordings";
  if (recordings.length) { await client.checkRecordingMetadata(recordings[0]); metadataAccess = "verified"; }
  return {
    status: "connected", dateFrom, dateTo, pagesRead: result.pagesRead, windowComplete: result.complete,
    callsObserved: result.calls.length, inboundObserved: result.calls.filter(call => call.direction === "inbound").length,
    outboundObserved: result.calls.filter(call => call.direction === "outbound").length,
    uniqueRecordingsObserved: recordings.length, recordingMetadataAccess: metadataAccess,
    audioDownloaded: false, callsGraded: 0,
  };
}
