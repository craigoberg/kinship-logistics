import { useEffect } from "react";
import type { CmsNavItem } from "@/lib/api/public-cms";

interface Props {
  nav: CmsNavItem[];
  children: React.ReactNode;
}

/**
 * Bare public chrome for /public/* (no Connect AppShell).
 * Connect forces html.dark — strip it here so forms are readable (dark tokens
 * were painting white text on white cards). Palette mirrors the YADA Facebook
 * / logo look: sky blue, sunshine yellow, charity green on light pages.
 */
export function PublicSiteShell({ nav, children }: Props) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.classList.add("yada-public");
    return () => {
      root.classList.remove("yada-public");
      root.classList.add("dark");
    };
  }, []);

  return (
    <div className="yada-public-shell min-h-screen bg-[#f0f7fb] text-[#0f172a]">
      <header className="border-b border-[#0077a8]/25 bg-[#00a3e0] text-white shadow-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <a href="/public" className="flex items-center gap-2.5">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#f7c948] bg-white text-xs font-extrabold tracking-tight text-[#00a3e0]"
              aria-hidden
            >
              Y
            </span>
            <span className="text-lg font-bold tracking-tight">YADA</span>
          </a>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            {nav.map((n) => (
              <a
                key={n.id}
                href={n.href}
                className="text-white/95 underline-offset-4 hover:underline"
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="h-1.5 bg-gradient-to-r from-[#f7c948] via-[#4caf50] to-[#00a3e0]" />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="mt-12 border-t border-[#00a3e0]/20 bg-white">
        <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-xs text-slate-600">
          <p className="font-medium text-slate-800">
            Young Adults Disabled Association Inc (YADA) — NDIS provider.
          </p>
          <p>
            Operations CRM:{" "}
            <span className="font-medium text-slate-800">connect.yada.org.au</span>{" "}
            · Public site:{" "}
            <span className="font-medium text-slate-800">yada.org.au</span>
          </p>
          <p>
            <a href="/public/policies" className="text-[#0077a8] underline">
              Privacy &amp; policies
            </a>
            {" · "}
            <a
              href="/public/forms/complaint"
              className="text-[#0077a8] underline"
            >
              Make a complaint
            </a>
            {" · "}
            <a
              href="https://www.facebook.com/YoungAdultDisabledAssociation"
              className="text-[#0077a8] underline"
              target="_blank"
              rel="noreferrer"
            >
              Facebook
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
