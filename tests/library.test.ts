import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { books, borrows, closeDb, connectDb } from "../src/config/db";
import { bearer, dayFromNow, initKeys, makeToken, validBook } from "./helpers";

// Needs a real MongoDB. Run with: TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
const run = process.env.TEST_MONGODB_URI ? describe : describe.skip;

run("books & borrows (MongoDB)", () => {
  const app = createApp();
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    await initKeys();
    await connectDb();
    alice = await makeToken({ id: "alice", name: "Alice" });
    bob = await makeToken({ id: "bob", name: "Bob" });
  });
  afterAll(async () => {
    await books().drop().catch(() => undefined);
    await borrows().drop().catch(() => undefined);
    await closeDb();
  });
  beforeEach(async () => {
    await books().deleteMany({});
    await borrows().deleteMany({});
  });

  const addBook = async (token = alice, over: object = {}) =>
    (await request(app).post("/books").set(bearer(token)).send({ ...validBook, ...over })).body.data;
  const stock = async (id: string) => (await request(app).get(`/books/${id}`)).body.data;

  it("creates a book with owner from the JWT, ignoring client-supplied identity", async () => {
    const res = await request(app)
      .post("/books")
      .set(bearer(alice))
      .send({ ...validBook, addedByEmail: "evil@x.dev" });
    expect(res.status).toBe(400); // strict schema rejects unknown keys
    const ok = await request(app).post("/books").set(bearer(alice)).send(validBook);
    expect(ok.status).toBe(201);
    expect(ok.body.data.addedByUserId).toBe("alice");
    expect(ok.body.data.availableCopies).toBe(validBook.totalCopies);
  });

  it("validates input and ObjectIds", async () => {
    expect((await request(app).post("/books").set(bearer(alice)).send({ ...validBook, totalCopies: 0 })).status).toBe(400);
    expect((await request(app).get("/books/not-an-id")).status).toBe(400);
    expect((await request(app).get("/books/64b7f0f4f4d3a2b1c0e9d8a7")).status).toBe(404);
  });

  it("lists, searches, filters, paginates and returns latest 6 newest-first", async () => {
    for (let i = 0; i < 8; i++) {
      await addBook(alice, { title: `Book number ${i}`, category: i % 2 ? "Fiction" : "Science" });
    }
    const latest = await request(app).get("/books?limit=6&sort=newest");
    expect(latest.body.data.items).toHaveLength(6);
    expect(latest.body.data.items[0].title).toBe("Book number 7");
    expect(latest.body.data.pagination.total).toBe(8);
    const fic = await request(app).get("/books?category=Fiction");
    expect(fic.body.data.items.every((b: { category: string }) => b.category === "Fiction")).toBe(true);
    const q = await request(app).get("/books?q=number 3");
    expect(q.body.data.items).toHaveLength(1);
  });

  it("my books only returns the caller's books", async () => {
    await addBook(alice);
    await addBook(bob, { title: "Bob's book" });
    const res = await request(app).get("/books?mine=true").set(bearer(alice));
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].addedByUserId).toBe("alice");
  });

  it("User A cannot edit or delete User B's book (403)", async () => {
    const book = await addBook(alice);
    const edit = await request(app).patch(`/books/${book._id}`).set(bearer(bob)).send({ title: "Hijacked" });
    expect(edit.status).toBe(403);
    expect((await request(app).delete(`/books/${book._id}`).set(bearer(bob))).status).toBe(403);
    expect((await stock(book._id)).title).toBe(validBook.title);
  });

  it("owner cannot change ownership or stock fields through PATCH", async () => {
    const book = await addBook(alice);
    for (const body of [{ addedByUserId: "bob" }, { availableCopies: 99 }, { addedAt: "2000-01-01" }]) {
      expect((await request(app).patch(`/books/${book._id}`).set(bearer(alice)).send(body)).status).toBe(400);
    }
  });

  it("borrow decreases stock by exactly one; return restores it by exactly one", async () => {
    const book = await addBook(alice, { totalCopies: 3 });
    const b = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: book._id, returnDate: dayFromNow(7) });
    expect(b.status).toBe(201);
    expect((await stock(book._id)).availableCopies).toBe(2);

    const r = await request(app).delete(`/borrows/${b.body.data.borrow._id}`).set(bearer(bob));
    expect(r.status).toBe(200);
    expect((await stock(book._id)).availableCopies).toBe(3);
  });

  it("prevents double borrow, including simultaneous requests", async () => {
    const book = await addBook(alice, { totalCopies: 5 });
    const payload = { bookId: book._id, returnDate: dayFromNow(5) };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => request(app).post("/borrows").set(bearer(bob)).send(payload)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect((await stock(book._id)).availableCopies).toBe(4);
  });

  it("refuses to borrow when no copies are available; stock never goes negative", async () => {
    const book = await addBook(alice, { totalCopies: 1 });
    const carol = await makeToken({ id: "carol" });
    const payload = { bookId: book._id, returnDate: dayFromNow(3) };
    const settled = await Promise.all(
      [bob, carol, alice].map((t) => request(app).post("/borrows").set(bearer(t)).send(payload)),
    );
    expect(settled.filter((r) => r.status === 201)).toHaveLength(1);
    expect(settled.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await stock(book._id)).availableCopies).toBe(0);
    expect(await borrows().countDocuments({ status: "active" })).toBe(1);
  });

  it("validates the return date window (1 to 30 days)", async () => {
    const book = await addBook(alice);
    for (const d of [0, -2, 31]) {
      const res = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: book._id, returnDate: dayFromNow(d) });
      expect(res.status).toBe(400);
    }
  });

  it("duplicate returns do not increase stock twice", async () => {
    const book = await addBook(alice, { totalCopies: 2 });
    const b = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: book._id, returnDate: dayFromNow(4) });
    const id = b.body.data.borrow._id;
    const rs = await Promise.all([1, 2, 3].map(() => request(app).delete(`/borrows/${id}`).set(bearer(bob))));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    const after = await stock(book._id);
    expect(after.availableCopies).toBe(2);
    expect(after.availableCopies).toBeLessThanOrEqual(after.totalCopies);
  });

  it("User A cannot see or return User B's borrows", async () => {
    const book = await addBook(alice);
    const b = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: book._id, returnDate: dayFromNow(4) });
    const list = await request(app).get("/borrows").set(bearer(alice));
    expect(list.body.data).toHaveLength(0);
    expect((await request(app).delete(`/borrows/${b.body.data.borrow._id}`).set(bearer(alice))).status).toBe(403);
    expect((await stock(book._id)).availableCopies).toBe(validBook.totalCopies - 1);
  });

  it("history is preserved after return and my-borrows is newest first", async () => {
    const b1 = await addBook(alice, { title: "First book here" });
    const b2 = await addBook(alice, { title: "Second book here" });
    const r1 = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: b1._id, returnDate: dayFromNow(3) });
    await request(app).post("/borrows").set(bearer(bob)).send({ bookId: b2._id, returnDate: dayFromNow(3) });
    await request(app).delete(`/borrows/${r1.body.data.borrow._id}`).set(bearer(bob));
    const list = (await request(app).get("/borrows").set(bearer(bob))).body.data;
    expect(list).toHaveLength(2);
    expect(list[0].bookTitle).toBe("Second book here");
    expect(list[1].status).toBe("returned");
    // can borrow again after returning
    const again = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: b1._id, returnDate: dayFromNow(3) });
    expect(again.status).toBe(201);
  });

  it("blocks deleting a book with active borrows; allows after return", async () => {
    const book = await addBook(alice);
    const b = await request(app).post("/borrows").set(bearer(bob)).send({ bookId: book._id, returnDate: dayFromNow(3) });
    expect((await request(app).delete(`/books/${book._id}`).set(bearer(alice))).status).toBe(409);
    await request(app).delete(`/borrows/${b.body.data.borrow._id}`).set(bearer(bob));
    expect((await request(app).delete(`/books/${book._id}`).set(bearer(alice))).status).toBe(200);
  });

  it("totalCopies edits keep inventory consistent with active borrows", async () => {
    const book = await addBook(alice, { totalCopies: 3 });
    await request(app).post("/borrows").set(bearer(bob)).send({ bookId: book._id, returnDate: dayFromNow(3) });
    await request(app).post("/borrows").set(bearer(await makeToken({ id: "dan" }))).send({ bookId: book._id, returnDate: dayFromNow(3) });
    expect((await request(app).patch(`/books/${book._id}`).set(bearer(alice)).send({ totalCopies: 1 })).status).toBe(409);
    const ok = await request(app).patch(`/books/${book._id}`).set(bearer(alice)).send({ totalCopies: 5 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.totalCopies).toBe(5);
    expect(ok.body.data.availableCopies).toBe(3);
    expect(ok.body.data.addedByUserId).toBe("alice");
  });
});
