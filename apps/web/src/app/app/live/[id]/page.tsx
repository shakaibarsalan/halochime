import { notFound } from "next/navigation";
import { getLiveConversation } from "@/lib/live";
import { requireWorkspace } from "@/lib/session";
import { LiveConversationView } from "./live-conversation";

export const metadata = { title: "Live conversation" };

export default async function LiveConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const conversation = id.length <= 128 ? await getLiveConversation(ws.organizationId, ws.user.id, id) : null;
  if (!conversation) notFound();
  return <LiveConversationView initial={conversation} />;
}
