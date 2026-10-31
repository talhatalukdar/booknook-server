import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { bearer, initKeys, makeToken, validBook } from "./helpers";

const app = createApp();

// These cases are rejected by the JWT middleware before any database access.
describe("JWT verification", () => {
  beforeAll(initKeys);

  const protectedCalls = [
    () => request(app).post("/books").send(validBook),
    () => request(app).patch("/books/64b7f0f4f4d3a2b1c0e9d8a7").send({ title: "x y" }),
    () => request(app).delete("/books/64b7f0f4f4d3a2b1c0e9d8a7"),
    () => request(app).post("/borrows").send({}),
    () => request(app).get("/borrows"),
    () => request(app).delete("/borrows/64b7f0f4f4d3a2b1c0e9d8a7"),
    () => request(app).get("/books?mine=true"),
  ];

  it.each(protectedCalls.map((c, i) => [i, c] as const))(
    "rejects protected call #%i without a token (401)",
    async (_i, call) => {
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    },
  );

  it("rejects a malformed Authorization header", async () => {
    const res = await request(app).get("/borrows").set("Authorization", "Token abc");
    expect(res.status).toBe(401);
  });

  it("rejects garbage tokens", async () => {
    const res = await request(app).get("/borrows").set(bearer("not.a.jwt"));
    expect(res.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const t = await makeToken({ id: "u1", exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await request(app).get("/borrows").set(bearer(t));
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  it("rejects tokens signed with an unknown key (forged signature)", async () => {
    const t = await makeToken({ id: "u1", forgedWithOtherKey: true });
    const res = await request(app).get("/borrows").set(bearer(t));
    expect(res.status).toBe(401);
  });

  it("rejects wrong issuer and wrong audience", async () => {
    const badIss = await makeToken({ id: "u1", issuer: "https://evil.example" });
    const badAud = await makeToken({ id: "u1", audience: "https://evil.example" });
    expect((await request(app).get("/borrows").set(bearer(badIss))).status).toBe(401);
    expect((await request(app).get("/borrows").set(bearer(badAud))).status).toBe(401);
  });

  it("rejects an unsigned (alg=none) token", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = `${b64({ alg: "none", typ: "JWT" })}.${b64({ id: "u1", email: "a@b.c", sub: "u1" })}.`;
    const res = await request(app).get("/borrows").set(bearer(t));
    expect(res.status).toBe(401);
  });

  it("serves the public health route and unknown routes return 404 JSON", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
