import { cookies } from "next/headers";
import { verifyAuthToken, type UserRole } from "../../lib/auth";
import { RecommendationClient } from "./recommendation-client";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const session = token ? verifyAuthToken(token) : null;
  const userRole: UserRole | null = session?.role ?? null;

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <RecommendationClient recordId={recordId} userRole={userRole} />
    </div>
  );
}
