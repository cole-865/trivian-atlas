// services/credit-worker/src/parseEquifax.ts
//
// Deterministic parser for Equifax-style text reports used by Atlas.

export type BureauMessageRow = {
  message_type: string | null;
  code: string | null;
  message_text: string;
  severity: string | null;
};

export type BureauTradelineRow = {
  creditor_name: string | null;
  account_type: string | null;
  account_status: string | null;
  condition_code: string | null;

  amount: number | null;
  balance: number | null;
  credit_limit: number | null;
  monthly_payment: number | null;
  past_due_amount: number | null;
  high_balance: number | null;

  opened_date: string | null;
  last_activity_date: string | null;
  last_payment_date: string | null;

  no_effect: boolean;
  good: boolean;
  bad: boolean;
  auto_repo: boolean;
  unpaid_collection: boolean;
  unpaid_chargeoff: boolean;

  is_auto: boolean;
  is_revolving: boolean;
  is_installment: boolean;

  raw_segment: Record<string, unknown>;
};

export type BureauPublicRecordRow = {
  court_name: string | null;
  record_type: string | null;
  plaintiff: string | null;
  amount: number | null;
  status: string | null;
  filed_date: string | null;
  resolved_date: string | null;
  no_effect: boolean;
  good: boolean;
  bad: boolean;
  raw_segment: Record<string, unknown>;
};

export type BureauSummaryParsed = {
  bureau_source: string | null;
  score: number | null;
  total_tradelines: number | null;
  open_tradelines: number | null;
  open_auto_trade: boolean | null;
  months_since_repo: number | null;
  months_since_bankruptcy: number | null;
  total_collections: number | null;
  total_chargeoffs: number | null;
  past_due_amount: number | null;
  utilization_pct: number | null;
  oldest_trade_months: number | null;

  autos_on_bureau: number | null;
  open_auto_trades: number | null;
  paid_auto_trades: number | null;
  repo_count: number | null;

  risk_tier: string | null;
  max_term_months: number | null;
  min_cash_down: number | null;
  max_pti: number | null;
  hard_stop: boolean | null;
  hard_stop_reason: string | null;
  stips: unknown[] | null;

  bureau_raw: Record<string, unknown>;
};

export type TierCapSignals = {
  unresolved_collections_count: number;
  unresolved_chargeoffs_count: number;
  open_auto_derogatory: boolean;
  auto_deficiency: boolean;
  public_record_count: number;
  bankruptcy_count: number;
  months_since_bankruptcy: number | null;
  bankruptcy_date_unknown: boolean;
  major_derog_after_public_record: boolean | null;
};

export type ParsedEquifaxReport = {
  bureau: "equifax";
  summary: BureauSummaryParsed;
  tradelines: BureauTradelineRow[];
  publicRecords: BureauPublicRecordRow[];
  messages: BureauMessageRow[];
};

type EquifaxSections = {
  identityAlert?: string;
  identificationInformation?: string;
  reportSummary?: string;
  publicRecordInformation?: string;
  collectionInformation?: string;
  paymentPractice?: string;
  paymentSummary?: string;
  inquiryInformation?: string;
  employmentInformation?: string;
  consumerReferralInformation?: string;
};

type ScoreInfo = {
  score: number | null;
  model: string | null;
  factorCodes: string[];
  factors: string[];
};

type SummaryInfo = {
  fileSinceDate: string | null;
  totalTradelines: number | null;
  collectionsCount: number | null;
  publicRecordsCount: number | null;
  highCreditFromSummary: number | null;
  highBalanceFromSummary: number | null;
};

type PaymentSummaryInfo = {
  totalBalance: number | null;
  totalActualPayment: number | null;
  totalScheduledPayment: number | null;
  totalPastDue: number | null;
  totalChargeoffs: number | null;
  revolvingBalance: number | null;
  revolvingCreditLimit: number | null;
};

type InquiryRow = {
  inquiry_date: string | null;
  subscriber_code: string | null;
  subscriber_name: string | null;
};

type ParsedDateLine = {
  date: string | null;
  firstMoney: number | null;
  secondFieldDate: string | null;
};

type ParsedMoneyOnlyLine = {
  rawParts: string[];
  moneysByPosition: Array<number | null>;
};

