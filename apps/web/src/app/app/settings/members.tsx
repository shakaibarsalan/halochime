"use client";

import { Link2, LogOut, MailCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { CopyButton, SubmitButton, type ActionState } from "@/components/form-bits";
import { Button, Field, Input, Notice, Select, cx } from "@/components/ui";
import { changeMemberRole, createInvite, removeMember, revokeInvite, type InviteState } from "./actions";

export function InviteForm() {
  const [state, action] = useActionState<InviteState, FormData>(createInvite, null);
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label="Email" htmlFor="invite-email">
            <Input
              key={state?.ok ? "sent" : (state?.email ?? "")}
              id="invite-email"
              name="email"
              type="email"
              required
              maxLength={320}
              autoComplete="off"
              placeholder="teammate@business.com"
              defaultValue={state?.ok ? "" : (state?.email ?? "")}
            />
          </Field>
        </div>
        <div className="sm:w-40">
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
        <SubmitButton pendingLabel="Sending...">
          <UserPlus aria-hidden />
          Send invite
        </SubmitButton>
      </form>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok && state.link ? <InviteLinkBox email={state.email ?? ""} link={state.link} emailed={Boolean(state.emailed)} /> : null}
      <p className="text-xs leading-5 text-slate-500">
        Admins can invite people and manage members. Members can use the dashboard but not change the team.
      </p>
    </div>
  );
}

function InviteLinkBox({ email, link, emailed }: { email: string; link: string; emailed: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const title = emailed ? `Invite emailed to ${email}` : `Invite link for ${email}`;
  return (
    <div
      className={cx("rounded-xl border p-4", emailed ? "border-brand-100 bg-brand-50/50" : "border-amber-200 bg-amber-50/60")}
      role="status"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
        {emailed ? (
          <MailCheck className="size-4 shrink-0 text-brand-600" aria-hidden />
        ) : (
          <Link2 className="size-4 shrink-0 text-amber-600" aria-hidden />
        )}
        <span className="min-w-0 truncate" title={title}>
          {title}
        </span>
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          ref={inputRef}
          readOnly
          value={link}
          aria-label="Invite link"
          title={link}
          className="min-w-0 flex-1 bg-white font-mono text-xs"
          onFocus={() => inputRef.current?.select()}
        />
        <CopyButton text={link} label="Copy link" />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        {emailed
          ? "They can accept from the email, or you can share this link yourself. "
          : "We couldn't send the invite email, so send this link to them yourself. "}
        It only works for someone signed in with <span className="break-all font-medium text-slate-800">{email}</span>.
      </p>
    </div>
  );
}

function InlineError({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="mt-1 max-w-56 text-xs font-medium text-red-600">
      {state.error}
    </p>
  );
}

function RoleSelectInner({ role, allowOwner, label }: { role: string; allowOwner: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Select
      name="role"
      defaultValue={role}
      aria-label={label}
      disabled={pending}
      aria-busy={pending}
      className="h-8 w-32 text-xs"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {allowOwner || role === "owner" ? <option value="owner">Owner</option> : null}
      <option value="admin">Admin</option>
      <option value="member">Member</option>
    </Select>
  );
}

export function MemberRoleControl({
  memberId,
  role,
  allowOwner,
  name,
}: {
  memberId: string;
  role: string;
  allowOwner: boolean;
  name: string;
}) {
  const [state, action] = useActionState(changeMemberRole, null);
  return (
    <form action={action}>
      <input type="hidden" name="memberId" value={memberId} />
      {/* key: snaps back to the saved role if the change was refused. */}
      <RoleSelectInner key={`${role}-${state?.error ?? ""}`} role={role} allowOwner={allowOwner} label={`Role for ${name}`} />
      <InlineError state={state} />
      {state?.ok && state.message ? <span className="sr-only" role="status">{state.message}</span> : null}
    </form>
  );
}

function ConfirmButton({
  children,
  variant = "ghost",
  label,
}: {
  children: React.ReactNode;
  variant?: "ghost" | "danger";
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      title={label}
      className={cx(variant === "ghost" && "text-slate-500 hover:text-red-700")}
    >
      {children}
    </Button>
  );
}

export function RemoveMemberButton({ memberId, name, self }: { memberId: string; name: string; self: boolean }) {
  const [state, action] = useActionState(removeMember, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const q = self ? "Leave this workspace? You will lose access until someone invites you again." : `Remove ${name} from this workspace?`;
        if (!window.confirm(q)) e.preventDefault();
      }}
    >
      <input type="hidden" name="memberId" value={memberId} />
      <ConfirmButton label={self ? "Leave workspace" : `Remove ${name}`}>
        {self ? <LogOut aria-hidden /> : <UserMinus aria-hidden />}
        <span className="max-sm:sr-only">{self ? "Leave" : "Remove"}</span>
      </ConfirmButton>
      <InlineError state={state} />
    </form>
  );
}

export function InviteRowActions({ invitationId, email, link }: { invitationId: string; email: string; link: string }) {
  const [state, action] = useActionState(revokeInvite, null);
  return (
    <div className="flex items-center justify-end gap-1.5">
      <CopyButton text={link} label="Copy link" />
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm(`Revoke the invite for ${email}? The link will stop working.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="invitationId" value={invitationId} />
        <ConfirmButton label={`Revoke invite for ${email}`}>
          <X aria-hidden />
          <span className="max-sm:sr-only">Revoke</span>
        </ConfirmButton>
      </form>
      <InlineError state={state} />
    </div>
  );
}
