# BookNook Server

Express + TypeScript + MongoDB API for **BookNook – A Small Online Library**. It verifies the JWTs
issued by BetterAuth (running in the Next.js client) and owns all book and borrow data.

- Client repository: `booknook-client` (Next.js + BetterAuth)
- Live API: _add the Render URL here after deployment_

## Tech stack

Node.js 20+, Express 4, TypeScript (strict), MongoDB native driver, Zod, jose (JWT/JWKS), Helmet,
CORS allowlist, express-rate-limit, Vitest + Supertest, ESLint, Prettier.

## API

All responses: `{ "success": boolean, "message": string, "data"?: any }`.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| GET | `/books` | public | List books. Query: `q`, `category`, `sort` (`newest`/`oldest`/`title`), `page`, `limit` (max 50), `mine=true` (needs JWT, only your books). Latest six: `/books?limit=6&sort=newest` |
| GET | `/books/:id` | public | One book (400 invalid id, 404 missing) |
| POST | `/books` | JWT | Add a book. Owner and `addedAt` come from the server, `availableCopies = totalCopies` |
| PATCH | `/books/:id` | JWT, owner | Update title, author, category, image, description, totalCopies |
| DELETE | `/books/:id` | JWT, owner | Delete; 409 while any copy is borrowed |
| POST | `/borrows` | JWT | Body `{ bookId, returnDate }` (1 to 30 days ahead) |
| GET | `/borrows` | JWT | Only the caller's records, newest first, with `overdue` flag |
| DELETE | `/borrows/:id` | JWT, borrower | Return a book (history kept, `status: returned`) |

`GET /health` is an extra liveness probe used by Render.

Status codes: 200, 201, 400 validation, 401 bad/missing/expired token, 403 not the owner,
404 not found, 409 conflict (no copies, already borrowed, already returned, copies on loan).

## Authentication flow

1. The client signs in with BetterAuth (email/password or Google) and gets a JWT from the
   BetterAuth JWT plugin (`authClient.token()`), sent as `Authorization: Bearer <token>`.
2. `src/middleware/auth.ts` verifies it with `jose` against BetterAuth's JWKS
   (`<BETTER_AUTH_URL>/api/auth/jwks`): signature, expiry, issuer, audience and allowed
   algorithms (`EdDSA`, `ES256`, `RS256`; `none` is rejected).
3. The user (`id`, `email`, `name`) is read from the verified payload and attached to `req.user`.
   Identity is never taken from the request body or query.

The BetterAuth JWT plugin must include `id`, `email` and `name` in the payload
(`jwt({ jwt: { definePayload: ({ user }) => ({ id: user.id, email: user.email, name: user.name, image: user.image }) } })`).
Issuer and audience default to `BETTER_AUTH_URL`, the plugin default.

## Database

`books`: `_id, title, author, category, image, description, addedByUserId, addedByName,
addedByEmail, totalCopies, availableCopies, addedAt, updatedAt`

`borrows`: `_id, bookId, bookTitle, bookImage, userId, userName, userEmail, borrowDate,
returnDate, status (active | returned), returnedAt, createdAt`

Indexes (created on startup): `books.addedAt desc`, `books.category`, `books.addedByUserId`,
`borrows.{userId,status}`, `borrows.{bookId,status}`, and a **unique partial index**
`borrows.{userId,bookId}` where `status = "active"` (database-level no-double-borrow).
BetterAuth manages its own collections through its MongoDB adapter.

## Stock consistency

- Borrow: insert the borrow (unique partial index blocks duplicates), then atomically
  `$inc availableCopies: -1` where `availableCopies > 0`; if sold out the borrow is removed.
- Return: atomic `active -> returned` flip; only the winning request restores stock, capped at
  `totalCopies`, so repeated returns cannot double count.
- Edit total copies: recomputed inside one atomic update, never below copies on loan.
- Delete: only when `availableCopies == totalCopies`.

## Environment variables

See `.env.example`: `PORT`, `NODE_ENV`, `MONGODB_URI`, `DB_NAME`, `CLIENT_URL` (comma-separated
allowed origins), `BETTER_AUTH_URL`, optional `JWT_JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`.

## Local development

```bash
npm install
cp .env.example .env     # fill MONGODB_URI etc.
npm run dev              # http://localhost:5000
npm run typecheck && npm run lint
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test   # JWT tests run without a database
```

## Demo data (seed)

An empty database shows empty pages. To load 15 realistic demo books (3 per category) with
public Open Library cover URLs:

```bash
npm run seed                    # inserts only the books that are missing
npm run seed -- --dry-run       # preview, writes nothing
npm run seed -- --check-covers  # also test that every cover URL is reachable
SEED_OWNER_EMAIL=you@example.com npm run seed   # own the books as a registered user
```

It reads the same `.env` as the server, writes only to `books`, never touches users, sessions or
borrows, and is safe to re-run (existing or edited books are left alone). By default the books
belong to a neutral "BookNook Library" owner, so nobody can edit or delete them; set
`SEED_OWNER_EMAIL` to a registered account to manage them from My Books.

## Deployment (Render)

1. New Web Service from this repo (`render.yaml` is included): build `npm ci && npm run build`,
   start `npm start`, health check `/health`.
2. Set `MONGODB_URI`, `CLIENT_URL` (your Vercel URL, no trailing slash) and `BETTER_AUTH_URL`
   (the same Vercel URL).
3. In MongoDB Atlas Network Access allow Render's outbound IPs (or `0.0.0.0/0` for an assignment).

## Security

Helmet, CORS allowlist, global and write rate limits, strict Zod schemas (unknown fields are
rejected, preventing mass assignment), ObjectId validation, ownership checks in the database
filters, generic 500 responses with no stack traces in production, no secrets in the repo.
