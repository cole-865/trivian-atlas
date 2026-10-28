# Ask 865 Call Intelligence

Updated October 28, 2026. Repository: `/Users/colesmacbook/trivian-atlas`;
base commit `4e5ecdab6c1f98be67bad49570bd2d6b477646fe`.

## October 28 pilot activation update

Production migrations for five-calendar-year records and disabled scheduling are applied.
The owner confirmed eight enabled RingCentral users; stable provider IDs are mapped to
staff identities for calls starting at or after 2026-10-28T15:54:55.253Z, with a conservative
90-day re-verification date. No Atlas login or access grant was created. Earlier calls,
shared/ambiguous extensions and transfers remain unmapped.

A real inbound 60-second call and outbound 113-second call passed download/transcription
and created two production review rows. Both failed the privacy gate; neither was graded
or archived. A separate diagnostic of the inbound sample returned all 24 segments, but
safeToAnalyze=false and privacyConfidence=0.90. The required 0.95 threshold was preserved.
No raw audio/transcript was saved locally. Settings.enabled was restored to false after
the bounded pilot; scheduler_enabled remains false. n8n is unchanged.

New `/api/ask865/calls/tick` and `scripts/run-call-tick.mjs` provide a guarded worker:
server token plus environment/database switches, org/account/module checks, a 15-minute
discovery lease, durable cursor, at most six hours of catch-up per scan, one-hour overlap,
and a separate latest-24-hour reconciliation scan. Partial scans never advance the cursor;
retries deduplicate. Each tick processes at most one job. No recurring task is installed or
enabled. Suggested later Coolify command: `node /app/scripts/run-call-tick.mjs`, every five
minutes, only after controlled acceptance. Call duration, rates and backlog must determine
whether this throughput is sufficient. Late additional recording legs and arrivals beyond
the 24-hour reconciliation window still need operational reconciliation before cutover.

Eligible/unclear call records now expire after five calendar years; exclusions retain
30 days. The database enforces this on insert and on audited corrections, including
February 29 handling. Existing review rows predate neither pilot nor this migration;
no historical deletion or expired-record restoration was performed.

Validated: 223 unit tests, 49 isolated database checks, lint and typecheck. The original
production compiler is required; a temporary Webpack build encountered the existing
node:crypto client-import issue outside call intelligence. Use the normal build command.

Remaining launch gates: privacy-successful pilot, actual manager/admin/sales permission
acceptance, manager-labelled grading calibration, safe excluded-audio lifecycle, scheduler
installation, throughput/alert checks, and n8n gap/duplicate reconciliation. Do not switch
on quality calibration or recurring processing merely because credentials and tables work.

## Earlier implementation checkpoint

The initial review application and direct recording-processing path are implemented
and disabled by default. Both new migrations were applied to production on October 28;
the organization settings remain disabled. Application deployment is in progress.
n8n Call Review remains unchanged.

Verified provider results:

- Direct RingCentral account identity, call-log access and recording metadata access
  passed: 58 calls (37 inbound, 21 outbound), 50 unique recording references in the
  checked 24-hour window. This diagnostic did not retrieve audio.
- A generated artificial recording passed real OpenAI transcription and semantic
  redaction. No customer data was used in this test.
- After the owner explicitly confirmed inbound/outbound recording notices,
  employee notice and OpenAI processing, one recent inbound live recording was
  downloaded into memory and successfully transcribed. The privacy gate returned
  `privacy_review_required`. Analysis stopped before grading and archiving.
  No raw audio or transcript was written to disk, and no production review was saved.
- The live sample is a held test, not a successful automatic grade. The application
  now routes this class of hold to a metadata-only management review when deployed.
- The dedicated Google OAuth connection completed with `drive.file` scope. A real
  artificial-audio upload, owner-only permission check, same-ID duplicate retry and
  byte/checksum download verification passed. The retry transferred no second file.
  No customer recordings were archived. Tokens are protected and Git-ignored.
- The two production migrations completed successfully. All five new tables have
  RLS enabled and deny direct reads by anonymous and authenticated browser roles.
  The organization's processing setting is still disabled.

## Concise architecture audit and implementation plan

