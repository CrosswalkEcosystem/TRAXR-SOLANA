import type { Metadata } from "next";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import SiteFooter from "@/components/SiteFooter";
import { DocsArticleShell } from "@/components/docs/DocsArticleShell";
import { MethodologyDocContent } from "@/components/docs/MethodologyDocContent";
import { ArchitectureDocContent } from "@/components/docs/ArchitectureDocContent";
import { ApiDocContent } from "@/components/docs/ApiDocContent";
import { DataModelDocContent } from "@/components/docs/DataModelDocContent";

const DOC_SECTIONS = [
  {
    key: "methodology",
    href: "/methodology",
    title: "Methodology",
    description: "How TRAXR scores and interprets pool risk from snapshot-backed data.",
    eyebrow: "TRAXR-SOLANA | Methodology",
    pageTitle: "How TRAXR-SOLANA Works",
    subtitle: "Pool Risk Intelligence",
    render: () => <MethodologyDocContent />,
  },
  {
    key: "architecture",
    href: "/architecture",
    title: "Architecture",
    description: "How indexing, enrichments, and deterministic scoring are wired together.",
    eyebrow: "TRAXR-SOLANA | Architecture",
    pageTitle: "TRAXR-SOLANA Architecture",
    subtitle: "NodeZero snapshots, local enrichments, and deterministic CTS scoring.",
    render: () => <ArchitectureDocContent />,
  },
  {
    key: "api",
    href: "/api-preview",
    title: "API",
    description: "Read-only endpoints for datasets, pool details, scores, and trends.",
    eyebrow: "TRAXR-SOLANA API",
    pageTitle: "TRAXR-SOLANA API (Preview)",
    subtitle: "Read-only endpoints for indexed pool data, embedded CTS scoring, and dataset-specific trend lookups.",
    render: () => <ApiDocContent />,
  },
  {
    key: "data-model",
    href: "/data-model",
    title: "Data Model",
    description: "The core entities and derived metrics used in TRAXR-SOLANA.",
    eyebrow: "TRAXR-SOLANA | Data Model",
    pageTitle: "TRAXR-SOLANA Data Model",
    subtitle: "Indexed Solana pool entities used for normalization and scoring.",
    render: () => <DataModelDocContent />,
  },
] as const;

export const metadata: Metadata = {
  title: "Docs | TRAXR-SOLANA",
  description:
    "Documentation hub for TRAXR-SOLANA methodology, architecture, API, and data model.",
  alternates: {
    canonical: "/docs",
  },
};

type DocsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DocsPage({ searchParams }: DocsPageProps) {
  const params = (await searchParams) ?? {};
  const docParamRaw = params.doc;
  const docParam = Array.isArray(docParamRaw) ? docParamRaw[0] : docParamRaw;
  const activeKey = DOC_SECTIONS.some((section) => section.key === docParam)
    ? docParam
    : DOC_SECTIONS[0].key;
  const activeSection =
    DOC_SECTIONS.find((section) => section.key === activeKey) ?? DOC_SECTIONS[0];

  return (
    <main className="relative min-h-screen overflow-x-hidden px-4 py-8 sm:px-8 sm:py-10 lg:px-14">
      <div className="pointer-events-none absolute inset-0 gridlines opacity-40" />

      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-8 text-white">
        <BackButton />

        <div className="fixed inset-x-0 top-[64px] z-40 px-3 sm:top-[72px] sm:px-5">
          <div className="mx-auto flex w-fit max-w-full justify-center rounded-2xl border border-white/10 bg-[#0b1220]/92 p-1.5 backdrop-blur sm:p-2">
            <nav className="flex flex-wrap items-center justify-center gap-1.5">
              {DOC_SECTIONS.map((section) => {
                const active = section.key === activeKey;
                return (
                  <Link
                    key={section.key}
                    href={`/docs?doc=${section.key}`}
                    className={[
                      "rounded-xl border px-2 py-1.5 text-[0.62rem] uppercase tracking-[0.1em] transition sm:px-3 sm:py-2 sm:text-[0.7rem] lg:px-3.5 lg:text-[0.74rem]",
                      active
                        ? "border-cyan-300/35 bg-cyan-400/[0.12] text-cyan-100"
                        : "border-white/8 bg-white/[0.02] text-white/68 hover:border-cyan-300/28 hover:bg-cyan-400/[0.08] hover:text-cyan-100",
                    ].join(" ")}
                  >
                    {section.title}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        <div className="h-[56px] sm:h-[64px]" />

        <section className="relative overflow-visible rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b1220]/90 via-[#0f1f36]/70 to-[#0b0f1d]/80 p-4 sm:p-6 shadow-[0_0_80px_rgba(0,255,255,0.14)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(0,180,255,0.12),transparent_28%)]" />

          <div className="relative">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">TRAXR-SOLANA Docs</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
              Reference pages for how TRAXR-SOLANA works, how data flows through the system,
              and how to query the read-only API.
            </p>

            <div className="mt-6">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-2 sm:p-3">
                <div className="px-2 pb-2">
                  <Link
                    href={activeSection.href}
                    className="inline-flex items-center rounded-full border border-cyan-300/28 bg-cyan-400/8 px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/14 hover:text-white"
                  >
                    Open standalone page
                  </Link>
                </div>

                <div className="min-h-[72vh] sm:min-h-[78vh]">
                  <DocsArticleShell
                    mode="embedded"
                    eyebrow={activeSection.eyebrow}
                    title={activeSection.pageTitle}
                    subtitle={activeSection.subtitle}
                  >
                    {activeSection.render()}
                  </DocsArticleShell>
                </div>
              </div>
            </div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
