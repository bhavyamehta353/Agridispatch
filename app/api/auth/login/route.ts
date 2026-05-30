import bcrypt from "bcryptjs";
import type { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import {
  authCookieOptions,
  createAuthToken,
  nameKey,
  normalizeName,
  type UserRole,
} from "../../../lib/auth";
import { getMongoDb } from "../../../lib/mongodb";

export const runtime = "nodejs";

type LoginBody = {
  name?: string;
  password?: string;
};

type UserDoc = {
  _id: ObjectId;
  name: string;
  nameKey: string;
  role: UserRole;
  passwordHash: string;
};

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = normalizeName(body.name ?? "");
  const password = body.password ?? "";

  if (!name || !password) {
    return NextResponse.json(
      { error: "Name and password are required." },
      { status: 400 }
    );
  }

  const db = await getMongoDb();
  const candidates = await db
    .collection<UserDoc>("users")
    .find({ nameKey: nameKey(name) })
    .toArray();

  let user: UserDoc | null = null;
  for (const candidate of candidates) {
    const ok = await bcrypt.compare(password, candidate.passwordHash);
    if (ok) {
      user = candidate;
      break;
    }
  }

  if (!user) {
    return NextResponse.json(
      { error: "Invalid login credentials." },
      { status: 401 }
    );
  }

  const token = createAuthToken(user);
  const response = NextResponse.json({
    token,
    user: {
      id: user._id.toHexString(),
      name: user.name,
      role: user.role,
    },
  });
  response.cookies.set("auth_token", token, authCookieOptions);
  return response;
}
