"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Database, FolderKanban, LayoutDashboard, Logs, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sites", label: "Sites", icon: FolderKanban },
  { href: "/backups", label: "Backups", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings2 },
  { href: "/logs", label: "Logs", icon: Logs }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="panel flex h-full min-h-screen w-full max-w-72 flex-col rounded-none border-r px-5 py-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.24em] text-emerald-300/80">StackPress</p>
        <h1 className="mt-2 text-2xl font-semibold">Self-Hosted WordPress Stack Manager</h1>
        <p className="mt-3 text-sm text-slate-400">
          Homelab-first backups, restores, and scheduling for Docker-based WordPress sites.
        </p>
      </div>

      <nav className="space-y-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                active
                  ? "bg-emerald-400/14 text-emerald-200"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
        <div className="mb-2 flex items-center gap-2 text-slate-200">
          <Activity size={16} />
          <span>Homelab Mode</span>
        </div>
        <p>Single-container deploy today, ready for multi-machine storage and agents later.</p>
      </div>
    </aside>
  );
}
