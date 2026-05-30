import { NextResponse, type NextRequest } from "next/server";

type UserRole = "admin" | "farmers" | "logistics";

const allowedPrefixes: Record<UserRole, string[]> = {
  admin: ["/batches", "/farmer", "/pricing", "/traffic"],
  farmers: ["/batches", "/farmer", "/pricing"],
  logistics: ["/batches", "/pricing", "/traffic"],
};

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlToText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function authSecret(): string | null {
  return (
    process.env.JWT_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.MONGODB_URL ??
    null
  );
}

function isRole(value: unknown): value is UserRole {
  return value === "admin" || value === "farmers" || value === "logistics";
}

async function verifyRole(token: string): Promise<UserRole | null> {
  const secret = authSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const unsigned = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(unsigned)
  );
  if (bytesToBase64Url(signature) !== parts[2]) return null;

  try {
    const payload = JSON.parse(base64UrlToText(parts[1])) as {
      role?: unknown;
      exp?: unknown;
    };
    if (!isRole(payload.role)) return null;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload.role;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get("auth_token")?.value;
  const role = token ? await verifyRole(token) : null;

  if (!role) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const allowed = allowedPrefixes[role].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!allowed) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/batches/:path*", "/farmer/:path*", "/pricing/:path*", "/traffic/:path*"],
};