export function parseEquifaxReport(input: string): ParsedEquifaxReport {
  const normalized = normalizeReportText(input);
  const sections = splitEquifaxSections(normalized);

  const scoreInfo = parseScoreSection(normalized);
  const summaryInfo = parseReportSummary(normalized, sections.reportSummary ?? "");
  const collectionTradelines = parseCollections(sections.collectionInformation ?? "");
  const paymentTradelines = parsePaymentPractice(sections.paymentPractice ?? "");
  const paymentSummary = parsePaymentSummary(sections.paymentSummary ?? "");
  const inquiries = parseInquirySection(sections.inquiryInformation ?? "");
  const publicRecords = parsePublicRecords(
    sections.reportSummary ?? "",
    sections.publicRecordInformation ?? "",
    normalized
  );
  const messages = parseMessages(normalized, sections.identityAlert ?? "", scoreInfo);

  const tradelines = [...collectionTradelines, ...paymentTradelines];
  const tierCapSignals = deriveTierCapSignals(tradelines, publicRecords);

  const autosOnBureau = countAutoTrades(tradelines);
  const openAutoTrades = countOpenAutoTrades(tradelines);
  const paidAutoTrades = countPaidAutoTrades(tradelines);
  const repoCount = countRepos(tradelines);

  const utilizationPct =
    paymentSummary.revolvingBalance !== null &&
    paymentSummary.revolvingCreditLimit !== null &&
    paymentSummary.revolvingCreditLimit > 0
      ? round2((paymentSummary.revolvingBalance / paymentSummary.revolvingCreditLimit) * 100)
      : deriveUtilizationPct(tradelines);

  const summary: BureauSummaryParsed = {
    bureau_source: "equifax",
    score: scoreInfo.score,
    total_tradelines:
      summaryInfo.totalTradelines ?? (tradelines.length > 0 ? tradelines.length : null),
    open_tradelines: countOpenTradelines(tradelines),
    open_auto_trade: openAutoTrades > 0,
    months_since_repo: deriveMonthsSinceRepo(tradelines),
    months_since_bankruptcy: tierCapSignals.months_since_bankruptcy,
    total_collections: sumCollectionBalances(tradelines),
    total_chargeoffs: paymentSummary.totalChargeoffs,
    past_due_amount: paymentSummary.totalPastDue,
    utilization_pct: utilizationPct,
    oldest_trade_months: deriveOldestTradeMonths(tradelines, summaryInfo.fileSinceDate),

    autos_on_bureau: autosOnBureau,
    open_auto_trades: openAutoTrades,
    paid_auto_trades: paidAutoTrades,
    repo_count: repoCount,

    risk_tier: null,
    max_term_months: null,
    min_cash_down: null,
    max_pti: null,
    hard_stop: null,
    hard_stop_reason: null,
    stips: null,

    bureau_raw: {
      score: scoreInfo,
      reportSummary: summaryInfo,
      paymentSummary,
      tier_cap_signals: tierCapSignals,
      inquiries,
      sectionsFound: Object.keys(sections),
      normalizedPreview: normalized.slice(0, 2000),
    },
  };

  return {
    bureau: "equifax",
    summary,
    tradelines,
    publicRecords,
    messages,
  };
}

/* -------------------------------- normalize ------------------------------- */

export function normalizeReportText(input: string): string {
  let text = String(input ?? "");

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\u0000/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  const eqHeader = "Equifax-Style Report Generated from Equifax v6 Data";
  const first = text.indexOf(eqHeader);
  if (first !== -1) {
    const second = text.indexOf(eqHeader, first + eqHeader.length);
    if (second !== -1) {
      text = text.slice(0, second).trim();
    }
  }

  return text.trim();
}

function splitEquifaxSections(text: string): EquifaxSections {
  return {
    identityAlert: getSection(text, "IDENTITY SCAN ALERT:", [
      "IDENTIFICATION INFORMATION",
      "REPORT SUMMARY",
    ]),
    identificationInformation: getSection(text, "IDENTIFICATION INFORMATION", [
      "REPORT SUMMARY",
    ]),
    reportSummary: getSection(text, "REPORT SUMMARY", [
      "PUBLIC RECORD INFORMATION",
      "COLLECTION INFORMATION",
      "PAYMENT PRACTICE",
      "PAYMENT SUMMARY",
    ]),
    publicRecordInformation: getSection(text, "PUBLIC RECORD INFORMATION", [
      "COLLECTION INFORMATION",
      "PAYMENT PRACTICE",
      "PAYMENT SUMMARY",
    ]),
    collectionInformation: getSection(text, "COLLECTION INFORMATION", [
      "PAYMENT PRACTICE",
      "PAYMENT SUMMARY",
    ]),
    paymentPractice: getSection(text, "PAYMENT PRACTICE", [
      "PAYMENT SUMMARY",
      "INQUIRY INFORMATION",
      "EMPLOYMENT INFORMATION",
      "CONSUMER REFERRAL INFORMATION",
    ]),
    paymentSummary: getSection(text, "PAYMENT SUMMARY", [
      "INQUIRY INFORMATION",
      "EMPLOYMENT INFORMATION",
      "CONSUMER REFERRAL INFORMATION",
    ]),
    inquiryInformation: getSection(text, "INQUIRY INFORMATION", [
      "EMPLOYMENT INFORMATION",
      "CONSUMER REFERRAL INFORMATION",
    ]),
    employmentInformation: getSection(text, "EMPLOYMENT INFORMATION", [
      "CONSUMER REFERRAL INFORMATION",
    ]),
    consumerReferralInformation: getSection(text, "CONSUMER REFERRAL INFORMATION", []),
  };
}

function getSection(
  text: string,
  startMarker: string,
  endMarkers: string[]
): string | undefined {
  const start = text.indexOf(startMarker);
  if (start === -1) return undefined;

  const startPos = start + startMarker.length;
  const ends = endMarkers
    .map((m) => text.indexOf(m, startPos))
    .filter((v) => v !== -1);

  const endPos = ends.length > 0 ? Math.min(...ends) : text.length;
  return text.slice(startPos, endPos).trim();
}

/* -------------------------------- parsing --------------------------------- */

function parseScoreSection(text: string): ScoreInfo {
  const scoreMatch = text.match(/FICO\s+Auto\s+v\d+\s+\S+\s+Score\s+(\d+)/i);
  const modelMatch = text.match(/Model Name:\s*(.+)/i);
  const factorCodesMatch = text.match(/Factors:\s*([0-9/]+)/i);

  const factorCodes = factorCodesMatch?.[1]
    ? factorCodesMatch[1].split("/").map((s) => s.trim()).filter(Boolean)
    : [];

  const factorsBlockMatch = text.match(
    /FICO\s+Auto[\s\S]*?Factors:[^\n]*\n([\s\S]*?)Credit Score Disclosure Exception Notice/i
  );

  const factors = factorsBlockMatch?.[1]
    ? factorsBlockMatch[1]
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    score: scoreMatch ? safeNumber(scoreMatch[1]) : null,
    model: modelMatch ? modelMatch[1].trim() : null,
    factorCodes,
    factors,
  };
}

