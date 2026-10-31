import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";
import { setKeyResolver } from "../src/middleware/auth";

const ISS = "http://localhost:3000";

let privateKey: KeyLike;
let otherPrivateKey: KeyLike;

export async function initKeys() {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  const other = await generateKeyPair("EdDSA", { extractable: true });
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "EdDSA" };
  setKeyResolver(createLocalJWKSet({ keys: [jwk] }));
}

interface TokenOpts {
  id: string;
  email?: string;
  name?: string;
  exp?: string | number;
  issuer?: string;
  audience?: string;
  forgedWithOtherKey?: boolean;
}

export async function makeToken(o: TokenOpts) {
  return new SignJWT({ id: o.id, email: o.email ?? `${o.id}@test.dev`, name: o.name ?? o.id })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setSubject(o.id)
    .setIssuedAt()
    .setIssuer(o.issuer ?? ISS)
    .setAudience(o.audience ?? ISS)
    .setExpirationTime(o.exp ?? "15m")
    .sign(o.forgedWithOtherKey ? otherPrivateKey : privateKey);
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export const validBook = {
  title: "The Pragmatic Programmer",
  author: "Andrew Hunt",
  category: "Science",
  image: "https://i.ibb.co/example/cover.jpg",
  description: "A classic guide to craftsmanship in software engineering and design.",
  totalCopies: 2,
};

export const dayFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
