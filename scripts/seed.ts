/**
 * Safe, repeatable demo-data seeder for BookNook.
 *
 *   npm run seed                      insert missing demo books
 *   npm run seed -- --dry-run         show what would happen, write nothing
 *   npm run seed -- --check-covers    also test that every cover URL is reachable
 *
 * Safety rules:
 *  - Only the `books` collection is written. Users, sessions and borrows are never touched.
 *  - Upsert by (title, author, owner) with $setOnInsert: running it again inserts nothing new
 *    and never overwrites a book you edited, or its stock while copies are borrowed.
 *  - Uses the existing Book shape exactly (no extra fields). ISBNs below are only used to build
 *    the public Open Library cover URL; the schema has no ISBN field, so they are not stored.
 *  - Owner: a neutral "BookNook Library" identity by default, or a real registered user when
 *    SEED_OWNER_EMAIL is set (looked up read-only in the BetterAuth `user` collection).
 */
import type { AnyBulkWriteOperation } from "mongodb";
import { books, closeDb, connectDb } from "../src/config/db";
import { env } from "../src/config/env";
import type { BookDoc, Category } from "../src/types";

interface Seed {
  title: string;
  author: string;
  category: Category;
  isbn: string; // cover lookup only, not stored
  description: string;
  totalCopies: number;
}

const SEEDS: Seed[] = [
  // Fiction
  { title: "Pride and Prejudice", author: "Jane Austen", category: "Fiction", isbn: "9780141439518", totalCopies: 4,
    description: "Elizabeth Bennet and the proud Mr Darcy misjudge each other in Regency England. A sharp, funny novel about manners, money and the cost of first impressions." },
  { title: "Nineteen Eighty-Four", author: "George Orwell", category: "Fiction", isbn: "9780451524935", totalCopies: 3,
    description: "Winston Smith works for the Party that rewrites history and watches every move. A chilling story of surveillance, propaganda and the fragile hope of private thought." },
  { title: "The Hobbit", author: "J. R. R. Tolkien", category: "Fiction", isbn: "9780547928227", totalCopies: 5,
    description: "Bilbo Baggins leaves his quiet hole in the hill to help a company of dwarves reclaim their mountain home. A warm, adventurous prelude to The Lord of the Rings." },
  // Science
  { title: "A Brief History of Time", author: "Stephen Hawking", category: "Science", isbn: "9780553380163", totalCopies: 3,
    description: "From the Big Bang to black holes, Hawking explains how scientists think about space, time and the origin of the universe in language any curious reader can follow." },
  { title: "Cosmos", author: "Carl Sagan", category: "Science", isbn: "9780345539434", totalCopies: 3,
    description: "A tour of the universe and of the people who learned to read it, from ancient astronomers to modern space probes, written with wonder and clarity." },
  { title: "Silent Spring", author: "Rachel Carson", category: "Science", isbn: "9780618249060", totalCopies: 2,
    description: "Carson documents how pesticides move through food chains and harm wildlife. The investigation that helped launch the modern environmental movement." },
  // History
  { title: "Sapiens: A Brief History of Humankind", author: "Yuval Noah Harari", category: "History", isbn: "9780062316097", totalCopies: 4,
    description: "A sweeping account of how Homo sapiens came to dominate the planet, covering the cognitive, agricultural and scientific revolutions and what they did to our lives." },
  { title: "Guns, Germs, and Steel", author: "Jared Diamond", category: "History", isbn: "9780393317558", totalCopies: 2,
    description: "Why did some societies develop powerful technology and deadly germs first? Diamond argues that geography and environment, not biology, shaped the fates of civilisations." },
  { title: "The Diary of a Young Girl", author: "Anne Frank", category: "History", isbn: "9780553296983", totalCopies: 3,
    description: "Anne Frank's diary from the two years she spent hiding in Amsterdam during the Second World War. An honest, observant and deeply human record of growing up." },
  // Kids
  { title: "Where the Wild Things Are", author: "Maurice Sendak", category: "Kids", isbn: "9780060254926", totalCopies: 4,
    description: "Max sails away to an island of wild things and becomes their king, until he remembers where he is loved best. A picture-book classic about imagination and home." },
  { title: "Charlotte's Web", author: "E. B. White", category: "Kids", isbn: "9780064400558", totalCopies: 4,
    description: "Wilbur the pig is saved by a clever spider who writes messages in her web. A gentle story about friendship, loyalty and the seasons of life on a farm." },
  { title: "Matilda", author: "Roald Dahl", category: "Kids", isbn: "9780142410370", totalCopies: 3,
    description: "Matilda is a gifted girl with neglectful parents and a terrifying headmistress. She finds books, courage and a small amount of magic. Funny, sharp and full of heart." },
  // Others
  { title: "Atomic Habits", author: "James Clear", category: "Others", isbn: "9780735211292", totalCopies: 5,
    description: "A practical guide to building good habits and breaking bad ones through small, consistent changes, with clear strategies for designing your environment and routines." },
  { title: "The Psychology of Money", author: "Morgan Housel", category: "Others", isbn: "9780857197689", totalCopies: 3,
    description: "Nineteen short stories on how people think about money. Housel shows that behaviour matters more than intelligence when it comes to saving, spending and investing." },
  { title: "Deep Work", author: "Cal Newport", category: "Others", isbn: "9781455586691", totalCopies: 3,
    description: "Newport argues that the ability to focus without distraction is increasingly rare and valuable, and lays out rules for training it in a noisy, always-connected world." },
];

