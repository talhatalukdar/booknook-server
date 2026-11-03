# BookNook Server

**BookNook – A Small Online Library**

BookNook Server is the backend API for the BookNook online library application, built with Express.js, TypeScript and MongoDB. It manages books, borrowing records, stock availability, JWT verification and ownership.

## Live Deployment

- **Live API:** https://booknook-server-2ciu.onrender.com
- **Health Check:** https://booknook-server-2ciu.onrender.com/health
- **Books API:** https://booknook-server-2ciu.onrender.com/books
- **Server Repository:** https://github.com/talhatalukdar/booknook-server
- **Client Repository:** https://github.com/talhatalukdar/booknook-client
- **Live Website:** https://booknook-client-olive.vercel.app/

> The free Render plan sleeps when idle, so the first request after a pause can take up to about a minute.

## Features

- RESTful API with Express.js and TypeScript.
- MongoDB integration with indexes for efficient queries.
- Book CRUD with server-side ownership checks.
- JWT verification of BetterAuth tokens through JWKS.
- Borrow and return with atomic stock management.
- Duplicate-borrow prevention enforced by a unique partial index.
- Borrowing history is preserved (returns change status, records are not deleted).
- Request validation with Zod; unknown fields are rejected.
- Centralised error handling, Helmet, CORS allowlist and rate limiting.
- Demo-book seed script.
- Automated tests with Vitest and Supertest.

## Technology Stack

Node.js, Express.js, TypeScript, MongoDB Native Driver, MongoDB Atlas, Zod, jose, Helmet, CORS, express-rate-limit, Vitest, Supertest, ESLint, Prettier.

## API Documentation

Base URL: `https://booknook-server-2ciu.onrender.com`

All responses use the same envelope:

```json
{ "success": true, "message": "Books fetched successfully", "data": {} }
```

Errors:

```json
{ "success": false, "message": "A meaningful error message" }
```

Validation errors also include an `errors` array of `{ field, message }`.

### Public Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/books` | List books (search, filter, sort, paginate) |
| GET | `/books/:id` | Get one book |
| GET | `/health` | Health check |

### Protected Book Endpoints (JWT required)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/books` | Add a book (owner comes from the token) |
| PATCH | `/books/:id` | Update your own book |
| DELETE | `/books/:id` | Delete your own book (blocked while copies are borrowed) |

`POST` and `PATCH` accept only: `title`, `author`, `category`, `image` (https URL), `description`, `totalCopies`.

### Protected Borrow Endpoints (JWT required)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/borrows` | Borrow a book. Body: `{ "bookId": "...", "returnDate": "YYYY-MM-DD" }` (1 to 30 days ahead) |
| GET | `/borrows` | Your own borrow records, newest first, with an `overdue` flag |
| DELETE | `/borrows/:id` | Return a borrowed book |

### Books Query Parameters

- `q`: search by title or author.
- `category`: `Fiction`, `Science`, `History`, `Kids` or `Others`.
- `sort`: `newest` (default), `oldest` or `title`.
- `page` and `limit` (maximum 50).
- `mine=true`: only the authenticated user's books (requires a JWT).

Example: `GET /books?limit=6&sort=newest`

### Status Codes

200 success, 201 created, 400 invalid request, 401 missing/invalid/expired token, 403 not the owner, 404 not found, 409 conflict (no copies left, already borrowed, already returned, copies on loan), 429 rate limited, 500 server error.

## Authentication and JWT Verification

BetterAuth runs in the Next.js client. This server only verifies the tokens it issues.

1. A user signs in through BetterAuth.
2. BetterAuth's JWT plugin signs a token (EdDSA, 15 minutes).
3. The client gets it with `authClient.token()` and sends `Authorization: Bearer <token>`.
4. Express verifies it with `jose` against the JWKS endpoint.
5. Signature, expiry, issuer, audience and allowed algorithms are checked; `alg: none` is rejected.
6. The verified `id`, `email` and `name` are attached to the request.

Identity is never taken from the request body or query string.

JWKS endpoint (derived from `BETTER_AUTH_URL`):

```text
https://booknook-client-olive.vercel.app/api/auth/jwks
```

Issuer and audience default to `BETTER_AUTH_URL`, so it must match the client's value exactly (no trailing slash).

