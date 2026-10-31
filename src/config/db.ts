import { Collection, Db, MongoClient } from "mongodb";
import { env } from "./env";
import type { BookDoc, BorrowDoc } from "../types";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(uri = env.mongoUri, dbName = env.dbName): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}

function getDb(): Db {
  if (!db) throw new Error("Database not initialised. Call connectDb() first.");
  return db;
}

export const books = (): Collection<BookDoc> => getDb().collection<BookDoc>("books");
export const borrows = (): Collection<BorrowDoc> => getDb().collection<BorrowDoc>("borrows");

export async function ensureIndexes(database: Db): Promise<void> {
  const b = database.collection("books");
  const r = database.collection("borrows");
  await Promise.all([
    b.createIndex({ addedAt: -1 }),
    b.createIndex({ category: 1 }),
    b.createIndex({ addedByUserId: 1 }),
    r.createIndex({ userId: 1, status: 1 }),
    r.createIndex({ bookId: 1, status: 1 }),
    // DB-level "no double borrow": only one ACTIVE borrow per user per book.
    r.createIndex(
      { userId: 1, bookId: 1 },
      { unique: true, partialFilterExpression: { status: "active" }, name: "uniq_active_borrow" },
    ),
  ]);
}
