import Link from "next/link";
import { cx } from "./ui";

export type SidebarBrand = { name: string; logoUrl: string | null };

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** White label: the agency's logo and name where the Halochime logo usually sits in the dashboard. */
export function AgencyBrand({ brand, className }: { brand: SidebarBrand; className?: string }) {
  return (
    <Link
      href="/app"
      aria-label={`${brand.name} home`}
      className={cx(
        "inline-flex min-w-0 max-w-full items-center gap-2.5 rounded-lg text-[17px] font-semibold leading-none tracking-tight text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600",
        className,
      )}
    >
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="size-7 shrink-0 rounded-[8px] bg-white object-contain ring-1 ring-slate-200" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-slate-900 text-[11px] font-semibold text-white" aria-hidden>
          {initials(brand.name)}
        </span>
      )}
      <span className="min-w-0 truncate" title={brand.name}>
        {brand.name}
      </span>
    </Link>
  );
}