function parseReportSummary(fullText: string, section: string): SummaryInfo {
  const fileSinceMatch = fullText.match(/FILE SINCE-(\d{2}\/\d{2}\/\d{4})/i);
  const acctsMatch = section.match(/ACCTS:(\d+)/i);
  const collMatch = section.match(/COLL-(\d+)/i);
  const prMatch = section.match(/PR-(\d+)/i);
  const hcMatch = section.match(/HC\$(\d+)-\$(\d+)/i);

  return {
    fileSinceDate: fileSinceMatch ? normalizeDate(fileSinceMatch[1]) : null,
    totalTradelines: acctsMatch ? safeNumber(acctsMatch[1]) : null,
    collectionsCount: collMatch ? safeNumber(collMatch[1]) : null,
    publicRecordsCount: prMatch ? safeNumber(prMatch[1]) : null,
    highCreditFromSummary: hcMatch ? safeNumber(hcMatch[1]) : null,
    highBalanceFromSummary: hcMatch ? safeNumber(hcMatch[2]) : null,
  };
}

function parseCollections(section: string): BureauTradelineRow[] {
  if (!section.trim()) return [];

  const blocks = section
    .split(/(?=CL-RPTD:)/g)
    .map((b) => b.trim())
    .filter((b) => b.startsWith("CL-RPTD:"));

  return blocks.map((block) => {
    const clientMatch = block.match(/CLIENT:(.+?)\s+ECOA:/i);
    const statusMatch = block.match(/STATUS:([^\n]+?)\s+AMT:/i);
    const amountMatch = block.match(/AMT:\s*\$?\s*([\d,]+)/i);
    const balanceMatch = block.match(/BAL:\s*\$?\s*([\d,]+)/i);
    const classMatch = block.match(/CLASS:([A-Z\/ ]+)/i);
    const dfdMatch = block.match(/DFD:\s*([0-9/.*]+)/i);
    const assgnMatch = block.match(/ASSGN:\s*([0-9/.*]+)/i);

    return {
      creditor_name: clientMatch ? clientMatch[1].trim() : null,
      account_type: classMatch ? normalizeCollectionClass(classMatch[1].trim()) : "Collection",
      account_status: normalizeCollectionStatus(statusMatch ? statusMatch[1].trim() : null),
      condition_code: null,

      amount: amountMatch ? safeMoney(amountMatch[1]) : null,
      balance: balanceMatch ? safeMoney(balanceMatch[1]) : null,
      credit_limit: null,
      monthly_payment: null,
      past_due_amount: null,
      high_balance: null,

      opened_date: assgnMatch ? normalizeDate(assgnMatch[1]) : null,
      last_activity_date: dfdMatch ? normalizeDate(dfdMatch[1]) : null,
      last_payment_date: null,

      no_effect: false,
      good: false,
      bad: true,
      auto_repo: false,
      unpaid_collection: true,
      unpaid_chargeoff: false,

      is_auto: false,
      is_revolving: false,
      is_installment: false,

      raw_segment: { raw: block, source: "collection_information" },
    };
  });
}

function parsePaymentPractice(section: string): BureauTradelineRow[] {
  if (!section.trim()) return [];

  const lines = section.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (isTradelineHeader(line)) {
      if (current.length) blocks.push(current.join("\n"));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }

  if (current.length) blocks.push(current.join("\n"));

  return blocks
    .map(parseTradelineBlock)
    .filter((x): x is BureauTradelineRow => Boolean(x))
    .filter((row) => !!row.creditor_name);
}

