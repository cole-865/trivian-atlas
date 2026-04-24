import test from "node:test";
import assert from "node:assert/strict";
import { parseEquifaxReport } from "../services/credit-worker/src/parseEquifax.js";

function report(body: string) {
  return [
    "Equifax-Style Report Generated from Equifax v6 Data",
    "FICO Auto v9 Score 640",
    "REPORT SUMMARY",
    "ACCTS:5 COLL-1 PR-1 HC$1000-$500",
    body,
    "PAYMENT SUMMARY",
    "GRAND $1,000 $500 $50",
    "GRAND $0 $100 $200 $300 $4,000",
    "INQUIRY INFORMATION",
  ].join("\n");
}

function tierCapSignals(parsed: ReturnType<typeof parseEquifaxReport>) {
  return parsed.summary.bureau_raw.tier_cap_signals as Record<string, unknown>;
}

test("total chargeoffs dollar amount is not treated as chargeoff count", () => {
  const parsed = parseEquifaxReport(report(""));
  const signals = tierCapSignals(parsed);

  assert.equal(parsed.summary.total_chargeoffs, 4000);
  assert.equal(signals.unresolved_chargeoffs_count, 0);
});

test("unresolved collections count comes from collection tradelines", () => {
  const parsed = parseEquifaxReport(
    report([
      "COLLECTION INFORMATION",
      "CL-RPTD:01/01/2024 CLIENT:MEDICAL ECOA:I STATUS:UNPAID AMT:$500 BAL:$500 CLASS:MEDICAL DFD:01/01/2024 ASSGN:01/01/2023",
    ].join("\n"))
  );
  const signals = tierCapSignals(parsed);

  assert.equal(signals.unresolved_collections_count, 1);
});

test("unpaid collection statuses do not count as open tradelines", () => {
  const parsed = parseEquifaxReport(
    report([
      "COLLECTION INFORMATION",
      "CL-RPTD:04/20/2026 CLIENT:T Mobile ECOA:I STATUS:04/20/2026--Unpaid AMT:$118 BAL:$118 CLASS:CABLE/CELLULAR BAL DFD:06/08/2024 ASSGN:11/21/2025",
      "PAYMENT PRACTICE",
      "Chimefin/Stride Bank/163ZF00215* O1 #-",
      "Secured Credit Card",
      "PYMT HIST-111111111111/111111111111 30- /60- /90-",
      "03/05/2026!$9!03/../2026",
      "08/16/2023!$5859!02/../2026",
    ].join("\n"))
  );

  assert.equal(parsed.tradelines[0]?.account_status, "unpaid");
  assert.equal(parsed.tradelines[0]?.account_type, "Telecommunication/Cellular");
  assert.equal(parsed.summary.open_tradelines, 1);
});

test("unresolved chargeoff count comes from chargeoff tradelines", () => {
  const parsed = parseEquifaxReport(
    report([
      "PAYMENT PRACTICE",
      "CAPITAL ONE/ABCDE I9 ACCOUNT",
      "charged off account",
      "01/01/2024!$500!01/01/2024",
      "01/01/2020!$500!01/01/2024",
      "$0!$0!$0!$0",
    ].join("\n"))
  );
  const signals = tierCapSignals(parsed);

  assert.equal(signals.unresolved_chargeoffs_count, 1);
});

test("open auto derogatory is detected from bad auto tradeline", () => {
  const parsed = parseEquifaxReport(
    report([
      "PAYMENT PRACTICE",
      "WESTLAKE/ABCDE I9 AUTO",
      "Auto charged off account",
      "01/01/2024!$500!01/01/2024",
      "01/01/2020!$500!01/01/2024",
      "$0!$0!$0!$0",
    ].join("\n"))
  );
  const signals = tierCapSignals(parsed);

  assert.equal(signals.open_auto_derogatory, true);
});

test("bankruptcy date is extracted when present", () => {
  const parsed = parseEquifaxReport(
    report("BANKRUPTCY CH 7 FILED: 01/15/2020 DISCHARGED: 04/20/2020")
  );
  const signals = tierCapSignals(parsed);

  assert.equal(parsed.publicRecords[0]?.filed_date, "2020-01-15");
  assert.equal(parsed.publicRecords[0]?.resolved_date, "2020-04-20");
  assert.equal(signals.bankruptcy_count, 1);
  assert.equal(typeof signals.months_since_bankruptcy, "number");
  assert.equal(signals.bankruptcy_date_unknown, false);
});

