import { createHash } from "node:crypto";
import { z } from "zod";
import { inspectAudio, limitedBytes, limitedJson, maxAudioBytes, MediaError, type PrivateAudio } from "./media";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const api = "https://www.googleapis.com";
export type DriveConfig = { clientId: string; clientSecret: string; refreshToken: string; ownerPermissionId: string; folderId: string };
export type ArchiveIdentity = { organizationId: string; accountId: string; recordingId: string };
export type ArchiveReceipt = { fileId: string; md5: string; bytes: number };
export function driveEnvironment(env: Record<string, string | undefined>): DriveConfig {
  return { clientId: env.ASK865_DRIVE_CLIENT_ID ?? "", clientSecret: env.ASK865_DRIVE_CLIENT_SECRET ?? "", refreshToken: env.ASK865_DRIVE_REFRESH_TOKEN ?? "",
    ownerPermissionId: env.ASK865_DRIVE_OWNER_PERMISSION_ID ?? "", folderId: env.ASK865_DRIVE_ARCHIVE_FOLDER_ID ?? "" };
}
export function archiveKey(identity: ArchiveIdentity) {
  if (!z.uuid().safeParse(identity.organizationId).success || !id.safeParse(identity.accountId).success || !id.safeParse(identity.recordingId).success) throw new MediaError("invalid_archive_identity");
  return createHash("sha256").update(JSON.stringify([identity.organizationId, identity.accountId, identity.recordingId])).digest("hex");
}

