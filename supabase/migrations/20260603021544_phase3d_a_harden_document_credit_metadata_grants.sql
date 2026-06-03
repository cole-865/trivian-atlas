-- Phase 3D-A: remove unnecessary direct grants from active document/credit
-- metadata tables. RLS policies remain unchanged; app access continues through
-- authenticated org-scoped policies and service-role server/worker paths.

revoke all on table public.deal_documents from anon;
revoke all on table public.credit_report_jobs from anon;
revoke all on table public.credit_reports from anon;
revoke all on table public.bureau_summary from anon;
revoke all on table public.bureau_tradelines from anon;
revoke all on table public.bureau_public_records from anon;
revoke all on table public.bureau_messages from anon;

revoke truncate, references, trigger
on table public.deal_documents
from authenticated;

revoke truncate, references, trigger
on table public.credit_report_jobs
from authenticated;

revoke truncate, references, trigger
on table public.credit_reports
from authenticated;

revoke truncate, references, trigger
on table public.bureau_summary
from authenticated;

revoke truncate, references, trigger
on table public.bureau_tradelines
from authenticated;

revoke truncate, references, trigger
on table public.bureau_public_records
from authenticated;

revoke truncate, references, trigger
on table public.bureau_messages
from authenticated;
