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
  applicant_role?: string | null;
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
  dealId: string,
  applicantRole?: string
) {
  let query: {
    eq: (column: string, value: string) => Promise<DeleteResult>;
  } | Promise<DeleteResult> = supabase
    .from(table)
    .delete()
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId);

  if (applicantRole) {
    query = (query as unknown as { eq: (column: string, value: string) => Promise<DeleteResult> }).eq(
      "applicant_role",
      applicantRole
    );
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete ${table}: ${error.message}`);
  }
}

export async function purgeCreditReportArtifacts(
  supabase: unknown,
  args: {
    organizationId: string;
    dealId: string;
    applicantRole?: string;
    deleteJobs?: boolean;
  }
) {
  const client = asSupabaseClient(supabase);
  const { organizationId, dealId, applicantRole, deleteJobs = false } = args;

  let creditReportsQuery:
    | {
        eq: (
          column: string,
          value: string
        ) => Promise<QuerySingleResult<CreditReportArtifactRow>>;
      }
    | Promise<QuerySingleResult<CreditReportArtifactRow>> = client
    .from("credit_reports")
    .select<CreditReportArtifactRow>("applicant_role, redacted_bucket, redacted_path")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId);

  if (applicantRole) {
    creditReportsQuery = (
      creditReportsQuery as unknown as {
        eq: (
          column: string,
          value: string
        ) => Promise<QuerySingleResult<CreditReportArtifactRow>>;
      }
    ).eq("applicant_role", applicantRole);
  }

  const { data: creditReports, error: creditReportsError } = await creditReportsQuery;

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

  await deleteScopedRows(client, "bureau_tradelines", organizationId, dealId, applicantRole);
  await deleteScopedRows(client, "bureau_public_records", organizationId, dealId, applicantRole);
  await deleteScopedRows(client, "bureau_messages", organizationId, dealId, applicantRole);
  await deleteScopedRows(client, "bureau_summary", organizationId, dealId, applicantRole);
  await deleteScopedRows(client, "credit_reports", organizationId, dealId, applicantRole);

  if (deleteJobs) {
    await deleteScopedRows(client, "credit_report_jobs", organizationId, dealId, applicantRole);
  }
}
