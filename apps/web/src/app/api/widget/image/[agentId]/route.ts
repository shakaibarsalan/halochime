import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentImages } from "@/db/schema";

// The business's own icon picture, loaded by the widget on their site. The URL carries ?v=<version>,
// which changes with every upload, so the picture can be cached for a year.
export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const [image] = await db
    .select({ contentType: agentImages.contentType, data: agentImages.data })
    .from(agentImages)
    .where(eq(agentImages.agentId, agentId))
    .limit(1);
  if (!image) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  return new Response(Buffer.from(image.data, "base64"), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
