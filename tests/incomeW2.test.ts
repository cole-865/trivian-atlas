import test from "node:test";
import assert from "node:assert/strict";
import {
  calcMonthlyFromYtd,
  calcW2Income,
  countDaysInclusive,
  countYtdPayPeriodsInclusive,
} from "../src/lib/income/w2.js";

test("counts YTD days through the pay period end inclusively", () => {
  const start = new Date("2026-01-01");
  const end = new Date("2026-05-02");

  assert.equal(countDaysInclusive(start, end), 122);
});

test("annualizes biweekly YTD income by elapsed pay periods", () => {
  const start = new Date("2026-01-01");
  const end = new Date("2026-05-02");

  assert.equal(countYtdPayPeriodsInclusive(start, end, "biweekly"), 9);
  assert.equal(calcMonthlyFromYtd(13403.79, start, end, "biweekly"), 3226.84);
});

test("W2 calculation keeps paycheck annualized value and frequency-aware YTD value separate", () => {
  const result = calcW2Income({
    hireDate: new Date("2025-07-07"),
    payPeriodEnd: new Date("2026-05-02"),
    payFrequency: "biweekly",
    grossThisPeriod: 1212.63,
    ytdGross: 13403.79,
  });

  assert.equal(result.ytdStartISO, "2026-01-01");
  assert.equal(result.monthlyFromPaycheck, 2627.37);
  assert.equal(result.monthlyFromYtd, 3226.84);
});
