import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  DB_NAME: z.string().min(1).default("booknook"),
  CLIENT_URL: z.string().min(1).default("http://localhost:3000"),
  BETTER_AUTH_URL: z.string().url(),
  JWT_JWKS_URL: z.string().url().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const e = parsed.data;
const base = e.BETTER_AUTH_URL.replace(/\/+$/, "");

export const env = {
  port: e.PORT,
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === "production",
  mongoUri: e.MONGODB_URI,
  dbName: e.DB_NAME,
  clientOrigins: e.CLIENT_URL.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
  jwt: {
    jwksUrl: e.JWT_JWKS_URL ?? `${base}/api/auth/jwks`,
    issuer: e.JWT_ISSUER ?? base,
    audience: e.JWT_AUDIENCE ?? base,
  },
};
