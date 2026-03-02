import { z } from "zod";

export const roleSchema = z.enum(["primary", "co"]);

export const updatePersonSchema = z.object({
  first_name: z.string().trim().max(80).nullable().optional(),
  last_name: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),

  address_line1: z.string().trim().max(120).nullable().optional(),
  address_line2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(30).nullable().optional(),
  zip: z.string().trim().max(20).nullable().optional(),

  residence_months: z.number().int().min(0).max(1200).nullable().optional(),

  banking_checking: z.boolean().optional(),
  banking_savings: z.boolean().optional(),
  banking_prepaid: z.boolean().optional(),
});