import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import {
  authCookieOptions,
  createAuthToken,
  isUserRole,
  nameKey,
  normalizeName,
  type UserRole,
} from "../../../lib/auth";
import { getMongoDb } from "../../../lib/mongodb";

export const runtime = "nodejs";

type SignupBody = {
  name?: string;
  role?: string;
  password?: string;
};

type UserDoc = {
  name: string;
  nameKey: string;
  role: UserRole;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function POST(request: Request) {
  let body: SignupBody;
  try {
    body = (await request.json()) as SignupBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = normalizeName(body.name ?? "");
  const role = body.role ?? "";
  const password = body.password ?? "";

  if (name.length < 2) {
    return NextResponse.json(
      { error: "Name must be at least 2 characters." },
      { status: 400 }
    );
  }
  if (!isUserRole(role)) {
    return NextResponse.json({ error: "Invalid user role." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }

  const db = await getMongoDb();
  const users = db.collection<UserDoc>("users");
  await users.createIndex({ nameKey: 1, role: 1 }, { unique: true });

  const key = nameKey(name);
  const existing = await users.findOne({ nameKey: key, role });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this name and role already exists." },
      { status: 409 }
    );
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 12);
  const inserted = await users.insertOne({
    name,
    nameKey: key,
    role,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  const user = { _id: inserted.insertedId, name, role };
  const token = createAuthToken(user);
  const response = NextResponse.json(
    {
      token,
      user: {
        id: user._id.toHexString(),
        name,
        role,
      },
    },
    { status: 201 }
  );
  response.cookies.set("auth_token", token, authCookieOptions);
  return response;
}
