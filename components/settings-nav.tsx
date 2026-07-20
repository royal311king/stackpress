"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { settingsNavigationItems } from "@/lib/navigation";

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-4" aria-label="Settings sections">
      {settingsNavigationItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("rounded-xl px-4 py-2 text-sm font-medium transition", active
              ? "bg-emerald-400/14 text-emerald-200"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-100")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
