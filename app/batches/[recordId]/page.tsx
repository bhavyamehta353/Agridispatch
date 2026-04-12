import { RecommendationClient } from "./recommendation-client";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <RecommendationClient recordId={recordId} />
    </div>
  );
}