Atlas already provides Supabase Auth, dealership organization context, active
membership, permission overrides, impersonation checks and Ask 865 module access.
The implementation extends these foundations; it does not add another authorization
system. The older standalone Ask 865 dashboard is not the deployment target.

The replacement path is RingCentral API discovery → durable processing job →
private in-memory recording → transcription → redaction → classification/rubric →
management review and coaching → eligible private Drive archive → authorized playback.
There is no n8n runtime dependency in the new code.

Finish activation in this order:

1. Google OAuth and artificial private storage acceptance are complete.
2. Confirm effective-date mappings from stable RingCentral extension IDs to employees.
   Reused display extension numbers and model-inferred identities are not acceptable.
3. Calibrate transcription quality, classification and grading against manager-reviewed
   pilot calls. Keep quality calibration disabled until this is done. Resolve the live
   sample's privacy hold without lowering the privacy threshold to force a pass.
4. The two tracked migrations are applied. Deploy the app, configure protected
   secrets and policy dates, and test permissions.
5. Add and validate the direct scheduler with durable discovery checkpoints, overlapping
   reconciliation windows and alerting. No recurring worker has been activated yet.
6. Reconcile provider recordings, new jobs, archive receipts and legacy n8n outputs.
   Disable only n8n Call Review after controlled acceptance and gap/duplicate checks.
   DealerCenter and all other n8n workflows are outside this change.

## Implemented behavior

- Both inbound and outbound Sales/Service have versioned, context-specific 0–100
  rubrics. Financing inquiries differ from existing-loan payments; repair estimates
  differ from vendor invoices. The server computes weighted scores from validated
  criteria and actual timestamps rather than trusting a model's total.
- Vendors, payments, accounts payable, collections, internal and personal calls are
  excluded. Mixed/uncertain calls require review. Excluded calls do not receive an
  eligible five-year archive or an automatic performance score.
- Scores below 70, critical flags, confidence issues, unmapped employees and unusable
  evidence require review. Missing confidence does not become 100% confidence.
- Management and admin have review rights through the existing permission registry;
  individual denials still apply. Classification and score overrides require a reason,
  an expected revision and an atomic audit entry. Original AI category/score remain.
- Seven-day coaching totals use corrected eligible scores. In-app flags identify
  repeated low scores. External notifications, coaching task assignment and periodic
  alert delivery are not yet configured.
- New recording jobs deduplicate by organization/account/call, use expiring leases,
  retain archive IDs across retries and stop after three attempts. A completed analysis
  is reused on archive retry and never overwrites a manager correction. Privacy or
  invalid-evidence holds create unscored reviews, not repeated paid analysis attempts.
- Multiple recording legs require manual reconciliation in this slice; audio legs are
  not silently concatenated or scored as separate complete calls.
- The inbox shows queued/running/failed processing counts. Failed technical jobs need
  operator review; no blanket retry/reset control is exposed to browsers.

## Recording security and storage

RingCentral requests use a fixed production origin, account pinning, canonical ID
paths and redirects disabled. Recordings are stream-limited to 24 MB and must have
supported MP3/WAV signatures and MIME types. Oversized/unsupported audio is held.
Provider-returned content URLs are never followed. No phone numbers or names are
retained from call discovery.

Audio and unredacted transcript stay in memory. Buffer cleanup is best effort;
JavaScript strings and Blob copies cannot be guaranteed to be securely erased.
Transcription necessarily sends original audio to OpenAI under the confirmed policy.
A structured semantic privacy pass plus identifier masking runs before grading.
This is risk reduction, not proof of comprehensive redaction. Redaction uncertainty
stops grading and becomes human review. Text requests use `store:false`, no tools,
strict output schemas, bounded responses and sanitized errors. Provider retention
terms are separate from this application's persistence behavior.

The transcription adapter currently uses `gpt-4o-transcribe-diarize` for speaker
labels and timestamps. Current OpenAI documentation lists shutdown on February 26,
2027; code fails closed at that date. Replace and validate this adapter before then.
The newer recommended `gpt-transcribe` does not, in the reviewed guide, replace this
specialized speaker-label workflow. A/B speaker labels are not employee identities.
The privacy model's textual quality estimate is not an acoustic confidence measure;
automatic grading is held until a labelled pilot validates its use.

