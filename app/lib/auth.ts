import { createHmac, timingSafeEqual } from "crypto";
import type { ObjectId } from "mongodb";

export const USER_ROLES = ["admin", "farmers", "logistics"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type AuthTokenPayload = {
  sub: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
};

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function secret() {
  const value =
    process.env.JWT_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.MONGODB_URL;
  if (!value) {
    throw new Error("Missing JWT_SECRET or MONGODB_URL environment variable.");
  }
  return value;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signPart(data: string): string {
  return base64Url(createHmac("sha256", secret()).update(data).digest());
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

export function isUserRole(role: string): role is UserRole {
  return (USER_ROLES as readonly string[]).includes(role);
}

export function createAuthToken(user: {
  _id: ObjectId;
  name: string;
  role: UserRole;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AuthTokenPayload = {
    sub: user._id.toHexString(),
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`;
  return `${unsigned}.${signPart(unsigned)}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = signPart(unsigned);
  const actual = parts[2];
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as AuthTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!isUserRole(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const authCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TOKEN_TTL_SECONDS,
};