export class PrivateDriveArchive {
  private readonly config: DriveConfig;
  private readonly send: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; until: number } | undefined;
  constructor(config: DriveConfig, send: typeof fetch = fetch, now = Date.now) {
    if (!config.clientId || !config.clientSecret || !config.refreshToken || !id.safeParse(config.ownerPermissionId).success || !id.safeParse(config.folderId).success) throw new MediaError("drive_configuration_required");
    this.config = { ...config }; this.send = send; this.now = now;
  }
  private async accessToken() {
    if (this.token && this.token.until > this.now()) return this.token.value;
    try {
      const response = await this.send("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken, grant_type: "refresh_token" }),
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) { await response.body?.cancel(); throw new MediaError("drive_authorization_required"); }
      const token = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().max(86400), token_type: z.string().regex(/^bearer$/i) }).safeParse(await limitedJson(response, 32000));
      if (!token.success) throw new MediaError("drive_authorization_required");
      this.token = { value: token.data.access_token, until: this.now() + Math.max(0, token.data.expires_in - 60) * 1000 };
      return this.token.value;
    } catch (error) { throw error instanceof MediaError ? error : new MediaError("drive_unavailable"); }
  }
  private async request(path: string, init: RequestInit = {}, allow: number[] = []) {
    if (!path.startsWith("/drive/v3/") && !path.startsWith("/upload/drive/v3/")) throw new MediaError("invalid_drive_path");
    try {
      const response = await this.send(api + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.accessToken()}` },
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60000) });
      if (!response.ok && !allow.includes(response.status)) {
        await response.body?.cancel();
        if (response.status === 401) this.token = undefined;
        throw new MediaError(response.status === 429 ? "drive_rate_limited" : "drive_unavailable");
      }
      return response;
    } catch (error) { throw error instanceof MediaError ? error : new MediaError("drive_unavailable"); }
  }
  private async ownerOnly(fileId: string) {
    const permissions = z.object({ nextPageToken: z.string().optional(), permissions: z.array(z.object({ id: z.string(), type: z.string(), role: z.string(), deleted: z.boolean().optional() })) });
    const result = permissions.safeParse(await limitedJson(await this.request(`/drive/v3/files/${fileId}/permissions?fields=nextPageToken,permissions(id,type,role,deleted)&pageSize=100`)));
    if (!result.success || result.data.nextPageToken || result.data.permissions.length !== 1 || result.data.permissions[0].deleted || result.data.permissions[0].id !== this.config.ownerPermissionId || result.data.permissions[0].type !== "user" || result.data.permissions[0].role !== "owner") throw new MediaError("drive_private_folder_required");
  }
  async verifyDestination() {
    const account = z.object({ user: z.object({ permissionId: z.string() }) }).safeParse(await limitedJson(await this.request("/drive/v3/about?fields=user(permissionId)")));
    if (!account.success || account.data.user.permissionId !== this.config.ownerPermissionId) throw new MediaError("drive_account_mismatch");
    const folder = z.object({ id, mimeType: z.literal("application/vnd.google-apps.folder"), trashed: z.literal(false), driveId: z.string().optional(), capabilities: z.object({ canAddChildren: z.literal(true) }) }).safeParse(
      await limitedJson(await this.request(`/drive/v3/files/${this.config.folderId}?fields=id,mimeType,trashed,driveId,capabilities(canAddChildren)`)));
    if (!folder.success || folder.data.id !== this.config.folderId || folder.data.driveId) throw new MediaError("drive_private_folder_required");
    await this.ownerOnly(this.config.folderId);
  }
  async allocateFileId() {
    await this.verifyDestination();
    const result = z.object({ ids: z.array(id).length(1) }).safeParse(await limitedJson(await this.request("/drive/v3/files/generateIds?count=1&space=drive&type=files")));
    if (!result.success) throw new MediaError("drive_invalid_response");
    // Persist this ID with the recording BEFORE upload. Retrying with it cannot
    // create duplicate Drive files, including after an unknown request outcome.
    return result.data.ids[0];
  }
  private async verifyFile(fileId: string, key: string, md5: string, bytes: number): Promise<ArchiveReceipt | null> {
    const response = await this.request(`/drive/v3/files/${fileId}?fields=id,trashed,parents,size,md5Checksum,appProperties`, {}, [404]);
    if (response.status === 404) { await response.body?.cancel(); return null; }
    const file = z.object({ id, trashed: z.literal(false), parents: z.array(id).length(1), size: z.string(), md5Checksum: z.string(), appProperties: z.object({ ask865ArchiveKey: z.string() }) }).safeParse(await limitedJson(response));
    if (!file.success || file.data.id !== fileId || file.data.parents[0] !== this.config.folderId || file.data.appProperties.ask865ArchiveKey !== key || file.data.size !== String(bytes) || file.data.md5Checksum !== md5) throw new MediaError("drive_archive_mismatch");
    await this.ownerOnly(fileId);
    return { fileId, md5, bytes };
  }
  async upload(fileId: string, identity: ArchiveIdentity, audio: PrivateAudio): Promise<ArchiveReceipt> {
    if (!id.safeParse(fileId).success) throw new MediaError("invalid_archive_identity");
    inspectAudio(audio.bytes, audio.mimeType);
    const key = archiveKey(identity), md5 = createHash("md5").update(audio.bytes).digest("hex"), bytes = audio.bytes.byteLength;
    await this.verifyDestination();
    const existing = await this.verifyFile(fileId, key, md5, bytes); if (existing) return existing;
    const created = await this.request("/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": audio.mimeType, "X-Upload-Content-Length": String(bytes) },
      body: JSON.stringify({ id: fileId, name: `${key}.${audio.extension}`, parents: [this.config.folderId], appProperties: { ask865ArchiveKey: key } }),
    }, [409]);
    if (created.status === 409) {
      await created.body?.cancel(); const existing = await this.verifyFile(fileId, key, md5, bytes);
      if (!existing) throw new MediaError("drive_upload_unconfirmed"); return existing;
    }
    const location = created.headers.get("location"); await created.body?.cancel();
    let session: URL;
    try { session = new URL(location ?? ""); } catch { throw new MediaError("drive_invalid_upload_url"); }
    if (session.origin !== api || session.pathname !== "/upload/drive/v3/files" || session.username || session.password || session.hash || session.searchParams.get("uploadType") !== "resumable" || !session.searchParams.get("upload_id")) throw new MediaError("drive_invalid_upload_url");
    const uploaded = await this.request(session.pathname + session.search, { method: "PUT", headers: { "Content-Type": audio.mimeType, "Content-Length": String(bytes) }, body: new Uint8Array(audio.bytes) });
    await uploaded.body?.cancel();
    const verified = await this.verifyFile(fileId, key, md5, bytes);
    if (!verified) throw new MediaError("drive_upload_unconfirmed");
    return verified;
  }
  async download(receipt: ArchiveReceipt, identity: ArchiveIdentity): Promise<PrivateAudio> {
    if (!id.safeParse(receipt.fileId).success || !/^[a-f0-9]{32}$/.test(receipt.md5) || !Number.isInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > maxAudioBytes) throw new MediaError("invalid_archive_identity");
    await this.verifyDestination();
    if (!await this.verifyFile(receipt.fileId, archiveKey(identity), receipt.md5, receipt.bytes)) throw new MediaError("recording_unavailable");
    const response = await this.request(`/drive/v3/files/${receipt.fileId}?alt=media`);
    const bytes = await limitedBytes(response, maxAudioBytes);
    try {
      if (bytes.byteLength !== receipt.bytes || createHash("md5").update(bytes).digest("hex") !== receipt.md5) throw new MediaError("drive_archive_mismatch");
      return inspectAudio(bytes, response.headers.get("content-type") ?? "");
    } catch (error) { bytes.fill(0); throw error; }
  }
}
