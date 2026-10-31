import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../config/env";
import { unauthorized } from "../utils/http";

/**
 * BetterAuth's JWT plugin signs tokens (EdDSA by default) and publishes the public keys at
 * /api/auth/jwks. We verify signature, expiry, issuer, audience and algorithm here.
 */
const ALLOWED_ALGS = ["EdDSA", "ES256", "RS256"];

let resolver: JWTVerifyGetKey | null = null;

function getResolver(): JWTVerifyGetKey {
  resolver ??= createRemoteJWKSet(new URL(env.jwt.jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return resolver;
}

/** Test seam: inject a local JWKS instead of fetching one over the network. */
export function setKeyResolver(r: JWTVerifyGetKey | null) {
  resolver = r;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !/^Bearer\s+\S+$/i.test(header)) {
      throw unauthorized("Missing or malformed Authorization header");
    }
    const token = header.split(/\s+/)[1] as string;

    const { payload } = await jwtVerify(token, getResolver(), {
      algorithms: ALLOWED_ALGS,
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    });

    const id = (typeof payload.id === "string" && payload.id) || payload.sub;
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!id || !email) throw unauthorized("Token does not contain a valid user identity");

    req.user = {
      id,
      email,
      name: typeof payload.name === "string" && payload.name ? payload.name : email.split("@")[0]!,
      image: typeof payload.image === "string" ? payload.image : undefined,
    };
    next();
  } catch (err) {
    if (err instanceof errors.JWTExpired) return next(unauthorized("Token has expired"));
    if (err instanceof errors.JOSEError) return next(unauthorized("Invalid token"));
    next(err);
  }
}