function parseTradelineBlock(block: string): BureauTradelineRow | null {
  const lines = block
    .split("\n")
    .map((s) => s.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const header = lines[0];
  const creditorMatch = header.match(/^(.+?)\/[A-Z0-9*]+/);
  const conditionMatch = header.match(/\*\s+([A-Z0-9]{2})\s+/);

  let creditorName = creditorMatch ? creditorMatch[1].trim() : header.trim();
  if (!creditorName) return null;

  if (/^-+\s*$/.test(creditorName) || creditorName.replace(/-/g, "").trim() === "") {
    creditorName = detectSyntheticCreditorName(block) ?? creditorName;
  }

  const firstDateLine = findDateLine(lines, 1);
  const secondDateLine = findDateLine(lines, 2);
  const moneyOnlyLine = findMoneyOnlyLine(lines);

  const accountType = detectAccountType(block);
  const accountStatus = detectAccountStatus(block);

  const balance = firstDateLine?.firstMoney ?? null;
  const highBalance = secondDateLine?.firstMoney ?? null;
  const amount = secondDateLine?.firstMoney ?? null;

  const lastActivityDate = firstDateLine?.secondFieldDate ?? null;
  const openedDate = secondDateLine?.date ?? null;
  const lastPaymentDate = secondDateLine?.secondFieldDate ?? null;

  const actualPayment = moneyOnlyLine?.moneysByPosition?.[2] ?? null;
  const scheduledPayment = moneyOnlyLine?.moneysByPosition?.[3] ?? null;

  const creditLimit = extractCreditLimit(block, moneyOnlyLine);
  const chargeOffFromText = extractChargeOffAmount(block, moneyOnlyLine);
  const pastDueAmount = extractPastDueAmount(block);

  const noEffect = /no effect/i.test(block);
  const bankruptcyReported = /\bBKRPT\b/i.test(header);

  const isCollection =
    /collection account/i.test(block) ||
    /debt buyer account/i.test(block) ||
    (accountType?.toLowerCase().includes("collection") ?? false) ||
    accountStatus === "collection" ||
    accountStatus === "unpaid";

  const isChargeoff =
    /charged off account/i.test(block) ||
    /paid charge off/i.test(block) ||
    (chargeOffFromText ?? 0) > 0;

  const isRepo =
    /involuntary repossession/i.test(block) ||
    /voluntary repossession/i.test(block) ||
    /repossession/i.test(block);

  const paidClosed = accountStatus === "paid_closed";
  const paidChargeoff = accountStatus === "paid_chargeoff";

  const isAuto = detectIsAuto(creditorName, accountType, block);
  const isRevolving = /secured credit card|charge account|revolving/i.test(accountType ?? "");
  const isInstallment =
    /installment|education loan|child support|secured|unsecured|deposit related|auto/i.test(
      accountType ?? ""
    ) && !isRevolving;

  const paymentHist = extractPaymentHistoryDigits(block);
  const severeDerog = /[4-9]/.test(paymentHist);

  const bad =
    isCollection ||
    isChargeoff ||
    isRepo ||
    severeDerog ||
    /unpaid/i.test(block) ||
    (pastDueAmount ?? 0) > 0;

  const good =
    !bad &&
    !isCollection &&
    !isChargeoff &&
    !isRepo &&
    !bankruptcyReported &&
    !/unpaid/i.test(block);

  return {
    creditor_name: normalizeCreditorName(creditorName),
    account_type: accountType,
    account_status: accountStatus,
    condition_code: conditionMatch ? conditionMatch[1] : null,

    amount,
    balance,
    credit_limit: creditLimit,
    monthly_payment: scheduledPayment ?? actualPayment,
    past_due_amount: pastDueAmount,
    high_balance: highBalance,

    opened_date: openedDate,
    last_activity_date: lastActivityDate,
    last_payment_date: lastPaymentDate,

    no_effect: noEffect,
    good,
    bad,
    auto_repo: isRepo && isAuto,
    unpaid_collection: isCollection && !paidClosed,
    unpaid_chargeoff: isChargeoff && !paidChargeoff && !paidClosed,

    is_auto: isAuto,
    is_revolving: isRevolving,
    is_installment: isInstallment,

    raw_segment: {
      raw: block,
      source: "payment_practice",
      chargeOffFromText,
      pastDueAmount,
      paidClosed,
      paidChargeoff,
      bankruptcyReported,
      actualPayment,
      scheduledPayment,
    },
  };
}

function parsePaymentSummary(section: string): PaymentSummaryInfo {
  if (!section.trim()) {
    return {
      totalBalance: null,
      totalActualPayment: null,
      totalScheduledPayment: null,
      totalPastDue: null,
      totalChargeoffs: null,
      revolvingBalance: null,
      revolvingCreditLimit: null,
    };
  }

  const lines = section
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const grandIdx = lines.findIndex((line) => /^GRAND\b/i.test(line));
  const revolvingIdx = lines.findIndex((line) => /^REVOLVING\b/i.test(line));

  let totalBalance: number | null = null;
  let totalActualPayment: number | null = null;
  let totalScheduledPayment: number | null = null;
  let totalPastDue: number | null = null;
  let totalChargeoffs: number | null = null;

  let revolvingBalance: number | null = null;
  let revolvingCreditLimit: number | null = null;

  if (grandIdx !== -1) {
    const grandLine1 = lines[grandIdx] ?? "";
    const grandLine2 = lines[grandIdx + 1] ?? "";

    const line1Vals = [...grandLine1.matchAll(/\$([\d,]+)/g)]
      .map((m) => safeMoney(m[1]))
      .filter((n): n is number => n !== null);

    const line2Vals = [...grandLine2.matchAll(/\$([\d,]+)/g)]
      .map((m) => safeMoney(m[1]))
      .filter((n): n is number => n !== null);

    totalBalance = line1Vals[1] ?? null;
    totalPastDue = line1Vals[2] ?? null;
    totalActualPayment = line2Vals[1] ?? null;
    totalScheduledPayment = line2Vals[2] ?? null;
    totalChargeoffs = line2Vals[4] ?? null;
  }

  if (revolvingIdx !== -1) {
    const revolvingLine1 = lines[revolvingIdx] ?? "";
    const revolvingLine2 = lines[revolvingIdx + 1] ?? "";

    const revLine1Vals = [...revolvingLine1.matchAll(/\$([\d,]+)/g)]
      .map((m) => safeMoney(m[1]))
      .filter((n): n is number => n !== null);

    const revLine2Vals = [...revolvingLine2.matchAll(/\$([\d,]+)/g)]
      .map((m) => safeMoney(m[1]))
      .filter((n): n is number => n !== null);

    revolvingBalance = revLine1Vals[1] ?? null;
    revolvingCreditLimit = revLine2Vals[0] ?? null;
  }

  return {
    totalBalance,
    totalActualPayment,
    totalScheduledPayment,
    totalPastDue,
    totalChargeoffs,
    revolvingBalance,
    revolvingCreditLimit,
  };
}

function parseInquirySection(section: string): InquiryRow[] {
  if (!section.trim()) return [];

  const rows = section
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^\d{2}\/\d{2}\/\d{4}\s+/i.test(s));

  return rows.map((row) => {
    const dateMatch = row.match(/^(\d{2}\/\d{2}\/\d{4})\s+/);
    const codeMatch = row.match(/^\d{2}\/\d{2}\/\d{4}\s+CR\s+([A-Z0-9]+)/i);
    const tail = row.replace(/^\d{2}\/\d{2}\/\d{4}\s+CR\s+[A-Z0-9]+\s+/i, "");
    const name = tail.replace(/\s+\(CR\s*\)\s*-?$/i, "").trim();

    return {
      inquiry_date: dateMatch ? normalizeDate(dateMatch[1]) : null,
      subscriber_code: codeMatch ? codeMatch[1].trim() : null,
      subscriber_name: name || null,
    };
  });
}

