import { z } from "zod";
import { CATEGORIES } from "../types";

const title = z.string().trim().min(2, "Title must be at least 2 characters").max(150);
const author = z.string().trim().min(2, "Author must be at least 2 characters").max(100);
const category = z.enum(CATEGORIES, { errorMap: () => ({ message: "Invalid category" }) });
const image = z
  .string()
  .trim()
  .url("Image must be a valid URL")
  .refine((u) => /^https:\/\//i.test(u), "Image URL must use https")
  .refine((u) => u.length <= 500, "Image URL is too long");
const description = z
  .string()
  .trim()
  .min(20, "Description must be at least 20 characters")
  .max(2000, "Description must be at most 2000 characters");
const totalCopies = z.coerce
  .number({ invalid_type_error: "Total copies must be a number" })
  .int("Total copies must be a whole number")
  .min(1, "Total copies must be at least 1")
  .max(1000, "Total copies must be at most 1000");

// .strict() rejects unknown keys => no mass assignment (owner, availableCopies, addedAt ...).
export const createBookSchema = z
  .object({ title, author, category, image, description, totalCopies })
  .strict();

export const updateBookSchema = createBookSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const listBooksQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  sort: z.enum(["newest", "oldest", "title"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const MS_DAY = 86_400_000;
const utcDay = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_DAY);

export const borrowSchema = z
  .object({
    bookId: z.string().min(1, "bookId is required"),
    returnDate: z.coerce.date({ invalid_type_error: "returnDate must be a valid date" }),
  })
  .strict()
  .superRefine((v, ctx) => {
    const days = utcDay(v.returnDate) - utcDay(new Date());
    if (days < 1 || days > 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["returnDate"],
        message: "Return date must be between 1 and 30 days from today",
      });
    }
  });
