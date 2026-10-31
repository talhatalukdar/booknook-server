import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as service from "../services/books.service";
import { asyncHandler, parseObjectId, requireUser, send } from "../utils/http";
import {
  createBookSchema,
  listBooksQuerySchema,
  updateBookSchema,
} from "../validators/schemas";

export const booksRouter = Router();

// GET /books — public. `?mine=true` additionally requires a valid JWT and scopes to the caller.
booksRouter.get(
  "/",
  (req, res, next) => (req.query.mine === "true" ? requireAuth(req, res, next) : next()),
  asyncHandler(async (req, res) => {
    const query = listBooksQuerySchema.parse(req.query);
    const owner = query.mine === "true" ? requireUser(req).id : undefined;
    const data = await service.listBooks(query, owner);
    send(res, 200, "Books fetched successfully", data);
  }),
);

// GET /books/:id — public.
booksRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const book = await service.getBook(parseObjectId(req.params.id, "book id"));
    send(res, 200, "Book fetched successfully", book);
  }),
);

// POST /books — owner comes from the verified JWT, never from the body.
booksRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createBookSchema.parse(req.body);
    const book = await service.createBook(requireUser(req), input);
    send(res, 201, "Book added successfully", book);
  }),
);

booksRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseObjectId(req.params.id, "book id");
    const input = updateBookSchema.parse(req.body);
    const book = await service.updateBook(id, requireUser(req), input);
    send(res, 200, "Book updated successfully", book);
  }),
);

booksRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await service.deleteBook(parseObjectId(req.params.id, "book id"), requireUser(req));
    send(res, 200, "Book deleted successfully");
  }),
);