function parsePublicRecords(
  reportSummary: string,
  publicRecordInformation: string,
  fullText: string
): BureauPublicRecordRow[] {
  const publicRecordCountMatch = reportSummary.match(/PR-(\d+)/i);
  const publicRecordCount = publicRecordCountMatch
    ? safeNumber(publicRecordCountMatch[1]) ?? 0
    : 0;

  if (publicRecordCount <= 0 && !/bankrupt|BKRPT|BKRPTCY/i.test(fullText)) {
    return [];
  }

  const structuredRecords = parsePublicRecordInformation(publicRecordInformation);
  if (structuredRecords.length > 0) {
    return structuredRecords;
  }

  const records: BureauPublicRecordRow[] = [];
  for (const block of extractBankruptcyRecordBlocks(fullText)) {
    const dates = extractPublicRecordDates(block);
    records.push({
      court_name: null,
      record_type: "bankruptcy",
      plaintiff: null,
      amount: null,
      status: firstNonBlankLine(block),
      filed_date: dates.filed_date,
      resolved_date: dates.resolved_date,
      no_effect: false,
      good: false,
      bad: true,
      raw_segment: {
        raw: block,
        source: "full_text",
        date_unknown: !dates.filed_date && !dates.resolved_date,
      },
    });
  }

  return records;
}

function parsePublicRecordInformation(section: string): BureauPublicRecordRow[] {
  if (!section.trim()) return [];

  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const records: BureauPublicRecordRow[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^(?:BKRPTCY|BANKRUPTCY|PUBLIC RECORD)\b/i.test(line)) {
      if (current.length) records.push(parsePublicRecordBlock(current.join("\n")));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }

  if (current.length) records.push(parsePublicRecordBlock(current.join("\n")));

  return records.filter((record) => record.record_type);
}

function parsePublicRecordBlock(block: string): BureauPublicRecordRow {
  const upper = block.toUpperCase();
  const isBankruptcy = /BKRPTCY|BANKRUPTCY|CH-?\s*7|CHAPTER\s*7/.test(upper);
  const dates = extractPublicRecordDates(block);
  const caseMatch = block.match(/\bCASE:\s*([A-Z0-9-]+)/i);
  const reportedMatch = block.match(/\bRPTD:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const statusMatch = block.match(/\bINTENT:\s*([^\n]+)/i);

  return {
    court_name: null,
    record_type: isBankruptcy ? "bankruptcy" : "public_record",
    plaintiff: null,
    amount: null,
    status: statusMatch ? statusMatch[1].trim() : firstNonBlankLine(block),
    filed_date: dates.filed_date,
    resolved_date: dates.resolved_date,
    no_effect: false,
    good: false,
    bad: true,
    raw_segment: {
      raw: block,
      source: "public_record_information",
      case_number: caseMatch ? caseMatch[1].trim() : null,
      reported_date: reportedMatch ? normalizeDate(reportedMatch[1]) : null,
      date_unknown: !dates.filed_date && !dates.resolved_date,
    },
  };
}

function extractBankruptcyRecordBlocks(fullText: string): string[] {
  const lines = fullText.split("\n").map((s) => s.trim());
  const blocks: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!/bankrupt/i.test(line)) continue;

    const blockLines = [line];
    let cursor = i + 1;
    while (cursor < lines.length && /bankrupt|discharg|dismiss/i.test(lines[cursor] ?? "")) {
      blockLines.push(lines[cursor] ?? "");
      cursor += 1;
    }

    const block = blockLines.filter(Boolean).join("\n");
    const key = normalizeBankruptcyBlockKey(block);
    if (key && !seen.has(key)) {
      seen.add(key);
      blocks.push(block);
    }

    i = cursor - 1;
  }

  if (blocks.length === 0 && /\bBKRPT\b/i.test(fullText)) {
    // Some Equifax tradelines only expose bankruptcy through the BKRPT
    // condition code. Treat that as bankruptcy presence, but do not infer a
    // filing/discharge date because the neighboring tradeline dates are not
    // necessarily public-record dates.
    blocks.push("BKRPT");
  }

  return blocks;
}

