# Underwriting Logic - Atlas

## Purpose
This file defines the underwriting and deal structuring rules used across Atlas.

Codex must follow these rules when:
- evaluating deals
- generating vehicle options
- calculating payments
- determining approvals or structure failures

Do not invent new underwriting logic outside this file.

---

## Core constraints

All deals must satisfy ALL of the following:

- PTI (Payment to Income)
- LTV (Loan to Value)
- Max amount financed
- Max vehicle price
- Minimum cash down

If any constraint fails, the deal does NOT structure.

---

## Key definitions

- PTI = monthly payment / gross monthly income
- LTV = amount financed / JD Power retail book value
- Amount financed = vehicle price + taxes + fees + products - cash down

---

## Interest rate

- Default APR: 26.99% – 28.99%
- Use underwriting result APR if provided
- APR must always be converted to monthly rate when calculating payment

---

## Term rules

- Absolute max term: 60 months

### Term adjustments:
- If VSC + GAP selected → allow full term
- If NOT selected → reduce term (typically -6 months)

---

## PTI rules

- Base PTI cap: 22%
- PTI cap may be LOWER based on underwriting tier
- PTI cap comes from underwriting_results.max_pti

### Enforcement:
- payment <= max_payment_cap

Where:
- max_payment_cap = (deal.max_payment / 0.22) * underwriting_results.max_pti

---

## LTV rules

- LTV is based on JD Power retail book value
- If no book value exists:
  - do not hard fail LTV
  - allow deal but flag internally

- Max LTV comes from underwriting_results.max_ltv

---

## Amount financed rules

- Must be <= underwriting_results.max_amount_financed

---

## Vehicle price rules

- Must be <= underwriting_results.max_vehicle_price

---

## Down payment rules

Minimum down is determined by:

- underwriting_results.min_cash_down
- underwriting_results.min_down_pct

Effective rule:
- customer must meet BOTH minimum cash AND percentage requirements

---

## Payment calculation

Monthly payment must use standard amortization:

- principal = amount financed
- rate = APR / 12
- term = months

Formula:
payment = P * [r(1+r)^n] / [(1+r)^n - 1]

---

## Taxes and fees

Taxes and fees must always be included in amount financed.

Typical components:
- sales tax
- doc fee
- title/license
- VSC (if selected)
- GAP (if selected)

### Tax structure (default):

- main tax rate (ex: 7%)
- additional tax:
  - applied to first portion of price (ex: 2.75% on first $3200)

---

## Product rules

### VSC
- Fixed cost (default ~1799)
- Included in taxable amount

### GAP
- Fixed cost (default ~599)

### Effects:
- VSC + GAP unlock full term eligibility

---

## Structure evaluation

Each vehicle must be evaluated against constraints:

### Pass conditions:
- meets PTI
- meets LTV
- meets amount financed
- meets vehicle price
- meets minimum down

---

## Failure handling

If a deal does NOT structure:

### Calculate additional down required

Additional down is the MAX of:
- shortfall to meet min cash down
- shortfall to meet min down %
- amount needed to satisfy LTV
- amount needed to satisfy max amount financed
- amount needed to satisfy PTI

---

## Fail reason codes

All failures must be normalized to:

- PTI
- LTV
- AMOUNT_FINANCED
- VEHICLE_PRICE

---

## Vehicle sorting logic

When returning vehicle options, sort in this order:

1. Vehicles that structure first
2. Constraint priority:
   - LTV
   - AMOUNT_FINANCED
   - VEHICLE_PRICE
   - PTI
3. Lowest additional down required
4. Lowest payment
5. Oldest inventory first

---

## Safety rules

- Never approve a deal that violates constraints
- Never ignore underwriting_results caps
- Never hardcode limits outside config or underwriting results
- Always prefer server-calculated values over client input

---

## Notes

- All underwriting results come from underwriting_results table
- Do not recompute tier logic here
- This file governs STRUCTURING, not credit scoring
