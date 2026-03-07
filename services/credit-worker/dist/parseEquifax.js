// services/credit-worker/src/parseEquifax.ts
//
// Equifax-style bureau parser for Atlas.
// Goal: deterministic extraction of the high-value fields needed for
// bureau_summary + bureau detail tables.
//
// This is intentionally conservative:
// - parse the stuff we can identify reliably
// - leave uncertain values as null
// - preserve raw blocks in bureau_raw / raw_segment for debugging
//
// Do NOT use this file to redact. Redaction is a separate concern.
const SECTION_MARKERS = [
    "IDENTITY SCAN ALERT:",
    "IDENTIFICATION INFORMATION",
    "REPORT SUMMARY",
    "COLLECTION INFORMATION",
    "PAYMENT PRACTICE",
    "PAYMENT SUMMARY",
    "INQUIRY INFORMATION",
    "CONSUMER REFERRAL INFORMATION",
];
export function parseEquifaxReport(input) {
    const normalized = normalizeReportText(input);
    const sections = splitEquifaxSections(normalized);
    const scoreInfo = parseScoreSection(normalized);
    const summaryInfo = parseReportSummary(normalized, sections.reportSummary ?? "");
    const collectionTradelines = parseCollections(sections.collectionInformation ?? "");
    const paymentTradelines = parsePaymentPractice(sections.paymentPractice ?? "");
    const paymentSummary = parsePaymentSummary(sections.paymentSummary ?? "");
    const inquiries = parseInquirySection(sections.inquiryInformation ?? "");
    const publicRecords = parsePublicRecords(sections.reportSummary ?? "", sections.paymentPractice ?? "", normalized);
    const tradelines = [...collectionTradelines, ...paymentTradelines];
    const messages = parseMessages(normalized, sections.identityAlert ?? "", scoreInfo);
    const openTradelines = countOpenTradelines(tradelines);
    const openAutoTrade = tradelines.some((t) => t.is_auto && !looksClosed(t));
    const monthsSinceRepo = deriveMonthsSinceRepo(tradelines);
    const monthsSinceBankruptcy = deriveMonthsSinceBankruptcy(publicRecords);
    const totalCollections = sumCollectionBalances(tradelines);
    const utilizationPct = deriveUtilizationPct(tradelines);
    const oldestTradeMonths = deriveOldestTradeMonths(tradelines, summaryInfo.fileSinceDate);
    const summary = {
        bureau_source: "equifax",
        score: scoreInfo.score,
        total_tradelines: summaryInfo.totalTradelines ?? (tradelines.length > 0 ? tradelines.length : null),
        open_tradelines: openTradelines,
        open_auto_trade: openAutoTrade,
        months_since_repo: monthsSinceRepo,
        months_since_bankruptcy: monthsSinceBankruptcy,
        total_collections: totalCollections,
        total_chargeoffs: paymentSummary.totalChargeoffs,
        past_due_amount: paymentSummary.totalPastDue,
        utilization_pct: utilizationPct,
        oldest_trade_months: oldestTradeMonths,
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
/* ----------------------------- normalization ----------------------------- */
export function normalizeReportText(input) {
    let text = String(input ?? "");
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    text = text.replace(/\u0000/g, "");
    text = text.replace(/[ \t]+\n/g, "\n");
    text = text.replace(/[ \t]{2,}/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    // Kill duplicated Equifax report if it appears twice in the extracted text.
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
function splitEquifaxSections(text) {
    return {
        identityAlert: getSection(text, "IDENTITY SCAN ALERT:", [
            "IDENTIFICATION INFORMATION",
            "REPORT SUMMARY",
        ]),
        identificationInformation: getSection(text, "IDENTIFICATION INFORMATION", [
            "REPORT SUMMARY",
        ]),
        reportSummary: getSection(text, "REPORT SUMMARY", [
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
        ]),
        paymentSummary: getSection(text, "PAYMENT SUMMARY", [
            "INQUIRY INFORMATION",
            "CONSUMER REFERRAL INFORMATION",
        ]),
        inquiryInformation: getSection(text, "INQUIRY INFORMATION", [
            "CONSUMER REFERRAL INFORMATION",
        ]),
        consumerReferralInformation: getSection(text, "CONSUMER REFERRAL INFORMATION", []),
    };
}
function getSection(text, startMarker, endMarkers) {
    const start = text.indexOf(startMarker);
    if (start === -1)
        return undefined;
    const startPos = start + startMarker.length;
    const ends = endMarkers
        .map((m) => text.indexOf(m, startPos))
        .filter((v) => v !== -1);
    const endPos = ends.length > 0 ? Math.min(...ends) : text.length;
    return text.slice(startPos, endPos).trim();
}
/* -------------------------------- parsing -------------------------------- */
function parseScoreSection(text) {
    const scoreMatch = text.match(/FICO\s+Auto\s+v\d+\s+\S+\s+Score\s+(\d+)/i);
    const modelMatch = text.match(/Model Name:\s*(.+)/i);
    const factorCodesMatch = text.match(/Factors:\s*([0-9/]+)/i);
    const factorCodes = factorCodesMatch?.[1]
        ? factorCodesMatch[1].split("/").map((s) => s.trim()).filter(Boolean)
        : [];
    const factorsBlockMatch = text.match(/FICO\s+Auto[\s\S]*?Factors:[^\n]*\n([\s\S]*?)Credit Score Disclosure Exception Notice/i);
    const factors = factorsBlockMatch?.[1]
        ? factorsBlockMatch[1]
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => Boolean(s) && !/^Model Name:/i.test(s))
        : [];
    return {
        score: scoreMatch ? safeNumber(scoreMatch[1]) : null,
        model: modelMatch ? modelMatch[1].trim() : null,
        factorCodes,
        factors,
    };
}
function parseReportSummary(fullText, section) {
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
function parseCollections(section) {
    if (!section.trim())
        return [];
    const blocks = section
        .split(/(?=CL-RPTD:)/g)
        .map((b) => b.trim())
        .filter(Boolean);
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
            account_type: classMatch ? classMatch[1].trim() : "collection",
            account_status: statusMatch ? statusMatch[1].trim() : "collection",
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
function parsePaymentPractice(section) {
    if (!section.trim())
        return [];
    const lines = section.split("\n");
    const blocks = [];
    let current = [];
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim())
            continue;
        if (isTradelineHeader(line)) {
            if (current.length)
                blocks.push(current.join("\n"));
            current = [line];
        }
        else if (current.length) {
            current.push(line);
        }
    }
    if (current.length)
        blocks.push(current.join("\n"));
    return blocks
        .map(parseTradelineBlock)
        .filter((x) => Boolean(x));
}
function parseTradelineBlock(block) {
    const lines = block
        .split("\n")
        .map((s) => s.trimEnd())
        .filter(Boolean);
    if (lines.length === 0)
        return null;
    const header = lines[0];
    const creditorMatch = header.match(/^(.+?)\/[A-Z0-9*]+/);
    const conditionMatch = header.match(/\*\s+([A-Z0-9]{2})\s+/);
    const creditorName = creditorMatch ? creditorMatch[1].trim() : header.trim();
    const firstDateLine = findDateLine(lines, 1);
    const secondDateLine = findDateLine(lines, 2);
    const moneyOnlyLine = findMoneyOnlyLine(lines);
    const accountType = detectAccountType(block);
    const accountStatus = detectAccountStatus(block);
    const balance = firstDateLine?.firstMoney ?? null;
    const highBalance = secondDateLine?.firstMoney ?? null;
    const lastActivityDate = firstDateLine?.secondFieldDate ?? null;
    const openedDate = secondDateLine?.date ?? null;
    const lastPaymentDate = secondDateLine?.secondFieldDate ?? null;
    const payments = moneyOnlyLine?.moneys ?? [];
    const monthlyPayment = payments.length >= 1 ? payments[0] : null;
    const scheduledPayment = payments.length >= 2 ? payments[1] : null;
    const pastDueFromHeader = extractMoneyAfterBangField(header, "PAST DUE");
    const chargeOffFromText = extractChargeOffAmount(block);
    const noEffect = /no effect/i.test(block);
    const isCollection = /collection account/i.test(block);
    const isChargeoff = /charged off account/i.test(block) ||
        /charge off/i.test(block) ||
        (chargeOffFromText ?? 0) > 0;
    const isRepo = /repo/i.test(block) ||
        /repossession/i.test(block) ||
        /voluntary surrender/i.test(block);
    const closed = /Paid and C!/i.test(block) ||
        /paid and closed/i.test(block) ||
        /closed/i.test(accountStatus ?? "");
    const isAuto = detectIsAuto(creditorName, accountType, block);
    const isRevolving = /revolving|charge account/i.test(accountType ?? "");
    const isInstallment = /installment|secured|unsecured/i.test(accountType ?? "") && !isRevolving;
    const isBad = isCollection ||
        isChargeoff ||
        isRepo ||
        /[4-9]/.test(extractPaymentHistoryDigits(block)) ||
        /delinq/i.test(block) ||
        /past due/i.test(block);
    const good = !isBad && !closed && (balance ?? 0) >= 0;
    return {
        creditor_name: creditorName,
        account_type: accountType,
        account_status: accountStatus,
        condition_code: conditionMatch ? conditionMatch[1] : null,
        amount: highBalance,
        balance,
        credit_limit: extractCreditLimit(block),
        monthly_payment: monthlyPayment ?? scheduledPayment,
        past_due_amount: pastDueFromHeader,
        high_balance: highBalance,
        opened_date: openedDate,
        last_activity_date: lastActivityDate,
        last_payment_date: lastPaymentDate,
        no_effect: noEffect,
        good,
        bad: isBad,
        auto_repo: isRepo && isAuto,
        unpaid_collection: isCollection && !closed && (balance ?? 0) > 0,
        unpaid_chargeoff: isChargeoff && !closed && ((chargeOffFromText ?? 0) > 0 || (balance ?? 0) > 0),
        is_auto: isAuto,
        is_revolving: isRevolving,
        is_installment: isInstallment,
        raw_segment: {
            raw: block,
            source: "payment_practice",
            chargeOffFromText,
        },
    };
}
function parsePaymentSummary(section) {
    if (!section.trim()) {
        return {
            totalBalance: null,
            totalActualPayment: null,
            totalScheduledPayment: null,
            totalPastDue: null,
            totalChargeoffs: null,
        };
    }
    const lines = section
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    const grandLineIndex = lines.findIndex((line) => /^GRAND\b/i.test(line));
    const slice = grandLineIndex >= 0
        ? lines.slice(grandLineIndex, Math.min(grandLineIndex + 2, lines.length))
        : lines.slice(-2);
    const moneyValues = slice.join(" ").match(/\$[\d,]+/g) ?? [];
    const nums = moneyValues.map((m) => safeMoney(m.replace("$", "")));
    return {
        totalBalance: nums[1] ?? null,
        totalActualPayment: nums[2] ?? null,
        totalScheduledPayment: nums[3] ?? null,
        totalPastDue: nums[5] ?? null,
        totalChargeoffs: nums[6] ?? null,
    };
}
function parseInquirySection(section) {
    if (!section.trim())
        return [];
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
function parsePublicRecords(reportSummary, paymentPractice, fullText) {
    const publicRecordCountMatch = reportSummary.match(/PR-(\d+)/i);
    const publicRecordCount = publicRecordCountMatch
        ? safeNumber(publicRecordCountMatch[1]) ?? 0
        : 0;
    if (publicRecordCount <= 0 && !/bankrupt/i.test(fullText)) {
        return [];
    }
    const records = [];
    const bankruptcyLines = fullText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => /bankrupt/i.test(s));
    for (const line of bankruptcyLines) {
        records.push({
            court_name: null,
            record_type: "bankruptcy",
            plaintiff: null,
            amount: null,
            status: line,
            filed_date: null,
            resolved_date: null,
            no_effect: false,
            good: false,
            bad: true,
            raw_segment: { raw: line, source: "full_text" },
        });
    }
    return records;
}
function parseMessages(fullText, identityAlertSection, scoreInfo) {
    const out = [];
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
    const ssnMatch = /SSN on MDB File:\s*([^\n]+)\n\s*SSN on Inquiry:\s*([^\n]+)/i.exec(identityAlertSection);
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
    if (/Consumer Disputes This Account Information/i.test(fullText)) {
        out.push({
            message_type: "note",
            code: null,
            message_text: "Consumer disputes account information on at least one tradeline.",
            severity: "info",
        });
    }
    return dedupeMessages(out);
}
/* ------------------------------ derivations ------------------------------- */
function countOpenTradelines(tradelines) {
    if (!tradelines.length)
        return null;
    return tradelines.filter((t) => !looksClosed(t)).length;
}
function looksClosed(t) {
    const status = (t.account_status ?? "").toLowerCase();
    const raw = String(t.raw_segment?.raw ?? "").toLowerCase();
    return (status.includes("paid and c") ||
        status.includes("paid and closed") ||
        status.includes("closed") ||
        raw.includes("paid and c!") ||
        raw.includes("paid and closed"));
}
function deriveMonthsSinceRepo(tradelines) {
    const repoDates = tradelines
        .filter((t) => t.auto_repo)
        .map((t) => t.last_activity_date ?? t.last_payment_date ?? t.opened_date)
        .filter(Boolean);
    if (repoDates.length === 0)
        return null;
    const mostRecent = repoDates
        .map(parseIsoDate)
        .filter((d) => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
    return mostRecent ? diffMonths(mostRecent, new Date()) : null;
}
function deriveMonthsSinceBankruptcy(records) {
    const dates = records
        .filter((r) => /bankruptcy/i.test(r.record_type ?? ""))
        .map((r) => r.resolved_date ?? r.filed_date)
        .filter(Boolean);
    if (dates.length === 0)
        return null;
    const mostRecent = dates
        .map(parseIsoDate)
        .filter((d) => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
    return mostRecent ? diffMonths(mostRecent, new Date()) : null;
}
function sumCollectionBalances(tradelines) {
    const rows = tradelines.filter((t) => t.unpaid_collection);
    if (!rows.length)
        return 0;
    return rows.reduce((sum, row) => sum + (row.balance ?? row.amount ?? 0), 0);
}
function deriveUtilizationPct(tradelines) {
    const revolving = tradelines.filter((t) => t.is_revolving && (t.credit_limit ?? 0) > 0);
    if (!revolving.length)
        return null;
    const totalBalance = revolving.reduce((sum, t) => sum + (t.balance ?? 0), 0);
    const totalLimit = revolving.reduce((sum, t) => sum + (t.credit_limit ?? 0), 0);
    if (!totalLimit)
        return null;
    return round2((totalBalance / totalLimit) * 100);
}
function deriveOldestTradeMonths(tradelines, fileSinceDate) {
    const dates = tradelines
        .map((t) => t.opened_date)
        .filter(Boolean)
        .map(parseIsoDate)
        .filter((d) => Boolean(d));
    if (dates.length > 0) {
        const oldest = dates.sort((a, b) => a.getTime() - b.getTime())[0];
        return diffMonths(oldest, new Date());
    }
    if (fileSinceDate) {
        const d = parseIsoDate(fileSinceDate);
        if (d)
            return diffMonths(d, new Date());
    }
    return null;
}
/* -------------------------------- helpers -------------------------------- */
function isTradelineHeader(line) {
    return /^.{3,}\/[A-Z0-9*]{5,}\s+[A-Z0-9]{2}\s+/.test(line);
}
function findDateLine(lines, occurrence) {
    let count = 0;
    for (const line of lines) {
        if (!/^\d{2}\/\d{2}\/\d{4}!/.test(line))
            continue;
        count += 1;
        if (count !== occurrence)
            continue;
        const parts = line.split("!").map((s) => s.trim());
        const date = normalizeDate(parts[0] ?? "");
        const firstMoney = safeMoney(stripDollar(parts[1] ?? ""));
        const secondFieldDate = normalizeDate(parts[2] ?? "");
        return {
            date,
            firstMoney,
            secondFieldDate,
        };
    }
    return null;
}
function findMoneyOnlyLine(lines) {
    for (const line of lines) {
        if (!line.includes("!"))
            continue;
        if (/^\d{2}\/\d{2}\/\d{4}!/.test(line))
            continue;
        const moneyMatches = [...line.matchAll(/\$([\d,]+)/g)].map((m) => safeMoney(m[1]));
        const nums = moneyMatches.filter((n) => n !== null);
        if (nums.length >= 1) {
            return { moneys: nums };
        }
    }
    return null;
}
function detectAccountType(block) {
    const known = [
        "Debt Buyer Account",
        "Charge Account",
        "Collection account",
        "Secured",
        "Unsecured",
        "Fixed rate",
    ];
    for (const k of known) {
        if (block.includes(k)) {
            if (k === "Fixed rate")
                return "installment";
            return k;
        }
    }
    if (/revolving/i.test(block))
        return "revolving";
    if (/installment/i.test(block))
        return "installment";
    return null;
}
function detectAccountStatus(block) {
    if (/Charged off account/i.test(block))
        return "charged_off";
    if (/Collection account/i.test(block))
        return "collection";
    if (/Paid and C!/i.test(block) || /paid and closed/i.test(block))
        return "paid_closed";
    if (/Consumer Disputes This Account Information/i.test(block))
        return "consumer_dispute";
    return "open";
}
function detectIsAuto(creditorName, accountType, block) {
    const combined = `${creditorName ?? ""} ${accountType ?? ""} ${block}`.toLowerCase();
    return [
        "auto",
        "motor",
        "vehicle",
        "car",
        "truck",
        "rv",
        "westlake",
        "ally",
        "road auto",
        "consumer portfolio",
        "global lending",
        "capital one auto",
        "carolina",
        "865 autos",
    ].some((term) => combined.includes(term));
}
function extractPaymentHistoryDigits(block) {
    const match = block.match(/PYMT HIST-([A-Z0-9]+)/i);
    return match ? match[1] : "";
}
function extractChargeOffAmount(block) {
    const lines = block.split("\n");
    for (const line of lines) {
        if (/charge off/i.test(line)) {
            const money = line.match(/\$([\d,]+)/);
            if (money)
                return safeMoney(money[1]);
        }
    }
    // fallback: line patterns like !$3662 ! or trailing charge-off field
    const allMoney = [...block.matchAll(/\$([\d,]+)/g)].map((m) => safeMoney(m[1]));
    const nums = allMoney.filter((n) => n !== null);
    return nums.length ? Math.max(...nums) : null;
}
function extractCreditLimit(block) {
    const lines = block.split("\n");
    for (const line of lines) {
        if (/CRDT LIMIT/i.test(line))
            continue;
        const dollarMatches = [...line.matchAll(/\$([\d,]+)/g)].map((m) => safeMoney(m[1]));
        const nums = dollarMatches.filter((n) => n !== null);
        if (nums.length >= 2 && /Charge Account/i.test(block)) {
            return Math.max(...nums);
        }
    }
    return null;
}
function extractMoneyAfterBangField(_line, _label) {
    return null;
}
function dedupeMessages(messages) {
    const seen = new Set();
    const out = [];
    for (const msg of messages) {
        const key = `${msg.message_type ?? ""}|${msg.code ?? ""}|${msg.message_text}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(msg);
    }
    return out;
}
function safeNumber(v) {
    if (v === null || v === undefined)
        return null;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
}
function safeMoney(v) {
    if (!v)
        return null;
    return safeNumber(v.replace(/[$,]/g, "").trim());
}
function stripDollar(v) {
    return v.replace(/\$/g, "").trim();
}
function normalizeDate(v) {
    if (!v)
        return null;
    const raw = v.trim();
    if (!raw)
        return null;
    if (raw.includes(".."))
        return null;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(raw))
        return null;
    const [mm, dd, yyyy] = raw.split("/");
    const m = Number(mm);
    const d = Number(dd);
    const y = Number(yyyy);
    if (!m || !d || !y)
        return null;
    if (m < 1 || m > 12 || d < 1 || d > 31)
        return null;
    return `${yyyy}-${mm}-${dd}`;
}
function parseIsoDate(v) {
    if (!v)
        return null;
    const d = new Date(`${v}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}
function diffMonths(from, to) {
    let months = (to.getFullYear() - from.getFullYear()) * 12;
    months += to.getMonth() - from.getMonth();
    if (to.getDate() < from.getDate())
        months -= 1;
    return Math.max(0, months);
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
