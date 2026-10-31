import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { booksRouter } from "./routes/books.routes";
import { borrowsRouter } from "./routes/borrows.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render sits behind a proxy

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow non-browser clients (no Origin header) and the configured allowlist only.
        if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
        cb(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "50kb" }));

  const limiterOpts = { standardHeaders: true, legacyHeaders: false } as const;
  app.use(
    rateLimit({
      ...limiterOpts,
      windowMs: 15 * 60_000,
      limit: env.nodeEnv === "test" ? 10_000 : 600,
      message: { success: false, message: "Too many requests, please try again later" },
    }),
  );
  const writeLimiter = rateLimit({
    ...limiterOpts,
    windowMs: 60_000,
    limit: env.nodeEnv === "test" ? 10_000 : 40,
    message: { success: false, message: "Too many write requests, slow down" },
    skip: (req) => req.method === "GET",
  });

  app.get("/health", (_req, res) => {
    res.json({ success: true, message: "BookNook API is running", data: null });
  });
  app.use("/books", writeLimiter, booksRouter);
  app.use("/borrows", writeLimiter, borrowsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
