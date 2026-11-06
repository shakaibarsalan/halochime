import { and, asc, desc, eq } from "drizzle-orm";
import { Building2, MailPlus, Paintbrush, TriangleAlert, Users } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr, Truncate } from "@/components/ui";
import { db } from "@/db";
import { invitation, member, user, wallets, workspaceBranding } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";
import { BrandingForm } from "./branding-form";
import { DeleteWorkspaceForm } from "./delete-workspace";
import { InviteForm, InviteRowActions, MemberRoleControl, RemoveMemberButton } from "./members";
import { WebhooksSection } from "./webhooks-section";
import { WorkspaceNameForm } from "./workspace-form";

export const metadata = { title: "Settings" };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const roleLabel = (r: string | null) => (r ? r.split(",").map((x) => ROLE_LABEL[x.trim()] ?? x).join(", ") : "Member");
const isOwner = (r: string) => r.split(",").includes("owner");

export default async function SettingsPage() {
  const ws = await requireWorkspace();
  const canManage = ws.role === "owner" || ws.role === "admin";
  const canDelete = isOwner(ws.role);

  const [members, invites, [wallet], [branding]] = await Promise.all([
    db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        joinedAt: member.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ws.organizationId))
      .orderBy(asc(member.createdAt)),
    db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .where(and(eq(invitation.organizationId, ws.organizationId), eq(invitation.status, "pending")))
      .orderBy(desc(invitation.createdAt)),
    canDelete
      ? db.select({ balance: wallets.balanceSeconds }).from(wallets).where(eq(wallets.organizationId, ws.organizationId))
      : Promise.resolve([]),
    // White label: owners only.
    canDelete
      ? db
          .select({
            poweredBy: workspaceBranding.poweredBy,
            poweredByLabel: workspaceBranding.poweredByLabel,
            poweredByUrl: workspaceBranding.poweredByUrl,
            brandName: workspaceBranding.brandName,
            logoVersion: workspaceBranding.logoVersion,
          })
          .from(workspaceBranding)
          .where(eq(workspaceBranding.organizationId, ws.organizationId))
      : Promise.resolve([]),
  ]);

  const owners = members.filter((m) => isOwner(m.role)).length;
  const now = Date.now();
  const base = appUrl();

  return (
    <>
      <PageHeader title="Settings" description="Your workspace, the people in it and where its events go." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Workspace" icon={Building2} description="Your agents use this as the business name." />
          <div className="p-5">
            <WorkspaceNameForm name={ws.organizationName} canEdit={canManage} />
          </div>
        </Card>

        <Card id="members">
          <CardHeader
            title="Members"
            icon={Users}
            description={canManage ? "Invite teammates and choose what they can do." : "People in this workspace. Only owners and admins can change the team."}
          />
          {canManage ? (
            <div className="border-b border-slate-100 p-5">
              <InviteForm />
            </div>
          ) : null}
          <Table minWidth={canManage ? 760 : 640}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Joined</Th>
                {canManage ? (
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === ws.user.id;
                const targetOwner = isOwner(m.role);
                const lastOwner = targetOwner && owners <= 1;
                // Admins can't touch owners; nobody can demote or remove the last owner.
                const canTouch = canManage && (ws.role === "owner" || !targetOwner) && !lastOwner;
                return (
                  <Tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white" aria-hidden>
                          {(m.name || m.email).slice(0, 1).toUpperCase()}
                        </span>
                        <Truncate text={m.name} className="font-medium text-slate-900" />
                        {self ? <Badge tone="gray">You</Badge> : null}
                      </div>
                    </Td>
                    <Td>
                      <Truncate text={m.email} />
                    </Td>
                    <Td>
                      {canTouch ? (
                        <MemberRoleControl memberId={m.id} role={m.role} allowOwner={ws.role === "owner"} name={m.name || m.email} />
                      ) : (
                        <Badge tone={targetOwner ? "blue" : "gray"} dot>
                          {roleLabel(m.role)}
                        </Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(m.joinedAt)}</Td>
                    {canManage ? (
                      <Td className="text-right">
                        {canTouch ? (
                          <div className="flex justify-end">
                            <RemoveMemberButton memberId={m.id} name={m.name || m.email} self={self} />
                          </div>
                        ) : lastOwner ? (
                          <span className="text-xs text-slate-400" title="A workspace needs at least one owner.">
                            Only owner
                          </span>
                        ) : null}
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card id="invites">
          <CardHeader
            title="Pending invites"
            icon={MailPlus}
            description={canManage ? "Links that haven't been used yet. Revoke one to stop it working." : "Invites that haven't been accepted yet."}
          />
          {invites.length === 0 ? (
            <EmptyState title="No pending invites">
              {canManage ? "Create an invite above and send the link to your teammate." : null}
            </EmptyState>
          ) : (
            <Table minWidth={canManage ? 760 : 560}>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Invited</Th>
                  <Th>Expires</Th>
                  {canManage ? (
                    <Th className="text-right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const expired = i.expiresAt.getTime() < now;
                  return (
                    <Tr key={i.id}>
                      <Td>
                        <Truncate text={i.email} className="font-medium text-slate-900" />
                      </Td>
                      <Td>
                        <Badge tone="gray" dot>
                          {roleLabel(i.role)}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDateTime(i.createdAt)}</Td>
                      <Td className="whitespace-nowrap">
                        {expired ? (
                          <Badge tone="amber" dot>
                            Expired
                          </Badge>
                        ) : (
                          formatDateTime(i.expiresAt)
                        )}
                      </Td>
                      {canManage ? (
                        <Td className="text-right">
                          {/* Links are only rendered for owners/admins. */}
                          <InviteRowActions invitationId={i.id} email={i.email} link={`${base}/invite/${i.id}`} />
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <WebhooksSection organizationId={ws.organizationId} canManage={canManage} />

        {canDelete ? (
          <Card id="white-label">
            <CardHeader
              title="White label"
              icon={Paintbrush}
              description="For agencies: hide the Halochime line in the widget or show your own, and put your brand in this dashboard. Only owners see this."
            />
            <div className="p-5">
              <BrandingForm
                values={{
                  poweredBy: branding?.poweredBy ?? "halochime",
                  poweredByLabel: branding?.poweredByLabel ?? "",
                  poweredByUrl: branding?.poweredByUrl ?? "",
                  brandName: branding?.brandName ?? "",
                  logoUrl: branding?.logoVersion
                    ? `/api/branding/logo?org=${encodeURIComponent(ws.organizationId)}&v=${branding.logoVersion}`
                    : null,
                  saved: Boolean(branding),
                }}
              />
            </div>
          </Card>
        ) : null}

        {canDelete ? (
          <Card id="delete-workspace">
            <CardHeader
              title="Delete workspace"
              icon={TriangleAlert}
              tone="danger"
              description="Permanently delete this workspace and everything in it. Only owners see this."
            />
            <div className="p-5">
              <DeleteWorkspaceForm
                name={ws.organizationName}
                balance={wallet && wallet.balance > 0 ? formatMinutes(wallet.balance) : null}
              />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