test("public record information bankruptcy extracts filed and disposition dates", () => {
  const parsed = parseEquifaxReport(
    [
      "Equifax-Style Report Generated from Equifax v6 Data",
      "REPORT SUMMARY",
      "SUM-02/24/2016-04/12/2026, PR-1 COLL-0 ACCTS:79 HC$558-$21422",
      "PUBLIC RECORD INFORMATION",
      "BKRPTCY-FILED:05/14/2025       768VF00010  FILED/TYPE:Joint/Personal    ASSET:",
      "        RPTD: 08/20/2025 CASE:2530943",
      "        DISP: 08/19/2025 INTENT:DISCHARGED CH-7 PRIOR INTENT:VOLUNTARY CH-7",
      "        VER:             LIAB:            ASSET:            EXEMPT:",
      "PAYMENT PRACTICE",
    ].join("\n")
  );
  const signals = tierCapSignals(parsed);

  assert.equal(parsed.publicRecords.length, 1);
  assert.equal(parsed.publicRecords[0]?.record_type, "bankruptcy");
  assert.equal(parsed.publicRecords[0]?.filed_date, "2025-05-14");
  assert.equal(parsed.publicRecords[0]?.resolved_date, "2025-08-19");
  assert.equal(parsed.publicRecords[0]?.raw_segment.reported_date, "2025-08-20");
  assert.equal(signals.bankruptcy_count, 1);
  assert.equal(typeof signals.months_since_bankruptcy, "number");
  assert.equal(signals.bankruptcy_date_unknown, false);
});

test("bankruptcy with unknown date flags presence but does not calculate months", () => {
  const parsed = parseEquifaxReport(report("BANKRUPTCY CH 7 DISCHARGED"));
  const signals = tierCapSignals(parsed);

  assert.equal(signals.bankruptcy_count, 1);
  assert.equal(signals.months_since_bankruptcy, null);
  assert.equal(signals.bankruptcy_date_unknown, true);
});

test("bankruptcy-reported tradelines from Equifax sample dedupe to one bankruptcy signal", () => {
  const parsed = parseEquifaxReport(
    report([
      "PAYMENT PRACTICE",
      "Citizens Savings AND/795FP00204*   BKRPT       #-",
      "                                      Auto",
      "PYMT HIST-                                                    30-  /60- /90-",
      "07/31/2025!          !05/../2025!          !          !  /       !          !",
      "02/19/2025!          !          !          !          !          !          !",
      "          !          !          !          !          !          !          !",
      "BANKRUPTCY Chapter 7",
      "bankruptcy discharged",
      "Mariner Finance     /015FP00466*   BKRPT       #-",
      "                                      Secured",
      "PYMT HIST-                                                    30-  /60- /90-",
      "07/31/2025!          !05/../2025!          !          !  /       !          !",
      "11/25/2024!          !          !          !          !          !          !",
      "          !          !          !          !          !          !          !",
      "BANKRUPTCY Chapter 7",
      "bankruptcy discharged",
      "Citizens Savings AND/795FP00204*   BKRPT       #-",
      "                                      Auto",
      "PYMT HIST-                                                    30-  /60- /90-",
      "07/31/2025!          !05/../2025!          !          !  /       !          !",
      "02/19/2025!          !          !          !          !          !          !",
      "          !          !          !          !          !          !          !",
      "BANKRUPTCY Chapter 7",
      "bankruptcy discharged",
    ].join("\n"))
  );
  const signals = tierCapSignals(parsed);

  assert.equal(parsed.publicRecords.length, 1);
  assert.equal(parsed.publicRecords[0]?.status, "BANKRUPTCY Chapter 7");
  assert.equal(signals.bankruptcy_count, 1);
  assert.equal(signals.bankruptcy_date_unknown, true);
  assert.equal(signals.months_since_bankruptcy, null);
});

