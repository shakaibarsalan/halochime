"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { handoffRequests } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";

const Input = z.object({ id: z.string().min(1), status: z.enum(["open", "closed"]) });

export async function setHandoffStatus(formData: FormData) {
  const { organizationId } = await requireWorkspace();
  const parsed = Input.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return;
  await db
    .update(handoffRequests)
    .set({ status: parsed.data.status })
    .where(and(eq(handoffRequests.id, parsed.data.id), eq(handoffRequests.organizationId, organizationId)));
  revalidatePath("/app/handoffs");
  revalidatePath("/app");
}
