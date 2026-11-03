import { and, eq } from "drizzle-orm";
import { Clock, MailCheck, MailX, ShieldAlert, Users } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth-shell";
import { ButtonLink } from "@/components/ui";
import { db } from "@/db";
import { invitation, member, organization, user } from "@/db/schema";
import { getSession } from "@/lib/session";
import { AcceptDecline, SignOutButton } from "./invite-actions";

export const metadata: Metadata = { title: "Workspace invite", robots: { index: false, follow: false } };

const ROLE_LABEL: Record<string, string> = { owner: "an owner", admin: "an admin", member: "a member" };

/** "member@talkfront.test" -> "m•••@talkfront.test", so a forwarded link doesn't show the full address. */
function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

function Message({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof Users;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div>
      <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
        <Icon className="size-5" />
      </span>
      <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-slate-900">{title}</h1>
      {children ? <div className="mt-3 space-y-2 text-sm leading-6 text-slate-500">{children}</div> : null}
      {action ? <div className="mt-8 space-y-3">{action}</div> : null}
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = rawId.slice(0, 128);
  const session = await getSession();

  const [inv] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      orgName: organization.name,
      inviterName: user.name,
      inviterEmail: user.email,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, id))
    .limit(1);

  const home = session ? (
    <ButtonLink href="/app" size="lg" className="w-full">
      Go to dashboard
    </ButtonLink>
  ) : (
    <ButtonLink href="/sign-in" size="lg" className="w-full">
      Sign in
    </ButtonLink>
  );

  if (!inv) {
    return (
      <AuthShell>
        <Message icon={ShieldAlert} title="Invite not found" action={home}>
          <p>This invite link isn't valid. Check you copied the whole link, or ask for a new one.</p>
        </Message>
      </AuthShell>
    );
  }

  const workspace = <span className="font-medium text-slate-800">{inv.orgName}</span>;
  const inviter = inv.inviterName || inv.inviterEmail || "A teammate";
  const signedInEmail = session?.user.email.toLowerCase();
  const isRecipient = signedInEmail === inv.email.toLowerCase();

  // Already used: show the friendly version to the person it was for.
  if (inv.status === "accepted") {
    return (
      <AuthShell>
        <Message icon={MailCheck} title="Invite already used" action={home}>
          <p>This invite to {workspace} has already been accepted.{isRecipient ? " You're in." : ""}</p>
        </Message>
      </AuthShell>
    );
  }
  if (inv.status === "canceled") {
    return (
      <AuthShell>
        <Message icon={MailX} title="Invite revoked" action={home}>
          <p>This invite to {workspace} was revoked. Ask {inviter} for a new one if you still need access.</p>
        </Message>
      </AuthShell>
    );
  }
  if (inv.status === "rejected") {
    return (
      <AuthShell>
        <Message icon={MailX} title="Invite declined" action={home}>
          <p>This invite to {workspace} was declined. Ask {inviter} for a new one if you change your mind.</p>
        </Message>
      </AuthShell>
    );
  }
  if (inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) {
    return (
      <AuthShell>
        <Message icon={Clock} title="Invite expired" action={home}>
          <p>This invite to {workspace} has expired. Ask {inviter} to send a new link.</p>
        </Message>
      </AuthShell>
    );
  }

  const intro = (
    <p>
      <span className="font-medium text-slate-800">{inviter}</span> invited you to join {workspace} on Halochime as{" "}
      {ROLE_LABEL[inv.role ?? "member"] ?? "a member"}.
    </p>
  );
  const next = encodeURIComponent(`/invite/${inv.id}`);

  if (!session) {
    return (
      <AuthShell>
        <Message
          icon={Users}
          title={`Join ${inv.orgName}`}
          action={
            <>
              <ButtonLink href={`/sign-up?next=${next}`} size="lg" className="w-full">
                Create an account
              </ButtonLink>
              <ButtonLink href={`/sign-in?next=${next}`} variant="secondary" size="lg" className="w-full">
                I already have an account
              </ButtonLink>
            </>
          }
        >
          {intro}
          <p>
            This invite is for <span className="font-medium text-slate-800">{maskEmail(inv.email)}</span>. Sign up or sign in
            with that email address to accept it.
          </p>
        </Message>
      </AuthShell>
    );
  }

  if (!isRecipient) {
    return (
      <AuthShell>
        <Message
          icon={ShieldAlert}
          title="This invite is for someone else"
          action={
            <>
              <SignOutButton label="Sign out and switch account" />
              <ButtonLink href="/app" variant="secondary" size="lg" className="w-full">
                Back to dashboard
              </ButtonLink>
            </>
          }
        >
          <p>
            You're signed in as <span className="break-all font-medium text-slate-800">{session.user.email}</span>, but this
            invite to {workspace} is for <span className="font-medium text-slate-800">{maskEmail(inv.email)}</span>.
          </p>
          <p>Sign out, then sign in or sign up with the invited email to accept it.</p>
        </Message>
      </AuthShell>
    );
  }

  const [already] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, inv.organizationId), eq(member.userId, session.user.id)))
    .limit(1);

  return (
    <AuthShell>
      <Message icon={Users} title={`Join ${inv.orgName}`} action={<AcceptDecline invitationId={inv.id} />}>
        {intro}
        {already ? <p>You're already a member of this workspace. Accepting just opens it.</p> : null}
        <p>
          Signed in as <span className="break-all font-medium text-slate-800">{session.user.email}</span>.
        </p>
      </Message>
    </AuthShell>
  );
}
