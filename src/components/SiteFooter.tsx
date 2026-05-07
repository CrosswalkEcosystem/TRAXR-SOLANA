import Link from "next/link";

const internalLinks = [
  { href: "/methodology", label: "Methodology" },
  { href: "/architecture", label: "Architecture" },
  { href: "/api-preview", label: "API" },
  { href: "/data-model", label: "Data model" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export default function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-white/10 pt-6 text-sm text-white/60">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <a
              href="https://github.com/CrosswalkEcosystem"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white"
            >
              GitHub
            </a>
            {internalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-white"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://crosswalk.pro"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white"
            >
              crosswalk.pro
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs uppercase tracking-[0.18em] text-white/45">
            <span>Read-only analytics</span>
            <span>No wallet connect</span>
            <span>No transactions</span>
          </div>
        </div>

        <div className="space-y-1 text-sm text-white/50 lg:text-right">
          <div>Crosswalk Ecosystem LLC</div>
          <div>
            <a
              href="mailto:support@crosswalk.pro"
              className="hover:text-white"
            >
              support@crosswalk.pro
            </a>
          </div>
          <div>(c) 2026 Crosswalk Ecosystem LLC. All rights reserved.</div>
        </div>
      </div>
    </footer>
  );
}
