import { and, desc, eq, gt, sql } from "drizzle-orm";
import { ArrowLeft, Users } from "lucide-react";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ButtonLink } from "@/components/ui";
import { db } from "@/db";
import { invitation, organization } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { hasWorkspace, ownsWorkspace } from "@/lib/workspaces";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Workspace" };

export default async function OnboardingPage() {
  const session = await requireUser();
  // Someone invited them: offer that first, so they don't make a workspace they don't need.
  const invites = await db
    .select({ id: invitation.id, orgName: organization.name })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(
      and(
        eq(sql`lower(${invitation.email})`, session.user.email.toLowerCase()),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitation.createdAt))
    .limit(3);

  // Already in a workspace: this is "New workspace" from the dashboard's workspace menu.
  const [existing, owner] = await Promise.all([hasWorkspace(session.user.id), ownsWorkspace(session.user.id)]);
  if (existing) {
    return (
      <AuthShell>
        <ButtonLink href="/app" variant="ghost" size="sm" className="-ml-2">
          <ArrowLeft className="size-4" aria-hidden />
          Back to dashboard
        </ButtonLink>
        <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-slate-900">New workspace</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          A workspace has its own agents, knowledge, team, voice minutes and billing. Use one for each business or
          website you want to keep separate. We will create its first agent.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {owner
            ? "Only your first workspace comes with free minutes, so this one starts with no voice minutes. Text chat is free."
            : "It comes with free trial minutes for voice."}
        </p>
        <OnboardingForm />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1.5 pr-3 text-xs font-medium text-slate-600 shadow-xs">
        <span className="grid size-4 place-items-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">1</span>
        One last step
      </p>
      <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-slate-900">
        Welcome, <span className="break-words">{session.user.name}</span>
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Name your workspace after your business. We will create your first agent and add free trial minutes.
      </p>
      {invites.length > 0 ? (
        <div className="mt-8 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Users className="size-4 text-brand-600" aria-hidden />
            You have {invites.length === 1 ? "an invite" : "invites"} waiting
          </p>
          <ul className="mt-3 space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-slate-700" title={i.orgName}>
                  {i.orgName}
                </span>
                <ButtonLink href={`/invite/${i.id}`} size="sm">
                  Open invite
                </ButtonLink>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-slate-500">Joining your team? Open the invite instead of creating a new workspace.</p>
        </div>
      ) : null}
      <OnboardingForm />
    </AuthShell>
  );
}