Drive uses OAuth user authorization for the owner's My Drive. The new bootstrap asks
only for `drive.file`, creates a dedicated app-owned-in-scope folder and saves tokens
in a Git-ignored, mode-600 `.env.drive.local`. It does not authorize general access to
all historical Drive recordings. No keys or refresh tokens are printed.

The archive client verifies the expected Google account and requires owner-only
folder/file permissions; shared drives, link sharing and additional users are rejected
by this initial adapter. It makes no sharing changes. Filenames use opaque hashes.
A pre-generated file ID is committed before upload. Retrying the same ID recovers the
existing verified file instead of duplicating it. MD5 and size verify transfer
integrity; MD5 is not being used as a security signature. Upload-session URLs must
stay on Google's fixed API origin.

Eligible recordings have a five-calendar-year expiry from the call date, including
leap-day handling. The durable recording manifest survives the review record's expiry.
Playback goes through Atlas authentication, current organization, call-review permission,
current eligible classification, consent reference and archive expiry. Every playback
request is audited; private Drive permissions and checksum are reverified. Browsers
receive no provider URL, token or Drive file ID. Single HTTP byte ranges are supported.

Lifecycle limitations before full launch:

- Review/grade/audit policy is still the initial 730 days; excluded review metadata
  defaults to 30 days. Five-year audio does not automatically change those policies.
  A unified retention/hold/deletion policy still needs confirmation.
- No audio deletion, archival cleanup, recording-job/access-log cleanup or legal-hold
  workflow is scheduled. Do not activate retention jobs until the policies are aligned.
- Reclassifying an archived call as excluded immediately blocks playback; removal or
  quarantine of an already uploaded file still requires a controlled lifecycle step.
  There is also a narrow classification-change race during a remote upload; subsequent
  playback rechecks classification. Resolve this lifecycle before unrestricted rollout.
- Playback currently requires an unexpired review record, so a five-year file is not
  automatically browsable after the shorter review expiry. Its private manifest remains.
- A second recoverable storage copy is not configured or tested.
- No automatic scheduler/checkpoint service, late-recording reconciliation, historic
  backfill, production throughput/latency test or end-to-end backup restore test is done.

## Existing archive context

The old workflow moves files from RingCentral Archiver into Reviewed calls, with
category/date subfolders. Empty source folders are not evidence of missing recordings.
The local October 22 n8n export is historical evidence, not proof of current published
execution behavior.

- Incoming: `12DP9uO7toAK3dSSduIP1ghinyf3RdASk`
- Reviewed calls: `1Y4WRoKbp-P31Q8uVhs5sl9NJAWb5cmtt`
- Sales: `1nBFgh6gxbcQcI0zTdlOwctsI7KougpXC`
- Service: `1rcosOG-STjVC4c22F01ZGL-EXZzOTR5_`

Read-only spot checks found private MP3s in Sales/Service date folders for 2025-04-25,
2025-10-27 and 2026-10-27. Each category had 568 date folders. This was not a complete
inventory or recording byte count. The Drive UI subsequently verified total account
usage of 184.53 GB out of 5 TB; this includes all Drive content. Legacy category folders are not
trusted labels for new grading. Future migration must reconcile stable Drive file IDs
and provider recording IDs across both source and processed trees.

## Routes, tables and configuration

Routes:

- `/ask865/calls`: management/admin inbox and coaching.
- `GET /api/ask865/calls`: org-scoped inbox, trends, processing counts and availability.
- `GET/PATCH /api/ask865/calls/[id]`: audit history / revision-checked corrections.
- `GET /api/ask865/calls/[id]/recording`: authenticated, audited private audio proxy.
- `POST /api/ask865/calls/ingest`: trusted redacted-transcript importer.
- `POST /api/ask865/calls/recordings`: trusted `discover` (bounded time window) or
  `process_one` (one leased job). It accepts no browser-supplied org, recording URL,
  employee identity, consent attestation or transcript.
- `POST /api/ask865/calls/retention`: existing scoped review cleanup; not scheduled.

Migrations (both applied to production October 28, 2026):

- `20261028031738_ask865_call_intelligence.sql`: settings, reviews, correction audit,
  existing permission-registry extension and correction RPC.
