"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/analyze", label: "Analyze" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/scanner", label: "Scanner" },
  { href: "/performance", label: "Performance" },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[rgba(8,11,17,0.78)] backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          prefetch={false}
          className="group flex items-center gap-2"
          aria-label="Finsight dashboard"
        >
          <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)] shadow-[0_0_18px_rgba(59,130,246,0.8)]" />
          <span className="text-lg font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            Fin<span className="gradient-text">Sight</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                )}
              >
                {link.label}
                {active ? (
                  <span className="absolute inset-x-3 -bottom-[1px] h-[1px] bg-[var(--accent-primary)]" />
                ) : null}
              </Link>
            );
          })}
        </div>

        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:border-[#2E3D52] hover:text-[var(--text-primary)] md:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          <span className="mono text-lg">{open ? "×" : "≡"}</span>
        </button>
      </nav>

      {open ? (
        <motion.div
          className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-4 md:hidden"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-1">
            {links.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </motion.div>
      ) : null}
    </header>
  );
}