function normalizeBankruptcyBlockKey(block: string): string {
  return block
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonBlankLine(block: string): string {
  return block
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? block.trim();
}

function extractPublicRecordDates(line: string): {
  filed_date: string | null;
  resolved_date: string | null;
} {
  const filedMatch = line.match(
    /(?:filed|filing|date filed|reported|rptd|rpt)\D{0,20}(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );
  const resolvedMatch = line.match(
    /(?:resolved|discharged|dismissed|closed|date resolved|disp)\D{0,20}(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );
  const allDates = [...line.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)]
    .map((match) => normalizeDate(match[1]))
    .filter((date): date is string => Boolean(date));

  return {
    filed_date: filedMatch ? normalizeDate(filedMatch[1]) : allDates[0] ?? null,
    resolved_date: resolvedMatch
      ? normalizeDate(resolvedMatch[1])
      : allDates.length > 1
        ? allDates[allDates.length - 1]
        : null,
  };
}

function parseMessages(
  fullText: string,
  identityAlertSection: string,
  scoreInfo: ScoreInfo
): BureauMessageRow[] {
  const out: BureauMessageRow[] = [];

  if (/NO MATCH FOUND IN CDC'S OFAC DATABASE/i.test(identityAlertSection)) {
    out.push({
      message_type: "ofac",
      code: null,
      message_text: "No match found in OFAC database.",
      severity: "info",
    });
  }

  if (/Input address substantially matches on-file address/i.test(identityAlertSection)) {
    out.push({
      message_type: "address_match",
      code: null,
      message_text: "Input address substantially matches on-file address.",
      severity: "info",
    });
  }

  const ssnMatch =
    /SSN on MDB File:\s*([^\n]+)\n\s*SSN on Inquiry:\s*([^\n]+)/i.exec(identityAlertSection);

  if (ssnMatch) {
    const same = ssnMatch[1].trim() === ssnMatch[2].trim();
    out.push({
      message_type: same ? "ssn_match" : "ssn_discrepancy",
      code: null,
      message_text: same
        ? "SSN on file matches SSN on inquiry."
        : "SSN on file does not match SSN on inquiry.",
      severity: same ? "info" : "warning",
    });
  }

  scoreInfo.factors.forEach((factor, idx) => {
    out.push({
      message_type: "score_factor",
      code: scoreInfo.factorCodes[idx] ?? null,
      message_text: factor,
      severity: "info",
    });
  });

  if (/Consumer Disputes/i.test(fullText)) {
    out.push({
      message_type: "note",
      code: null,
      message_text: "Consumer disputes account information on at least one tradeline.",
      severity: "info",
    });
  }

  return dedupeMessages(out);
}

/* ------------------------------- derivations ------------------------------ */

function countOpenTradelines(tradelines: BureauTradelineRow[]): number | null {
  if (!tradelines.length) return null;
  return tradelines.filter(isOpenTradeline).length;
}

function countAutoTrades(tradelines: BureauTradelineRow[]): number {
  return tradelines.filter((t) => t.is_auto).length;
}

function countOpenAutoTrades(tradelines: BureauTradelineRow[]): number {
  return tradelines.filter((t) => t.is_auto && isOpenTradeline(t)).length;
}

function countPaidAutoTrades(tradelines: BureauTradelineRow[]): number {
  return tradelines.filter(
    (t) => t.is_auto && (t.account_status === "paid_closed" || looksClosed(t))
  ).length;
}

function countRepos(tradelines: BureauTradelineRow[]): number {
  return tradelines.filter((t) => t.is_auto && t.auto_repo).length;
}

function looksClosed(t: BureauTradelineRow): boolean {
  const status = (t.account_status ?? "").toLowerCase();
  const raw = String(t.raw_segment?.raw ?? "").toLowerCase();

  return (
    status === "paid_closed" ||
    status === "paid_chargeoff" ||
    raw.includes("paid and c!") ||
    raw.includes("paid and closed") ||
    raw.includes("paid charge off")
  );
}

function isOpenTradeline(t: BureauTradelineRow): boolean {
  const status = (t.account_status ?? "").toLowerCase();

  return (
    !looksClosed(t) &&
    status !== "repo" &&
    status !== "charged_off" &&
    status !== "paid_chargeoff" &&
    status !== "bankruptcy" &&
    status !== "collection" &&
    status !== "unpaid"
  );
}

function deriveMonthsSinceRepo(tradelines: BureauTradelineRow[]): number | null {
  const repoDates = tradelines
    .filter((t) => t.auto_repo)
    .map((t) => t.last_activity_date ?? t.last_payment_date ?? t.opened_date)
    .filter(Boolean) as string[];

  if (repoDates.length === 0) return null;

  const mostRecent = repoDates
    .map(parseIsoDate)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return mostRecent ? diffMonths(mostRecent, new Date()) : null;
}

function sumCollectionBalances(tradelines: BureauTradelineRow[]): number | null {
  const rows = tradelines.filter((t) => {
    const type = (t.account_type ?? "").toLowerCase();
    const status = (t.account_status ?? "").toLowerCase();
    const raw = String(t.raw_segment?.raw ?? "").toLowerCase();

    const looksCollection =
      t.unpaid_collection === true ||
      type.includes("collection") ||
      type.includes("debt buyer") ||
      status.includes("collection") ||
      status.includes("unpaid") ||
      raw.includes("collection account") ||
      raw.includes("debt buyer account") ||
      raw.includes("unpaid");

    const excludePaidClosed =
      looksClosed(t) ||
      status.includes("paid_closed") ||
      raw.includes("paid and c!") ||
      raw.includes("paid and closed");

    const hasCollectionBalance = (t.balance ?? t.amount ?? 0) > 0;

    return looksCollection && !excludePaidClosed && hasCollectionBalance;
  });

  if (!rows.length) return 0;

  return rows.reduce((sum, row) => sum + (row.balance ?? row.amount ?? 0), 0);
}

function deriveUtilizationPct(tradelines: BureauTradelineRow[]): number | null {
  const revolving = tradelines.filter(
    (t) => t.is_revolving && (t.credit_limit ?? 0) > 0
  );

  if (!revolving.length) return 0;

  const totalBalance = revolving.reduce((sum, t) => sum + (t.balance ?? 0), 0);
  const totalLimit = revolving.reduce((sum, t) => sum + (t.credit_limit ?? 0), 0);

  if (!totalLimit) return 0;
  return round2((totalBalance / totalLimit) * 100);
}

function deriveOldestTradeMonths(
  tradelines: BureauTradelineRow[],
  fileSinceDate: string | null
): number | null {
  if (fileSinceDate) {
    const d = parseIsoDate(fileSinceDate);
    if (d) return diffMonths(d, new Date());
  }

  const dates = tradelines
    .map((t) => t.opened_date)
    .filter(Boolean)
    .map(parseIsoDate)
    .filter((d): d is Date => Boolean(d));

  if (dates.length > 0) {
    const oldest = dates.sort((a, b) => a.getTime() - b.getTime())[0];
    return diffMonths(oldest, new Date());
  }

  return null;
}

/* -------------------------------- helpers --------------------------------- */

function isTradelineHeader(line: string): boolean {
  if (/^\s*PYMT HIST-/i.test(line)) return false;
  return /^.{3,}\/[A-Z0-9*]{5,}\s+(?:[A-Z0-9]{2}|BKRPT)\b/.test(line);
}

function findDateLine(lines: string[], occurrence: number): ParsedDateLine | null {
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!/^\d{2}\/\d{2}\/\d{4}!/.test(line)) continue;

    count += 1;
    if (count !== occurrence) continue;

    const parts = line.split("!").map((s) => s.trim());
    const date = normalizeDate(parts[0] ?? "");
    const firstMoney = safeMoney(stripDollar(parts[1] ?? ""));
    const secondFieldDate = normalizeDate(parts[2] ?? "");

    return { date, firstMoney, secondFieldDate };
  }

  return null;
}

