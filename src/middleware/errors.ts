import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { HttpError } from "../utils/http";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? "Invalid request";
    return res.status(400).json({
      success: false,
      message,
      errors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Malformed JSON body" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large" });
  }
  if (!env.isProd) console.error(err);
  else console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
  res.status(500).json({ success: false, message: "Internal server error" });
};
