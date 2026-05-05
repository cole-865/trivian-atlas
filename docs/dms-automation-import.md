# DMS Automation Import

Atlas owns DMS parsing, validation, normalization, hashing, upserts, batch tracking, and sanitized error responses. n8n should deliver CSV files to Atlas and call the import API; it should not write directly to Supabase DMS tables.

## Endpoint

```text
POST /api/dms/import
```

## Service-Token Auth

Set a strong random token in the Atlas runtime environment:

```bash
DMS_IMPORT_TOKEN="<strong random secret>"
```

n8n should send the token as a bearer token:

```text
Authorization: Bearer <DMS_IMPORT_TOKEN>
```

Service-token imports must include `organization_id`. Atlas does not infer organization from a browser session in service-token mode.

Rotate `DMS_IMPORT_TOKEN` immediately if it is ever pasted into chat, logs, screenshots, or an n8n execution record.

## JSON Import

```bash
curl -X POST "https://atlas.example.com/api/dms/import" \
  -H "Authorization: Bearer REPLACE_WITH_DMS_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "report_type": "payment_ledger",
    "organization_id": "00000000-0000-4000-8000-000000000000",
    "source_filename": "Payment Ledger - IQ.csv",
    "csv_content": "Paid Date,Paid Amount,Transaction Type,Deal Identifier\n..."
  }'
```

## Multipart Import

```bash
curl -X POST "https://atlas.example.com/api/dms/import" \
  -H "Authorization: Bearer REPLACE_WITH_DMS_IMPORT_TOKEN" \
  -F "report_type=all_accounts" \
  -F "organization_id=00000000-0000-4000-8000-000000000000" \
  -F "source_filename=All Accounts - IQ.csv" \
  -F "file=@/path/to/All Accounts - IQ.csv;type=text/csv"
```

Supported report types:

- `all_accounts`
- `payment_ledger`
- `bhph_activities`

## Daily Import Order

1. All Accounts full report
2. Payment Ledger trailing 14-day export
3. BHPH Activities trailing 14-day export

## Backfill Order

1. All Accounts historical/current full report
2. Payment Ledger historical full report
3. BHPH Activities historical full report

## Response Safety

The API returns the sanitized import summary only. It does not return `raw_data` or CSV row contents. Authentication errors do not echo the service token.