function findMoneyOnlyLine(lines: string[]): ParsedMoneyOnlyLine | null {
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.includes("!")) continue;
    if (/^\d{2}\/\d{2}\/\d{4}!/.test(line)) continue;

    const rawParts = line.split("!").map((s) => s.trim());
    const moneysByPosition = rawParts.map((p) => safeMoney(stripDollar(p)));

    if (moneysByPosition.some((v) => v !== null)) {
      return { rawParts, moneysByPosition };
    }
  }

  return null;
}
function detectSyntheticCreditorName(block: string): string | null {
  if (/medical/i.test(block)) return "Medical";
  if (/child support/i.test(block)) return "Child Support";
  if (/education loan/i.test(block)) return "Education Loan";
  if (/deposit related/i.test(block)) return "Deposit Related";
  return null;
}

function normalizeCollectionClass(v: string): string {
  const raw = v.replace(/\s+BAL$/i, "").trim().toLowerCase();
  if (raw.includes("cable") || raw.includes("cellular")) return "Telecommunication/Cellular";
  if (raw.includes("insurance")) return "Insurance";
  if (raw.includes("utilities")) return "Utilities";
  if (raw.includes("medical")) return "Medical";
  return v.replace(/\s+BAL$/i, "").trim();
}

function normalizeCollectionStatus(v: string | null): string {
  const raw = (v ?? "").toLowerCase();
  if (raw.includes("paid") && !raw.includes("unpaid")) return "paid_closed";
  if (raw.includes("unpaid")) return "unpaid";
  return v?.trim() || "collection";
}

function normalizeCreditorName(v: string): string {
  return v.replace(/\s{2,}/g, " ").trim();
}

function detectAccountType(block: string): string | null {
  const ordered: Array<[RegExp, string]> = [
    [/secured credit card/i, "Secured Credit Card"],
    [/credit card/i, "Credit Card"],
    [/charge account/i, "Charge Account"],
    [/debt buyer account/i, "Debt Buyer Account"],
    [/collection account/i, "Collection account"],
    [/installment sales contract/i, "Installment Sales Contract"],
    [/note loan/i, "Note Loan"],
    [/rental agreement/i, "Rental Agreement"],
    [/lease/i, "Lease"],
    [/education loan/i, "Education Loan"],
    [/child support/i, "Child Support"],
    [/telecommunication\/cellular/i, "Telecommunication/Cellular"],
    [/insurance/i, "Insurance"],
    [/deposit related/i, "Deposit Related"],
    [/medical/i, "Medical"],
    [/\bauto\b/i, "Auto"],
    [/\bsecured\b/i, "Secured"],
    [/\bunsecured\b/i, "Unsecured"],
    [/fixed rate/i, "Installment"],
  ];

  for (const [rx, label] of ordered) {
    if (rx.test(block)) return label;
  }

  if (/revolving/i.test(block)) return "Revolving";
  if (/installment/i.test(block)) return "Installment";

  return null;
}

function detectAccountStatus(block: string): string | null {
  const firstLine = block.split("\n")[0] ?? "";
  if (/involuntary repossession/i.test(block) || /voluntary repossession/i.test(block)) {
    return "repo";
  }
  if (/\bBKRPT\b/i.test(firstLine)) {
    return "bankruptcy";
  }
  if (/charged off account/i.test(block)) {
    return "charged_off";
  }
  if (/paid charge off/i.test(block)) {
    return "paid_chargeoff";
  }
  if (/collection account/i.test(block) || /debt buyer account/i.test(block)) {
    return "collection";
  }
  if (/paid and c!/i.test(block) || /paid and closed/i.test(block)) {
    return "paid_closed";
  }
  if (/consumer disputes/i.test(block)) {
    return "consumer_dispute";
  }
  if (/unpaid/i.test(block)) {
    return "unpaid";
  }
  return "open";
}

function detectIsAuto(
  creditorName: string | null,
  accountType: string | null,
  block: string
): boolean {
  const combined = ` ${creditorName ?? ""} ${accountType ?? ""} ${block} `.toLowerCase();

  return [
    " road auto finance",
    " westlake",
    " ally financial",
    " gm financial",
    " ford credit",
    " global lending",
    " consumer portfolio",
    " credit acceptance",
    " capital one auto",
    " auto ",
    " motor vehicle",
    " vehicle loan",
    "installment sales contract",
  ].some((term) => combined.includes(term));
}

function extractPaymentHistoryDigits(block: string): string {
  const match = block.match(/PYMT HIST-([A-Z0-9*]+)/i);
  return match ? match[1] : "";
}

function extractChargeOffAmount(
  block: string,
  moneyOnlyLine: ParsedMoneyOnlyLine | null
): number | null {
  const fromMoneyLine = moneyOnlyLine?.moneysByPosition?.[5] ?? null;
  if (fromMoneyLine !== null) return fromMoneyLine;

  if (/paid charge off/i.test(block)) {
    const match = block.match(/\$([\d,]+)/);
    if (match) return safeMoney(match[1]);
  }

  return null;
}

function extractCreditLimit(
  _block: string,
  moneyOnlyLine: ParsedMoneyOnlyLine | null
): number | null {
  return moneyOnlyLine?.moneysByPosition?.[1] ?? null;
}

function extractPastDueAmount(block: string): number | null {
  const dateLines = block
    .split("\n")
    .map((s) => s.trim())
    .filter((line) => /^\d{2}\/\d{2}\/\d{4}!/.test(line));

  for (const line of dateLines) {
    const parts = line.split("!").map((s) => s.trim());
    const pastDue = safeMoney(stripDollar(parts[5] ?? ""));
    if (pastDue !== null) return pastDue;
  }

  return null;
}

