"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/form-bits";
import { db } from "@/db";
import { invitation, member } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";

const IdInput = z.string().trim().min(1).max(128);

/** The pending, unexpired invite addressed to the signed-in user, or an error message. */
async function loadOwnInvite(raw: FormDataEntryValue | null) {
  const session = await getSession();
  if (!session) return { error: "Sign in first." } as const;
  const id = IdInput.safeParse(raw);
  if (!id.success) return { error: "This invite link is not valid." } as const;
  const [inv] = await db.select().from(invitation).where(eq(invitation.id, id.data)).limit(1);
  if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now())
    return { error: "This invite is no longer valid." } as const;
  if (inv.email.toLowerCase() !== session.user.email.toLowerCase())
    return { error: "This invite is for a different email address." } as const;
  return { session, inv } as const;
}

export async function acceptInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const r = await loadOwnInvite(formData.get("invitationId"));
  if ("error" in r) return { error: r.error };
  const { session, inv } = r;
  const auth = getAuth();
  const h = await headers();

  const [already] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, inv.organizationId), eq(member.userId, session.user.id)))
    .limit(1);

  try {
    if (already) {
      // Joined some other way; don't create a second membership. Close the invite instead.
      await auth.api.rejectInvitation({ body: { invitationId: inv.id }, headers: h });
    } else {
      await auth.api.acceptInvitation({ body: { invitationId: inv.id }, headers: h });
    }
    await auth.api.setActiveOrganization({ body: { organizationId: inv.organizationId }, headers: h });
  } catch (err) {
    console.error("acceptInvitation failed", err);
    const msg = err instanceof Error ? err.message : "";
    return { error: /limit reached/i.test(msg) ? "This workspace is full. Ask its owner for help." : "Could not accept the invite. Please try again." };
  }
  redirect("/app");
}

export async function declineInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const r = await loadOwnInvite(formData.get("invitationId"));
  if ("error" in r) return { error: r.error };
  try {
    await getAuth().api.rejectInvitation({ body: { invitationId: r.inv.id }, headers: await headers() });
  } catch (err) {
    console.error("rejectInvitation failed", err);
    return { error: "Could not decline the invite. Please try again." };
  }
  revalidatePath(`/invite/${r.inv.id}`);
  return { ok: true };
}
