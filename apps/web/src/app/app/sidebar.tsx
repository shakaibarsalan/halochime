"use client";

import {
  BookOpen,
  Bot,
  Check,
  ChevronsUpDown,
  Code2,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Plus,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { cx } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/app/agents", label: "Agents", icon: Bot },
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/app/install", label: "Install", icon: Code2 },
  { href: "/app/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/app/handoffs", label: "Handoffs", icon: Inbox },
];

const NAV_BOTTOM: typeof NAV = [
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

const initials = (s: string) =>
  s
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

function UserMenu({ userEmail, onSignOut }: { userEmail: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open ? (
        <div
          id="user-menu"
          role="menu"
          className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lift"
        >
          <p className="truncate px-3 py-2 text-xs text-slate-500" title={userEmail}>
            Signed in as <span className="font-medium text-slate-700">{userEmail}</span>
          </p>
          <div className="my-1 h-px bg-slate-100" />
          <Link
            href="/app/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
          >
            <Settings className="size-4 text-slate-400" aria-hidden />
            Workspace settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
          >
            <LogOut className="size-4 text-slate-400" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? "user-menu" : undefined}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-900/[0.04] focus-visible:outline-2 focus-visible:outline-brand-600",
          open && "bg-slate-900/[0.04]",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white" aria-hidden>
          {initials(userEmail.split("@")[0] ?? userEmail)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900" title={userEmail}>
            {userEmail}
          </span>
          <span className="block text-xs text-slate-500">Account</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-slate-400" aria-hidden />
      </button>
    </div>
  );
}

function WorkspaceBadge({ name }: { name: string }) {
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-[11px] font-semibold text-white"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Workspace menu: switch between the user's workspaces, or start a new one. */
function WorkspaceSwitcher({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const { data: orgs } = authClient.useListOrganizations();
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = orgs ?? [];
  // The server falls back to the first workspace when none is active; match by name in that case.
  const activeId =
    list.find((o) => o.id === session?.session.activeOrganizationId)?.id ?? list.find((o) => o.name === workspaceName)?.id;

  const label = (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Workspace</p>
      <p className="truncate text-sm font-semibold text-slate-900" title={workspaceName}>
        {workspaceName}
      </p>
    </div>
  );

  async function choose(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setError(null);
    setSwitching(id);
    const { error } = await authClient.organization.setActive({ organizationId: id });
    setSwitching(null);
    if (error) {
      setError("Could not switch workspace.");
      return;
    }
    setOpen(false);
    router.push("/app");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? "workspace-menu" : undefined}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-2.5 py-2 text-left shadow-xs transition-colors hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          open && "border-slate-300",
        )}
      >
        <WorkspaceBadge name={workspaceName} />
        {label}
        <ChevronsUpDown className="size-4 shrink-0 text-slate-400" aria-hidden />
        <span className="sr-only">Workspace menu</span>
      </button>
      {open ? (
        <div
          id="workspace-menu"
          role="menu"
          aria-label="Workspaces"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lift [scrollbar-width:none]"
        >
          <p className="px-3 py-2 text-xs text-slate-500">{list.length > 1 ? "Switch workspace" : "Workspace"}</p>
          {list.map((o) => {
            const current = o.id === activeId;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                disabled={switching !== null}
                onClick={() => choose(o.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none disabled:opacity-60"
              >
                <WorkspaceBadge name={o.name} />
                <span className={cx("min-w-0 flex-1 truncate", current && "font-medium text-slate-900")} title={o.name}>
                  {o.name}
                </span>
                {switching === o.id ? (
                  <span className="text-xs text-slate-400">Switching...</span>
                ) : current ? (
                  <Check className="size-4 shrink-0 text-brand-600" aria-hidden />
                ) : null}
              </button>
            );
          })}
          {error ? (
            <p role="alert" className="px-3 py-2 text-xs font-medium text-red-600">
              {error}
            </p>
          ) : null}
          <div className="my-1 border-t border-slate-100" role="none" />
          <Link
            href="/onboarding"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-500" aria-hidden>
              <Plus className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">New workspace</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  workspaceName,
  userEmail,
  openHandoffs = 0,
}: {
  workspaceName: string;
  userEmail: string;
  openHandoffs?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  const link = (item: (typeof NAV)[number]) => {
    const active = isActive(item.href, item.exact);
    const count = item.href === "/app/handoffs" ? openHandoffs : 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-600",
          active
            ? "bg-white text-slate-900 shadow-soft ring-1 ring-slate-200/80"
            : "text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900",
        )}
      >
        <item.icon
          className={cx("size-4 shrink-0", active ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600")}
          aria-hidden
        />
        <span className="flex-1">{item.label}</span>
        {count > 0 ? (
          <span className="rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-semibold tabular-nums text-amber-800">
            <span className="sr-only">, </span>
            {count}
            <span className="sr-only"> open</span>
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {/* Phone / tablet top bar: one line. */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200/80 bg-canvas/90 px-4 backdrop-blur-md lg:hidden">
        <Logo href="/app" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="dashboard-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xs hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 top-14 z-20 bg-slate-900/20 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      ) : null}

      <aside
        id="dashboard-nav"
        className={cx(
          "z-20 flex-col border-r border-slate-200/80 bg-[#f6f5f2]",
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:top-14 max-lg:w-72 max-lg:shadow-lift",
          "lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0",
          open ? "flex" : "hidden",
        )}
      >
        <div className="hidden px-4 pb-2 pt-5 lg:block">
          <Logo href="/app" className="px-1" />
        </div>

        <div className="px-3 pt-4 lg:pt-3">
          <WorkspaceSwitcher workspaceName={workspaceName} />
        </div>

        <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
          {NAV.map(link)}
          <div className="mt-auto flex flex-col gap-0.5 pt-4">{NAV_BOTTOM.map(link)}</div>
        </nav>

        <div className="border-t border-slate-200/80 p-3">
          <UserMenu userEmail={userEmail} onSignOut={signOut} />
        </div>
      </aside>
    </>
  );
}
