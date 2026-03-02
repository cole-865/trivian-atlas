import { z } from "zod";

export const createDealSchema = z.object({
  customer_name: z.string().trim().min(1).max(120).optional(),
});