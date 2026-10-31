import type { Filter, ObjectId } from "mongodb";
import { books, borrows } from "../config/db";
import type { AuthUser, BookDoc } from "../types";
import { conflict, forbidden, notFound } from "../utils/http";
import type { z } from "zod";
import type { createBookSchema, listBooksQuerySchema, updateBookSchema } from "../validators/schemas";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function listBooks(query: z.infer<typeof listBooksQuerySchema>) {
  const filter: Filter<BookDoc> = {};
  if (query.category) filter.category = query.category;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ title: rx }, { author: rx }];
  }
  const sort =
    query.sort === "oldest"
      ? { addedAt: 1 as const, _id: 1 as const }
      : query.sort === "title"
        ? { title: 1 as const, _id: 1 as const }
        : { addedAt: -1 as const, _id: -1 as const };

  const [items, total] = await Promise.all([
    books()
      .find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .toArray(),
    books().countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getBook(id: ObjectId) {
  const book = await books().findOne({ _id: id });
  if (!book) throw notFound("Book not found");
  return book;
}

export async function listBooksByOwner(userId: string) {
  return books().find({ addedByUserId: userId }).sort({ addedAt: -1, _id: -1 }).toArray();
}

export async function createBook(user: AuthUser, input: z.infer<typeof createBookSchema>) {
  const now = new Date();
  const doc: Omit<BookDoc, "_id"> = {
    ...input,
    addedByUserId: user.id,
    addedByName: user.name,
    addedByEmail: user.email,
    availableCopies: input.totalCopies,
    addedAt: now,
    updatedAt: now,
  };
  const { insertedId } = await books().insertOne(doc as BookDoc);
  return { ...doc, _id: insertedId };
}

/**
 * Atomic update. Copies currently on loan = totalCopies - availableCopies.
 * The new total may not drop below that, and availableCopies is recomputed inside the same
 * update so a concurrent borrow/return can never leave stock negative or above the total.
 */
export async function updateBook(
  id: ObjectId,
  user: AuthUser,
  input: z.infer<typeof updateBookSchema>,
) {
  const { totalCopies, ...rest } = input;
  const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  const filter: Filter<BookDoc> = { _id: id, addedByUserId: user.id };

  if (totalCopies !== undefined) {
    set.totalCopies = totalCopies;
    set.availableCopies = {
      $subtract: [totalCopies, { $subtract: ["$totalCopies", "$availableCopies"] }],
    };
    filter.$expr = { $lte: [{ $subtract: ["$totalCopies", "$availableCopies"] }, totalCopies] };
  }

  const updated = await books().findOneAndUpdate(filter, [{ $set: set }], {
    returnDocument: "after",
  });
  if (updated) return updated;

  const existing = await books().findOne({ _id: id });
  if (!existing) throw notFound("Book not found");
  if (existing.addedByUserId !== user.id) throw forbidden("You can only edit your own books");
  throw conflict(
    `Total copies cannot be lower than the ${existing.totalCopies - existing.availableCopies} copies currently borrowed`,
  );
}

/** A book can only be deleted while every copy is on the shelf (no active borrows). */
export async function deleteBook(id: ObjectId, user: AuthUser) {
  const res = await books().deleteOne({
    _id: id,
    addedByUserId: user.id,
    $expr: { $eq: ["$availableCopies", "$totalCopies"] },
  });
  if (res.deletedCount === 1) {
    return;
  }
  const existing = await books().findOne({ _id: id });
  if (!existing) throw notFound("Book not found");
  if (existing.addedByUserId !== user.id) throw forbidden("You can only delete your own books");
  const active = await borrows().countDocuments({ bookId: id, status: "active" });
  throw conflict(
    `This book has ${active || existing.totalCopies - existing.availableCopies} active borrow(s). Delete it after all copies are returned.`,
  );
}
