import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as service from "../services/borrows.service";
import { asyncHandler, parseObjectId, requireUser, send } from "../utils/http";
import { borrowSchema } from "../validators/schemas";

export const borrowsRouter = Router();
borrowsRouter.use(requireAuth);

borrowsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = borrowSchema.parse(req.body);
    const bookId = parseObjectId(input.bookId, "book id");
    const result = await service.borrowBook(requireUser(req), bookId, input.returnDate);
    send(res, 201, "Book borrowed successfully", result);
  }),
);

// Always scoped to the verified caller; there is no way to ask for someone else's records.
borrowsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await service.listUserBorrows(requireUser(req).id);
    send(res, 200, "Borrows fetched successfully", items);
  }),
);

borrowsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await service.returnBorrow(
      requireUser(req),
      parseObjectId(req.params.id, "borrow id"),
    );
    send(res, 200, "Book returned successfully", result);
  }),
);