test("BKRPT tradeline headers split separately instead of merging into prior tradeline", () => {
  const parsed = parseEquifaxReport(
    report([
      "PAYMENT PRACTICE",
      "Credit ONE Bank     /180BB27505* R9            #-",
      "                                      Credit Card",
      "PYMT HIST-555432111   /                                       30-01/60-01/90-04",
      "04/12/2026!      $860!09/../2025!          !          !09/Individ!          !",
      "07/30/2025!          !09/../2025!Monthly   !          !$860      !          !",
      "          !      $600!          !          !          !      $860!          !",
      "Charged off account",
      "Citizens Savings AND/795FP00204*   BKRPT       #-",
      "                                      Auto",
      "PYMT HIST-                                                    30-  /60- /90-",
      "07/31/2025!          !05/../2025!          !          !  /       !          !",
      "02/19/2025!          !          !          !          !          !          !",
      "          !          !          !          !          !          !          !",
      "BANKRUPTCY Chapter 7",
      "bankruptcy discharged",
    ].join("\n"))
  );

  assert.equal(parsed.tradelines.length, 2);
  assert.equal(parsed.tradelines[0]?.creditor_name, "Credit ONE Bank");
  assert.equal(parsed.tradelines[0]?.account_type, "Credit Card");
  assert.equal(parsed.tradelines[0]?.is_auto, false);
  assert.equal(parsed.tradelines[1]?.creditor_name, "Citizens Savings AND");
  assert.equal(parsed.tradelines[1]?.account_type, "Auto");
  assert.equal(parsed.tradelines[1]?.account_status, "bankruptcy");
  assert.equal(parsed.tradelines[1]?.is_auto, true);
  assert.equal(parsed.summary.open_auto_trades, 0);
});

test("payment history rows with slashes are not treated as tradeline headers", () => {
  const parsed = parseEquifaxReport(
    report([
      "PAYMENT PRACTICE",
      "Mariner Finance     /015FP00466* I1            #-",
      "                                      Secured",
      "PYMT HIST-*11111111*11/11111111111                            30-  /60- /90-",
      "01/31/2025!        $0!11/../2024!49M       !          !23/Joint  !          !",
      "02/15/2023!     $7614!11/../2024!Monthly   !          !          !          !",
      "11/../2024!          !     $5683!          !          !          !Paid and C!",
      "Refinanced",
    ].join("\n"))
  );

  assert.equal(parsed.tradelines.length, 1);
  assert.equal(parsed.tradelines[0]?.creditor_name, "Mariner Finance");
  assert.equal(parsed.tradelines[0]?.account_type, "Secured");
});

test("public record section text does not mark normal tradelines as bankruptcy", () => {
  const parsed = parseEquifaxReport(
    [
      "Equifax-Style Report Generated from Equifax v6 Data",
      "REPORT SUMMARY",
      "SUM-01/01/2020-04/12/2026, PR-1 COLL-0 ACCTS:1 HC$1000-$500",
      "PUBLIC RECORD INFORMATION",
      "BKRPTCY-FILED:01/17/2023 401VF00077 FILED/TYPE:Indiv/Personal ASSET:",
      "        DISP: 11/14/2024 INTENT:DISMSD/CLSD CH1 PRIOR INTENT:CH-13 FILED",
      "PAYMENT PRACTICE",
      "Dept Of ED        /644FZ07702* I1            #-",
      "                                      Education Loan",
      "PYMT HIST-                                                    30-  /60- /90-",
      "03/31/2026!     $3047!03/../2026!          !          !02/Individ!          !",
      "01/26/2026!     $3000!          !Deferred  !          !$0        !          !",
      "          !          !          !          !          !          !          !",
    ].join("\n")
  );

  assert.equal(parsed.publicRecords[0]?.record_type, "bankruptcy");
  assert.equal(parsed.tradelines[0]?.account_status, "open");
  assert.equal(parsed.tradelines[0]?.good, true);
});

test("post-bankruptcy derogatory only true when dates support it", () => {
  const before = parseEquifaxReport(
    report([
      "BANKRUPTCY CH 7 FILED: 01/15/2022",
      "PAYMENT PRACTICE",
      "CAPITAL ONE/ABCDE I9 ACCOUNT",
      "charged off account",
      "01/01/2021!$500!01/01/2021",
      "01/01/2020!$500!01/01/2021",
      "$0!$0!$0!$0",
    ].join("\n"))
  );
  const after = parseEquifaxReport(
    report([
      "BANKRUPTCY CH 7 FILED: 01/15/2022",
      "PAYMENT PRACTICE",
      "CAPITAL ONE/ABCDE I9 ACCOUNT",
      "charged off account",
      "01/01/2024!$500!01/01/2024",
      "01/01/2020!$500!01/01/2024",
      "$0!$0!$0!$0",
    ].join("\n"))
  );

  assert.equal(tierCapSignals(before).major_derog_after_public_record, false);
  assert.equal(tierCapSignals(after).major_derog_after_public_record, true);
});
