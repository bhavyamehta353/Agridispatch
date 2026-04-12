import { AuditViewClient } from "./audit-view-client";

export default async function BatchAuditPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  return (
    <div className="min-h-full bg-zinc-100 text-zinc-900">
      <AuditViewClient recordId={recordId} />
    </div>
  );
}
