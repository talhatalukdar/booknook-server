import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ObjectId } from "mongodb";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Authentication required") => new HttpError(401, m);
export const forbidden = (m = "You do not have permission to perform this action") =>
  new HttpError(403, m);
export const notFound = (m = "Resource not found") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function send<T>(res: Response, status: number, message: string, data?: T) {
  return res.status(status).json({ success: true, message, data: data ?? null });
}

export function parseObjectId(id: unknown, label = "id"): ObjectId {
  if (typeof id !== "string" || !ObjectId.isValid(id) || new ObjectId(id).toHexString() !== id) {
    throw badRequest(`Invalid ${label}`);
  }
  return new ObjectId(id);
}

export function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}
