import { z } from "zod";

export const roleSchema = z.enum(["primary", "co"]);

export const incomeSchema = z.object({
  income_type: z.enum(["w2", "self_employed", "fixed", "cash"]),

  monthly_gross_manual: z.number().nullable().optional(),
  manual_notes: z.string().nullable().optional(),

  hire_date: z.string().nullable().optional(),
  pay_frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).nullable().optional(),
  gross_per_pay: z.number().nullable().optional(),
  gross_ytd: z.number().nullable().optional(),
  pay_date: z.string().nullable().optional(),
  pay_period_end: z.string().nullable().optional(),
});