import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const categorySchema = z.enum([
  "cafe",
  "restaurant",
  "dentist",
  "hairdresser",
  "bakery",
  "car_repair",
  "florist",
  "gym",
]);
export const jobSchema = z.object({
  country: text(80),
  city: text(100),
  category: categorySchema,
  keywords: z.string().trim().max(120).default(""),
  service_area: z.string().trim().max(150).default(""),
  max_results: z.number().int().min(1).max(100),
  requirements: z.object({
    public_contact: z.boolean(),
    website_review: z.boolean(),
  }),
});
export const idSchema = z.string().uuid();
export const proposalSchema = z.object({
  id: idSchema.optional(),
  business_id: idSchema,
  title: text(180),
  content: text(30000),
});
export const messageSchema = z
  .object({
    id: idSchema.optional(),
    business_id: idSchema,
    channel: z.enum(["email", "whatsapp"]),
    recipient: text(200),
    subject: z.string().trim().max(200),
    body: text(10000),
  })
  .superRefine((v, ctx) => {
    if (v.channel === "email" && !z.email().safeParse(v.recipient).success)
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message: "Enter a valid business email address.",
      });
    if (v.channel === "whatsapp" && !/^\+[1-9]\d{7,14}$/.test(v.recipient))
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message: "Use an international phone number, e.g. +923001234567.",
      });
  });
export const settingsSchema = z.object({
  search_limit: z.number().int().min(1).max(100),
  verification_threshold: z.number().int().min(50).max(100),
  retention_days: z.number().int().min(7).max(365),
});
export const manualSchema = z.object({
  business_id: idSchema,
  activity: z.enum(["verified_active", "manual_review", "closed_inactive"]),
  website: z.enum([
    "manual_review",
    "website_found",
    "no_website_high_confidence",
  ]),
  explanation: text(3000).min(40),
  source_url: z.url().refine((s) => /^https?:/.test(s)),
  second_source: z
    .url()
    .refine((s) => /^https?:/.test(s))
    .optional(),
  observed_at: z.iso.date(),
});
