import type { ObjectId } from "mongodb";
import { books, borrows } from "../config/db";
import type { AuthUser, BorrowDoc } from "../types";
import { conflict, forbidden, notFound } from "../utils/http";

const isDuplicateKey = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;

/**
 * Concurrency strategy (works on any MongoDB deployment, no transaction required):
 *  1. Insert the borrow. The partial unique index (userId, bookId | status=active) makes a
 *     double borrow impossible at database level, even for simultaneous requests.
 *  2. Decrement stock with a conditional atomic update (availableCopies > 0).
 *  3. If step 2 fails (sold out), the borrow from step 1 is removed again.
 */
export async function borrowBook(user: AuthUser, bookId: ObjectId, returnDate: Date) {
  const book = await books().findOne({ _id: bookId });
  if (!book) throw notFound("Book not found");

  const now = new Date();
  const doc: Omit<BorrowDoc, "_id"> = {
    bookId,
    bookTitle: book.title,
    bookImage: book.image,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    borrowDate: now,
    returnDate,
    status: "active",
    returnedAt: null,
    createdAt: now,
  };

  let insertedId: ObjectId;
  try {
    ({ insertedId } = await borrows().insertOne(doc as BorrowDoc));
  } catch (e) {
    if (isDuplicateKey(e)) throw conflict("You have already borrowed this book");
    throw e;
  }

  const updated = await books().findOneAndUpdate(
    { _id: bookId, availableCopies: { $gt: 0 } },
    { $inc: { availableCopies: -1 }, $set: { updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) {
    await borrows().deleteOne({ _id: insertedId });
    throw conflict("This book is not available right now");
  }

  return { borrow: { ...doc, _id: insertedId }, availableCopies: updated.availableCopies };
}

export async function listUserBorrows(userId: string) {
  const items = await borrows().find({ userId }).sort({ borrowDate: -1, _id: -1 }).toArray();
  const now = Date.now();
  return items.map((b) => ({
    ...b,
    overdue: b.status === "active" && b.returnDate.getTime() < now,
  }));
}

/**
 * Return: the status flip active -> returned is a single atomic update, so only ONE request can
 * win. Only the winner restores stock (capped at totalCopies), so repeated returns never
 * increment twice.
 */
export async function returnBorrow(user: AuthUser, borrowId: ObjectId) {
  const now = new Date();
  const updated = await borrows().findOneAndUpdate(
    { _id: borrowId, userId: user.id, status: "active" },
    { $set: { status: "returned", returnedAt: now } },
    { returnDocument: "after" },
  );

  if (!updated) {
    const existing = await borrows().findOne({ _id: borrowId });
    if (!existing) throw notFound("Borrow record not found");
    if (existing.userId !== user.id) throw forbidden("This borrow record belongs to another user");
    throw conflict("This book has already been returned");
  }

  const book = await books().findOneAndUpdate(
    { _id: updated.bookId },
    [
      {
        $set: {
          availableCopies: { $min: [{ $add: ["$availableCopies", 1] }, "$totalCopies"] },
          updatedAt: now,
        },
      },
    ],
    { returnDocument: "after" },
  );

  return { borrow: updated, availableCopies: book?.availableCopies ?? null };
}
