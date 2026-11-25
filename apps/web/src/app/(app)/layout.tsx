import Link from "next/link";
import { Activity, Gauge, KeyRound, Layers, PlayCircle, ScrollText, Settings2, Users } from "lucide-react";
import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/runs/new", label: "New automation", icon: PlayCircle },
  { href: "/batches", label: "Batch sign-ups", icon: Layers },
  { href: "/runs", label: "Submission history", icon: Activity },
  { href: "/profiles", label: "Profiles", icon: Users },
  { href: "/admin/api-keys", label: "API keys", icon: KeyRound },
  { href: "/admin/policy", label: "Policy & guardrails", icon: Settings2 },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/30 p-4 md:block">
        <div className="mb-6 px-2 text-lg font-semibold">FormAgent</div>
        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        <form className="mt-8 px-2" action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
          <p className="truncate text-xs text-muted-foreground">{session?.user?.email}</p>
          <button className="mt-1 text-xs underline">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
