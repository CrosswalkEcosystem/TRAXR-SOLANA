"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type DocsSection = {
  href: string;
  title: string;
  description: string;
};

type Props = {
  sections: readonly DocsSection[];
};

export default function DocsWorkspace({ sections }: Props) {
  const [activeHref, setActiveHref] = useState(sections[0]?.href ?? "");

  const activeSection = useMemo(
    () => sections.find((section) => section.href === activeHref) ?? sections[0],
    [activeHref, sections],
  );

  if (!activeSection) return null;

  return (
    <div className="relative grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.04] p-3 lg:sticky lg:top-24">
        <div className="mb-3 px-2 text-[0.66rem] uppercase tracking-[0.22em] text-white/48">
          Docs
        </div>
        <nav className="flex flex-col gap-1.5">
          {sections.map((section) => {
            const active = section.href === activeSection.href;
            return (
              <button
                key={section.href}
                type="button"
                onClick={() => setActiveHref(section.href)}
                className={[
                  "text-left rounded-xl border px-3 py-2 text-[0.78rem] uppercase tracking-[0.15em] transition",
                  active
                    ? "border-cyan-300/35 bg-cyan-400/[0.12] text-cyan-100"
                    : "border-white/8 bg-white/[0.02] text-white/68 hover:border-cyan-300/28 hover:bg-cyan-400/[0.08] hover:text-cyan-100",
                ].join(" ")}
              >
                {section.title}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[0.75rem] uppercase tracking-[0.2em] text-cyan-100/72">
              {activeSection.title}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/68">
              {activeSection.description}
            </p>
          </div>
          <div>
            <Link
              href={activeSection.href}
              className="inline-flex items-center rounded-full border border-cyan-300/28 bg-cyan-400/8 px-4 py-2 text-[0.68rem] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/14 hover:text-white"
            >
              Open full page
            </Link>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <iframe
            key={activeSection.href}
            src={activeSection.href}
            title={`${activeSection.title} documentation`}
            className="h-[72vh] min-h-[560px] w-full"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  );
}