## Database Design

### Books Collection

| Field | Description |
|---|---|
| `_id` | Book identifier |
| `title`, `author`, `category`, `image`, `description` | Book information |
| `addedByUserId`, `addedByName`, `addedByEmail` | Owner (from the verified token) |
| `totalCopies` | Total copies |
| `availableCopies` | Copies currently on the shelf |
| `addedAt`, `updatedAt` | Timestamps |

### Borrows Collection

| Field | Description |
|---|---|
| `_id` | Borrow record identifier |
| `bookId`, `bookTitle`, `bookImage` | Book reference and snapshot |
| `userId`, `userName`, `userEmail` | Borrower |
| `borrowDate`, `returnDate` | Loan dates |
| `status` | `active` or `returned` |
| `returnedAt`, `createdAt` | Timestamps |

BetterAuth manages its own collections (users, sessions, JWKS) through its MongoDB adapter.

Indexes created on startup: `books.addedAt`, `books.category`, `books.addedByUserId`, `borrows.{userId,status}`, `borrows.{bookId,status}` and a unique partial index on `borrows.{userId,bookId}` where `status = "active"`.

## Stock Consistency

- Borrowing inserts the record (the unique partial index blocks a second active borrow), then atomically decrements stock only while `availableCopies > 0`.
- Returning flips `active` to `returned` in one atomic update; only the winning request restores stock, capped at `totalCopies`.
- Editing `totalCopies` is recomputed in a single atomic update and can never drop below the copies on loan.
- A book can be deleted only when every copy is on the shelf.

## Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

```env
PORT=5000
NODE_ENV=development

MONGODB_URI=
DB_NAME=booknook

CLIENT_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000

# Optional overrides. Leave these lines commented out unless you need them
# (an empty value is rejected). Defaults: JWKS = BETTER_AUTH_URL/api/auth/jwks,
# issuer = audience = BETTER_AUTH_URL.
# JWT_JWKS_URL=
# JWT_ISSUER=
# JWT_AUDIENCE=
```

Production (Render):

```env
NODE_ENV=production
CLIENT_URL=https://booknook-client-olive.vercel.app
BETTER_AUTH_URL=https://booknook-client-olive.vercel.app
```

`CLIENT_URL` accepts a comma-separated list of allowed origins. Never commit real credentials.

## Installation and Local Development

```bash
git clone https://github.com/talhatalukdar/booknook-server.git
cd booknook-server
npm install
cp .env.example .env   # then fill in MONGODB_URI
npm run dev
```

The API runs at http://localhost:5000.

### Quality checks

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` runs 29 tests. The 14 JWT tests need no database; the 15 book and borrow integration tests (ownership, double borrow, stock, duplicate return) run only when a MongoDB instance is provided:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
```

### Production build

```bash
npm run build
npm start
```

## Demo Data

Run this against a **local or empty** database. It matches books by title, author and owner, so running it on a database that already has the same titles under a different owner adds duplicates.

```bash
npm run seed                      # insert missing demo books
npm run seed -- --dry-run         # preview only
npm run seed -- --check-covers    # test the cover URLs
SEED_OWNER_EMAIL=you@example.com npm run seed   # own the books as a registered user
```

The script reads the same `.env`, writes only to the `books` collection, never touches users, sessions or borrows, and never overwrites a book that was edited.

## Deployment

The backend is deployed on Render.

- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/health`

The build command uses `--include=dev` because Render sets `NODE_ENV=production`, which would otherwise skip the TypeScript compiler and type packages needed by `npm run build`.

Required environment variables: `MONGODB_URI`, `DB_NAME`, `CLIENT_URL`, `BETTER_AUTH_URL`, `NODE_ENV`.

MongoDB Atlas Network Access must allow the Render service to connect.

## Security

- JWT signature, expiry, issuer, audience and algorithm validation with JWKS public keys.
- Ownership enforced inside the database queries, not only in code.
- Strict Zod schemas (no mass assignment) and ObjectId validation.
- Helmet headers, CORS origin allowlist, global and write rate limits.
- Generic 500 responses in production, with no stack traces or secrets.

## Related Repository

BookNook Frontend: https://github.com/talhatalukdar/booknook-client

## License

This project was developed as part of Programming Hero Assignment 08.