function dedupeMessages(messages: BureauMessageRow[]): BureauMessageRow[] {
  const seen = new Set<string>();
  const out: BureauMessageRow[] = [];

  for (const msg of messages) {
    const key = `${msg.message_type ?? ""}|${msg.code ?? ""}|${msg.message_text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(msg);
  }

  return out;
}

function safeNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function safeMoney(v: string | null | undefined): number | null {
  if (!v) return null;
  return safeNumber(v.replace(/[$,]/g, "").trim());
}

function stripDollar(v: string): string {
  return v.replace(/\$/g, "").trim();
}

function normalizeDate(v: string | null | undefined): string | null {
  if (!v) return null;

  const raw = v.trim();
  if (!raw) return null;
  if (raw.includes("..")) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const [, rawMonth, rawDay, rawYear] = match;
  const mm = rawMonth.padStart(2, "0");
  const dd = rawDay.padStart(2, "0");
  const yyyy =
    rawYear.length === 2
      ? `${Number(rawYear) >= 70 ? "19" : "20"}${rawYear}`
      : rawYear;
  const m = Number(mm);
  const d = Number(dd);
  const y = Number(yyyy);

  if (!m || !d || !y) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffMonths(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12;
  months += to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function deriveTierCapSignals(
  tradelines: BureauTradelineRow[],
  publicRecords: BureauPublicRecordRow[]
): TierCapSignals {
  const publicRecordDates = publicRecords
    .map(publicRecordDate)
    .filter((date): date is Date => Boolean(date));
  const bankruptcyRecords = publicRecords.filter((record) =>
    /bankrupt/i.test(record.record_type ?? record.status ?? "")
  );
  const bankruptcyDates = bankruptcyRecords
    .map(publicRecordDate)
    .filter((date): date is Date => Boolean(date));
  const mostRecentPublicRecord = newestDate(publicRecordDates);
  const mostRecentBankruptcy = newestDate(bankruptcyDates);

  return {
    unresolved_collections_count: tradelines.filter(isUnresolvedCollection).length,
    unresolved_chargeoffs_count: tradelines.filter(isUnresolvedChargeoff).length,
    open_auto_derogatory: tradelines.some(isOpenAutoDerogatory),
    auto_deficiency: tradelines.some(isAutoDeficiency),
    public_record_count: publicRecords.length,
    bankruptcy_count: bankruptcyRecords.length,
    months_since_bankruptcy: mostRecentBankruptcy
      ? diffMonths(mostRecentBankruptcy, new Date())
      : null,
    bankruptcy_date_unknown:
      bankruptcyRecords.length > 0 && bankruptcyDates.length < bankruptcyRecords.length,
    major_derog_after_public_record: mostRecentPublicRecord
      ? tradelines.some((tradeline) =>
          isMajorDerogatoryTradeline(tradeline) &&
          isTradelineAfterDate(tradeline, mostRecentPublicRecord)
        )
      : null,
  };
}

function publicRecordDate(record: BureauPublicRecordRow): Date | null {
  const candidate = record.resolved_date ?? record.filed_date;
  return candidate ? parseIsoDate(candidate) : null;
}

function newestDate(dates: Date[]): Date | null {
  return dates.length
    ? dates.sort((a, b) => b.getTime() - a.getTime())[0]
    : null;
}

function isUnresolvedCollection(tradeline: BureauTradelineRow): boolean {
  return tradeline.unpaid_collection === true && !looksClosed(tradeline);
}

function isUnresolvedChargeoff(tradeline: BureauTradelineRow): boolean {
  return tradeline.unpaid_chargeoff === true && !looksClosed(tradeline);
}

function isMajorDerogatoryTradeline(tradeline: BureauTradelineRow): boolean {
  return (
    tradeline.bad === true ||
    tradeline.unpaid_collection === true ||
    tradeline.unpaid_chargeoff === true ||
    tradeline.auto_repo === true ||
    (tradeline.past_due_amount ?? 0) > 0
  );
}

function isTradelineAfterDate(tradeline: BureauTradelineRow, compareDate: Date): boolean {
  const dates = [
    tradeline.last_activity_date,
    tradeline.last_payment_date,
    tradeline.opened_date,
  ]
    .filter(Boolean)
    .map((value) => parseIsoDate(value as string))
    .filter((date): date is Date => Boolean(date));

  return dates.some((date) => date.getTime() > compareDate.getTime());
}

function isOpenAutoDerogatory(tradeline: BureauTradelineRow): boolean {
  if (!tradeline.is_auto || looksClosed(tradeline)) return false;

  const status = (tradeline.account_status ?? "").toLowerCase();
  const raw = String(tradeline.raw_segment?.raw ?? "").toLowerCase();

  return (
    tradeline.bad === true ||
    tradeline.auto_repo === true ||
    tradeline.unpaid_chargeoff === true ||
    (tradeline.past_due_amount ?? 0) > 0 ||
    status.includes("repo") ||
    status.includes("charge") ||
    status.includes("collection") ||
    status.includes("unpaid") ||
    raw.includes("bad debt") ||
    raw.includes("deficien")
  );
}

function isAutoDeficiency(tradeline: BureauTradelineRow): boolean {
  if (!tradeline.is_auto) return false;

  const raw = String(tradeline.raw_segment?.raw ?? "").toLowerCase();
  const status = (tradeline.account_status ?? "").toLowerCase();
  const balance = tradeline.balance ?? tradeline.past_due_amount ?? 0;

  return (
    raw.includes("deficien") ||
    raw.includes("bad debt") ||
    ((tradeline.auto_repo === true || status.includes("repo")) && balance > 0)
  );
}