- `20261028141407_ask865_recording_jobs.sql`: durable jobs/archive manifest, claim RPC
  and append-only playback-access audit.

The already-applied `20261020015700_ask865_dynamic_price_history.sql` was restored
from its canonical 865 Autos source to reconcile local migration history. Its content
was verified against production history; it was not rerun or changed in production.

All tables enable RLS and deny browser roles. The existing service role is used only
in server helpers after org/module/permission checks. Service queries/mutations are
explicitly org-scoped; claims additionally bind the provider account. No secondary
login or permission system is introduced.

Required server configuration (no values are included in this document or patch):

- `ASK865_CALLS_ENABLED`, `ASK865_CALLS_RECORDINGS_ENABLED` (default off)
- `ASK865_CALLS_ORGANIZATION_ID`, `ASK865_CALLS_INGEST_TOKEN` (at least 32 characters)
- `ASK865_CALLS_OPENAI_KEY`, `ASK865_CALLS_MODEL`, `ASK865_CALLS_TRANSCRIPTION_MODEL`
- `ASK865_RINGCENTRAL_CLIENT_ID`, `_CLIENT_SECRET`, `_JWT`, `_ACCOUNT_ID`
- `ASK865_CALLS_CONSENT_APPROVED`, `_CONSENT_REFERENCE`, `_CONSENT_FROM`, `_CONSENT_THROUGH`
- `ASK865_CALLS_QUALITY_CALIBRATED` (default off)
- `ASK865_CALLS_EMPLOYEE_MAPPING`: JSON array of explicit `{extensionId, employeeId,
  validFrom, validThrough}` mappings. Overlap/ambiguity returns unmapped.
- `ASK865_DRIVE_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN`,
  `_OWNER_PERMISSION_ID`, `_ARCHIVE_FOLDER_ID`
- `ASK865_CALLS_PLAYBACK_ENABLED` (default off)

The settings row must be enabled with the matching provider account and approved
policy version; environment flags alone do not activate processing.
`.env.ringcentral.local` already exists locally and is private/Git-ignored. Next.js
will not automatically load this filename or `.env.drive.local`; deployment must
explicitly install protected environment variables. Production access has not been
configured by these local tests.

OAuth bootstrap: `node scripts/connect-call-drive.mjs /protected/client.json` from
the repo. Required registered callback: `http://127.0.0.1:3099/oauth/callback`.
It uses state validation, PKCE and a loopback-only callback, requests offline
`drive.file` consent, and writes `.env.drive.local` without overwriting an existing
file. If folder creation is interrupted after credentials are saved, recover the
same stored folder ID rather than creating another authorization/folder. The local
bootstrap completed a real OAuth flow and private synthetic storage acceptance.

## Verification and acceptance

Completed locally: 216 unit tests, 36 isolated database checks, lint, TypeScript and
production build. Build needed network access for the repo's existing Google Fonts.
Built-app smoke checks returned private/no-store 401 responses for unauthenticated
recording processing and playback. The connection CLI still starts without credentials
and reports configuration missing without making a live request.

Coverage includes cross-account rejection, pagination, chunked size limits, MIME
spoofing, provider error scrubbing, retired-model cutoff, privacy uncertainty,
segment/timestamp validation, employee-map ambiguity, consent coverage, excluded calls,
multiple legs, ID-before-upload checkpoints, retry reuse, shared-folder rejection,
checksum mismatch, redirect rejection, byte ranges, lease recovery, retry exhaustion,
browser-role database denial and correction/audit preservation.

After deployment manually verify management/admin access, sales denial and per-user
denial; cross-organization and impersonation denial; one controlled eligible inbound
and outbound call; all exclusions; low-confidence/privacy holds; revision conflicts;
private playback, category correction blocking playback, duplicate discovery/upload,
provider outage recovery, backlog alerts and no gaps at n8n cutover. Never treat a
200 response or successful credential test as proof that all calls were graded.

## Official implementation references

- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
  and [current transcription workflows](https://developers.openai.com/api/docs/guides/transcription)
  informed the speaker/timestamp adapter and retirement guard.
- [Google Drive uploads and pre-generated IDs](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
  informed resumable uploads and duplicate protection.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
  and [current release notes](https://supabase.com/changelog) were reviewed for the
  tracked migration and service-only function design.
