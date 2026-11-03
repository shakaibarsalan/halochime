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
import { trackDelivery } from "@/lib/email/send";
import { appUrl } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

const Input = z.object({ name: z.string().trim().min(2, "Use at least 2 characters.").max(80) });

export async function renameWorkspace(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, role } = await requireWorkspace();
  if (role !== "owner" && role !== "admin") return { error: "Only owners and admins can rename the workspace." };
  const parsed = Input.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    // Through Better Auth so its own permission checks apply too.
    await getAuth().api.updateOrganization({
      body: { organizationId, data: { name: parsed.data.name } },
      headers: await headers(),
    });
  } catch (err) {
    console.error("updateOrganization failed", err);
    return { error: "Could not rename the workspace." };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Team: invites, roles, removal. Every action re-checks the caller's role in the
// active workspace here, then goes through Better Auth, which checks again.

const MANAGER_ROLES = new Set(["owner", "admin"]);

/** `emailed`: whether the invite email went out (the link is shown either way). */
export type InviteState = (ActionState & { link?: string; email?: string; emailed?: boolean }) | null;

function authMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : "";
  if (/already a member/i.test(msg)) return "That person is already a member of this workspace.";
  if (/already invited/i.test(msg)) return "That email already has a pending invite.";
  if (/only owner|without an owner/i.test(msg)) return "A workspace needs at least one owner.";
  if (/limit reached/i.test(msg)) return "This workspace has reached its member or invite limit.";
  if (/not allowed/i.test(msg)) return "You don't have permission to do that.";
  return fallback;
}

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email("Enter a valid email address.")),
  role: z.enum(["admin", "member"], { error: "Choose Admin or Member." }),
});

export async function createInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ws = await requireWorkspace();
  if (!MANAGER_ROLES.has(ws.role)) return { error: "Only owners and admins can invite people." };
  const parsed = InviteInput.safeParse({ email: formData.get("email"), role: formData.get("role") });
  const typed = String(formData.get("email") ?? "").slice(0, 320);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", email: typed };
  if (parsed.data.email === ws.user.email.toLowerCase()) return { error: "You're already in this workspace.", email: typed };

  try {
    const h = await headers();
    // Better Auth emails the invite (lib/auth.ts) and swallows send errors; trackDelivery tells us.
    const { result: inv, sent } = await trackDelivery(() =>
      getAuth().api.createInvitation({
        body: { email: parsed.data.email, role: parsed.data.role, organizationId: ws.organizationId },
        headers: h,
      }),
    );
    revalidatePath("/app/settings");
    return { ok: true, email: inv.email, link: `${appUrl()}/invite/${inv.id}`, emailed: sent > 0 };
  } catch (err) {
    console.error("createInvitation failed", err);
    return { error: authMessage(err, "Could not create the invite."), email: typed };
  }
}

const IdInput = z.string().trim().min(1).max(128);

export async function revokeInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!MANAGER_ROLES.has(ws.role)) return { error: "Only owners and admins can revoke invites." };
  const id = IdInput.safeParse(formData.get("invitationId"));
  if (!id.success) return { error: "Invite not found." };

  const [inv] = await db
    .select({ id: invitation.id, status: invitation.status })
    .from(invitation)
    .where(and(eq(invitation.id, id.data), eq(invitation.organizationId, ws.organizationId)))
    .limit(1);
  if (!inv || inv.status !== "pending") return { error: "That invite is no longer pending." };

  try {
    await getAuth().api.cancelInvitation({ body: { invitationId: inv.id }, headers: await headers() });
  } catch (err) {
    console.error("cancelInvitation failed", err);
    return { error: authMessage(err, "Could not revoke the invite.") };
  }
  revalidatePath("/app/settings");
  return { ok: true, message: "Invite revoked." };
}

/** Member row in the active workspace, plus how many owners it has. */
async function loadTarget(organizationId: string, memberId: string) {
  const rows = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, organizationId));
  const target = rows.find((m) => m.id === memberId);
  const owners = rows.filter((m) => m.role.split(",").includes("owner")).length;
  return { target, owners };
}

const RoleInput = z.object({
  memberId: IdInput,
  role: z.enum(["owner", "admin", "member"], { error: "Choose a role." }),
});

export async function changeMemberRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  if (!MANAGER_ROLES.has(ws.role)) return { error: "Only owners and admins can change roles." };
  const parsed = RoleInput.safeParse({ memberId: formData.get("memberId"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { memberId, role } = parsed.data;

  const { target, owners } = await loadTarget(ws.organizationId, memberId);
  if (!target) return { error: "Member not found." };
  const targetIsOwner = target.role.split(",").includes("owner");
  if (ws.role !== "owner" && (role === "owner" || targetIsOwner))
    return { error: "Only an owner can make someone an owner or change an owner's role." };
  if (targetIsOwner && role !== "owner" && owners <= 1) return { error: "A workspace needs at least one owner." };
  if (target.role === role) return { ok: true };

  try {
    await getAuth().api.updateMemberRole({
      body: { memberId, role, organizationId: ws.organizationId },
      headers: await headers(),
    });
  } catch (err) {
    console.error("updateMemberRole failed", err);
    return { error: authMessage(err, "Could not change the role.") };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Role updated." };
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ws = await requireWorkspace();
  const id = IdInput.safeParse(formData.get("memberId"));
  if (!id.success) return { error: "Member not found." };

  const { target, owners } = await loadTarget(ws.organizationId, id.data);
  if (!target) return { error: "Member not found." };
  const isSelf = target.userId === ws.user.id;
  // Anyone may leave; only owners/admins may remove others.
  if (!isSelf && !MANAGER_ROLES.has(ws.role)) return { error: "Only owners and admins can remove members." };
  const targetIsOwner = target.role.split(",").includes("owner");
  if (targetIsOwner && ws.role !== "owner") return { error: "Only an owner can remove an owner." };
  if (targetIsOwner && owners <= 1) return { error: "A workspace needs at least one owner." };

  try {
    await getAuth().api.removeMember({
      body: { memberIdOrEmail: target.id, organizationId: ws.organizationId },
      headers: await headers(),
    });
  } catch (err) {
    console.error("removeMember failed", err);
    return { error: authMessage(err, "Could not remove the member.") };
  }
  if (isSelf) redirect("/app");
  revalidatePath("/app/settings");
  return { ok: true, message: "Member removed." };
}