const cover = (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
const has = (flag: string) => process.argv.includes(flag);

async function resolveOwner(db: Awaited<ReturnType<typeof connectDb>>) {
  const email = process.env.SEED_OWNER_EMAIL?.trim();
  if (!email) {
    return { id: "booknook-library", name: "BookNook Library", email: "library@booknook.example" };
  }
  // BetterAuth stores users in the `user` collection; the id used in JWTs is the _id as a string.
  const user = await db.collection("user").findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new Error(`No registered user with email "${email}". Register first, or unset SEED_OWNER_EMAIL.`);
  }
  return { id: String(user._id), name: String(user.name ?? email), email: String(user.email) };
}

async function checkCovers() {
  console.log("\nChecking cover URLs...");
  let bad = 0;
  for (const s of SEEDS) {
    try {
      const res = await fetch(cover(s.isbn), { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15_000) });
      const ok = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
      if (!ok) bad++;
      console.log(`  ${ok ? "ok     " : "MISSING"} ${res.status}  ${s.title}`);
    } catch (e) {
      bad++;
      console.log(`  ERROR   ${s.title}: ${(e as Error).message}`);
    }
  }
  console.log(bad ? `${bad} cover(s) not reachable. The app shows a typographic fallback cover for those.` : "All covers reachable.");
}

async function main() {
  const dryRun = has("--dry-run");
  const db = await connectDb();
  const owner = await resolveOwner(db);

  console.log(`Database : ${env.dbName}`);
  console.log(`Owner    : ${owner.name} <${owner.email}>`);
  console.log(`Mode     : ${dryRun ? "DRY RUN (nothing will be written)" : "write (missing books only)"}\n`);

  // Stagger addedAt so "newest first" has a stable, realistic order (first item = newest).
  const base = Date.now();
  const ops: AnyBulkWriteOperation<BookDoc>[] = SEEDS.map((s, i) => {
    const at = new Date(base - i * 60 * 60 * 1000);
    return {
      updateOne: {
        filter: { title: s.title, author: s.author, addedByUserId: owner.id },
        update: {
          $setOnInsert: {
            category: s.category,
            image: cover(s.isbn),
            description: s.description,
            addedByName: owner.name,
            addedByEmail: owner.email,
            totalCopies: s.totalCopies,
            availableCopies: s.totalCopies,
            addedAt: at,
            updatedAt: at,
          },
        },
        upsert: true,
      },
    };
  });

  if (dryRun) {
    const existing = await books().countDocuments({
      $or: SEEDS.map((s) => ({ title: s.title, author: s.author, addedByUserId: owner.id })),
    });
    console.log(`Would insert ${SEEDS.length - existing} new book(s); ${existing} already present.`);
  } else {
    const res = await books().bulkWrite(ops, { ordered: false });
    console.log(`Inserted ${res.upsertedCount} new book(s); skipped ${SEEDS.length - res.upsertedCount} already present.`);
    console.log(`Total books in "${env.dbName}": ${await books().countDocuments()}`);
  }

  if (has("--check-covers")) await checkCovers();
}

main()
  .catch((err) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
