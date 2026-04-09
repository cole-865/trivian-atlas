type QueryError = {
  message: string;
};

type QuerySingleResult<T> = {
  data: T[] | null;
  error: QueryError | null;
};

type DeleteResult = {
  error: QueryError | null;
};

type StorageRemoveResult = {
  error: QueryError | null;
};

type SupabaseLike = {
  from: (table: string) => {
    select: <T = Record<string, unknown>>(columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<QuerySingleResult<T>>;
      };
    };
    delete: () => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<DeleteResult>;
      };
    };
  };
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<StorageRemoveResult>;
    };
  };
};

type CreditReportArtifactRow = {
  redacted_bucket: string | null;
  redacted_path: string | null;
};

function asSupabaseClient(supabase: unknown) {
  return supabase as SupabaseLike;
}

async function deleteScopedRows(
  supabase: SupabaseLike,
  table: string,
  organizationId: string,
  dealId: string
) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId);

  if (error) {
    throw new Error(`Failed to delete ${table}: ${error.message}`);
  }
}

export async function purgeCreditReportArtifacts(
  supabase: unknown,
  args: {
    organizationId: string;
    dealId: string;
    deleteJobs?: boolean;
  }
) {
  const client = asSupabaseClient(supabase);
  const { organizationId, dealId, deleteJobs = false } = args;

  const { data: creditReports, error: creditReportsError } = await client
    .from("credit_reports")
    .select<CreditReportArtifactRow>("redacted_bucket, redacted_path")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId);

  if (creditReportsError) {
    throw new Error(`Failed to load credit report artifacts: ${creditReportsError.message}`);
  }

  for (const report of creditReports ?? []) {
    if (!report.redacted_bucket || !report.redacted_path) {
      continue;
    }

    const { error } = await client.storage
      .from(report.redacted_bucket)
      .remove([report.redacted_path]);

    if (error) {
      throw new Error(`Failed to remove redacted report file: ${error.message}`);
    }
  }

  await deleteScopedRows(client, "bureau_tradelines", organizationId, dealId);
  await deleteScopedRows(client, "bureau_public_records", organizationId, dealId);
  await deleteScopedRows(client, "bureau_messages", organizationId, dealId);
  await deleteScopedRows(client, "bureau_summary", organizationId, dealId);
  await deleteScopedRows(client, "credit_reports", organizationId, dealId);

  if (deleteJobs) {
    await deleteScopedRows(client, "credit_report_jobs", organizationId, dealId);
  }
}
