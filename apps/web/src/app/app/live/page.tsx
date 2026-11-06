import { PageHeader } from "@/components/ui";
import { listLive } from "@/lib/live";
import { requireWorkspace } from "@/lib/session";
import { LiveList } from "./live-list";

export const metadata = { title: "Live" };

export default async function LivePage() {
  const ws = await requireWorkspace();
  const rows = await listLive(ws.organizationId, ws.user.id);
  return (
    <>
      <PageHeader title="Live" description="Conversations happening now. Open one to watch it, or take it over and reply yourself." />
      <LiveList initial={rows} />
    </>
  );
}
