"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const CENTER_NAV = [
  { href: "/#pool-search", label: "Pool IQ", description: "Browse and analyze pools" },
  { href: "/lab/trajectory-3d", label: "Pool Lab", description: "Advanced visualizations and insights" },
] as const;

const RIGHT_NAV = [
  { href: "/docs", label: "Docs", description: "Methodology, architecture, API, and data model" },
] as const;

const INTEGRATE_LINK = {
  href: "/integrate",
  label: "Integrate",
  description: "Integrate TRAXR liquidity intelligence into your product",
} as const;

const DOC_PATHS = ["/docs", "/methodology", "/architecture", "/api-preview", "/data-model"];

function isActivePath(pathname: string, href: string) {
  if (href === "/docs") {
    return DOC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  }
  if (href === "/#pool-search") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  pathname,
  description,
  onClick,
  activeOverride,
  mobile = false,
}: {
  href: string;
  label: string;
  pathname: string;
  description?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  activeOverride?: boolean;
  mobile?: boolean;
}) {
  const active = typeof activeOverride === "boolean" ? activeOverride : isActivePath(pathname, href);

  return (
    <Link
      href={href}
      onClick={onClick}
      title={description}
      className={[
        "transition",
        mobile
          ? "flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm uppercase tracking-[0.18em]"
          : "inline-flex items-center rounded-full border px-3 py-2 text-[0.72rem] uppercase tracking-[0.18em]",
        active
          ? "border-cyan-300/35 bg-cyan-400/10 text-cyan-100"
          : "border-white/8 text-white/62 hover:border-white/14 hover:bg-white/5 hover:text-white/88",
      ].join(" ")}
    >
      <span className={mobile ? "flex flex-col gap-1" : ""}>
        <span>{label}</span>
        {mobile && description ? (
          <span className="text-[0.62rem] normal-case tracking-[0.02em] text-white/46">
            {description}
          </span>
        ) : null}
      </span>
      {mobile && <span className="text-white/28">›</span>}
    </Link>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [poolIqActive, setPoolIqActive] = useState(false);

  useEffect(() => {
    if (pathname !== "/") {
      setPoolIqActive(false);
      return;
    }
    const updatePoolIq = () => {
      const target = document.getElementById("pool-search");
      if (!target) {
        setPoolIqActive(false);
        return;
      }
      const { top } = target.getBoundingClientRect();
      setPoolIqActive(top <= window.innerHeight * 0.55);
    };
    updatePoolIq();
    window.addEventListener("scroll", updatePoolIq, { passive: true });
    window.addEventListener("resize", updatePoolIq);
    return () => {
      window.removeEventListener("scroll", updatePoolIq);
      window.removeEventListener("resize", updatePoolIq);
    };
  }, [pathname]);

  const handlePoolIqClick = (closeMenu = false) =>
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (closeMenu) setMenuOpen(false);
      if (pathname !== "/") return;
      event.preventDefault();
      document.getElementById("pool-search")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

  return (
    <header className="sticky top-0 z-50 border-b border-cyan-400/10 bg-[linear-gradient(180deg,rgba(6,11,21,0.92),rgba(8,17,29,0.74))] backdrop-blur-xl">
      <div className="px-6 py-3 sm:px-10 sm:py-3.5 lg:px-16">
        <div className="relative mx-auto flex max-w-6xl items-center gap-4">
          <Link
            href="/"
            className="group inline-flex items-center"
          >
            <Image
              src="/images/TRAXR.png"
              alt="TRAXR"
              width={176}
              height={50}
              priority
              className="h-10 w-auto object-contain opacity-96 transition group-hover:opacity-100 sm:h-11"
            />
          </Link>

          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
            {CENTER_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                pathname={pathname}
                description={item.description}
                onClick={item.href === "/#pool-search" ? handlePoolIqClick(false) : undefined}
                activeOverride={item.href === "/#pool-search" ? poolIqActive : undefined}
              />
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-2 lg:flex">
            {RIGHT_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                pathname={pathname}
                description={item.description}
              />
            ))}
            <Link
              href={INTEGRATE_LINK.href}
              title={INTEGRATE_LINK.description}
              className="inline-flex items-center rounded-full border border-cyan-300/28 bg-cyan-400/8 px-4 py-2.5 text-[0.72rem] uppercase tracking-[0.22em] text-cyan-100 transition shadow-[0_0_22px_rgba(75,197,255,0.08)] hover:border-cyan-200/48 hover:bg-cyan-300/14 hover:text-white"
            >
              {INTEGRATE_LINK.label}
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
            className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-cyan-300/20 hover:text-white lg:hidden"
          >
            <span className="flex flex-col gap-1.5">
              <span className="h-px w-4 bg-current" />
              <span className="h-px w-4 bg-current" />
              <span className="h-px w-4 bg-current" />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-white/8 bg-[#091321]/94 px-6 pb-4 pt-3 backdrop-blur-xl sm:px-10 lg:hidden lg:px-16">
          <div className="mx-auto flex max-w-6xl flex-col gap-3">
            {CENTER_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                pathname={pathname}
                description={item.description}
                onClick={
                  item.href === "/#pool-search"
                    ? handlePoolIqClick(true)
                    : () => setMenuOpen(false)
                }
                activeOverride={item.href === "/#pool-search" ? poolIqActive : undefined}
                mobile
              />
            ))}
            {RIGHT_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                pathname={pathname}
                description={item.description}
                onClick={() => setMenuOpen(false)}
                mobile
              />
            ))}
            <Link
              href={INTEGRATE_LINK.href}
              onClick={() => setMenuOpen(false)}
              title={INTEGRATE_LINK.description}
              className="mt-1 inline-flex flex-col items-start justify-center gap-1 rounded-2xl border border-cyan-300/28 bg-cyan-400/8 px-4 py-3 text-sm uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/48 hover:bg-cyan-300/14 hover:text-white"
            >
              <span>{INTEGRATE_LINK.label}</span>
              <span className="text-[0.62rem] normal-case tracking-[0.02em] text-white/46">
                Partner and API integration info
              </span>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
