import Link from "next/link";
import Image from "next/image";
import BackButton from "@/components/BackButton";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Integrate | TRAXR-SOLANA Liquidity Intelligence",
  description:
    "Integrate TRAXR-SOLANA pool intelligence into trading products, dashboards, and research surfaces with read-only analytics and deterministic risk context.",
  alternates: {
    canonical: "/integrate",
  },
  openGraph: {
    title: "Integrate | TRAXR-SOLANA Liquidity Intelligence",
    description:
      "Integrate TRAXR-SOLANA pool intelligence into trading products, dashboards, and research surfaces with read-only analytics and deterministic risk context.",
    url: "/integrate",
    images: [
      {
        url: "/images/seo/integrate-og-1200x630.png",
        width: 1200,
        height: 630,
        alt: "TRAXR-SOLANA Integrate",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Integrate | TRAXR-SOLANA Liquidity Intelligence",
    description:
      "Integrate TRAXR-SOLANA pool intelligence into trading products, dashboards, and research surfaces with read-only analytics and deterministic risk context.",
    images: ["/images/seo/integrate-og-1200x630.png"],
  },
};

const integrationModes = [
  {
    title: "Explorer Embedding",
    description:
      "Link users from your product into TRAXR Explorer with preselected datasets and pool context.",
    outcome: "Fastest path to add pool-risk context for your users.",
  },
  {
    title: "API Integration",
    description:
      "Consume read-only endpoints for dataset summaries, pool scoring, and trend history.",
    outcome: "Power your own UI with TRAXR liquidity and risk signals.",
  },
  {
    title: "Ops & Monitoring",
    description:
      "Use TRAXR surfaces internally for risk monitoring, liquidity diagnostics, and pool-quality workflows.",
    outcome: "Improve decision speed for listings, routing, and market operations.",
  },
] as const;

const currentCoverage = [
  "Raydium AMM / CLMM / CPMM",
  "Orca Whirlpool",
  "Meteora DLMM",
  "Meteora DAMM v2",
  "PumpSwap",
] as const;

const badgeExamples = [
  { pool: "SOL/USDC", traxr: 91, cts: "A1", ctsImage: "/images/cts1.png" },
  { pool: "JUP/SOL", traxr: 74, cts: "B2", ctsImage: "/images/cts3.png" },
  { pool: "WIF/USDC", traxr: 58, cts: "C3", ctsImage: "/images/cts5.png" },
] as const;

export default function IntegratePage() {
  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 sm:px-10 lg:px-16">
      <div className="pointer-events-none absolute inset-0 gridlines opacity-40" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-10 text-white">
        <BackButton />

        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b1220]/90 via-[#0f1f36]/70 to-[#0b0f1d]/80 p-6 shadow-[0_0_80px_rgba(0,255,255,0.14)] sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(0,180,255,0.12),transparent_28%)]" />

          <div className="relative mx-auto max-w-5xl">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">
              TRAXR-SOLANA | Integration
            </p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
              Integrate liquidity intelligence into your product
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-white/70 sm:text-base sm:leading-7">
              Integration means adding pool-level risk context where decisions happen. TRAXR is read-only,
              deterministic per snapshot, and focused on execution conditions rather than token narratives.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/api-preview"
                className="inline-flex items-center rounded-full border border-cyan-300/35 bg-cyan-400/[0.12] px-4 py-2 text-[0.68rem] uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-200/55 hover:bg-cyan-300/16 hover:text-white"
              >
                Go to API docs
              </Link>
              <a
                href="mailto:traxr-solana@crosswalk.pro?subject=TRAXR%20Integration"
                className="inline-flex items-center rounded-full border border-white/14 bg-white/[0.04] px-4 py-2 text-[0.68rem] uppercase tracking-[0.18em] text-white/78 transition hover:border-white/24 hover:text-white"
              >
                Contact integration team
              </a>
            </div>

            <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-lg font-medium">What this looks like in your product</h2>
              <p className="mt-2 text-sm text-white/62">
                Add TRAXR Score + CTS badge directly in pool lists across explorers, wallets, DEX surfaces, and routing views.
              </p>
              <div className="mt-4 space-y-2">
                {badgeExamples.map((example) => (
                  <div
                    key={example.pool}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5"
                  >
                    <span className="text-sm text-white/86">{example.pool}</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-cyan-300/35 bg-cyan-400/[0.1] px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.12em] text-cyan-100">
                        TRAXR {example.traxr}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/35 bg-emerald-400/[0.12] px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.12em] text-emerald-100">
                        <Image
                          src={example.ctsImage}
                          alt={`CTS badge ${example.cts}`}
                          width={18}
                          height={18}
                          className="h-[18px] w-[18px] rounded-sm object-contain"
                        />
                        <span>CTS {example.cts}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8 grid gap-4 md:grid-cols-3">
              {integrationModes.map((mode) => (
                <div
                  key={mode.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                >
                  <h2 className="text-base font-medium text-white">{mode.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-white/68">{mode.description}</p>
                  <p className="mt-3 text-sm text-cyan-100/85">{mode.outcome}</p>
                </div>
              ))}
            </section>

            <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-lg font-medium">Current Integrations Coverage</h2>
              <p className="mt-2 text-sm text-white/62">
                TRAXR currently ships analytics coverage across the following pool ecosystems:
              </p>
              <ul className="mt-4 grid gap-2 text-sm text-white/78 sm:grid-cols-2">
                {currentCoverage.map((item) => (
                  <li key={item} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-lg font-medium">Integration Showcase</h2>
              <p className="mt-2 text-sm text-white/62">
                Live and in-progress integrations using TRAXR liquidity intelligence.
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <article className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white/90">StakePoint</h3>
                    <span className="rounded-full border border-emerald-300/35 bg-emerald-400/[0.12] px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.14em] text-emerald-100">
                      Integrated
                    </span>
                  </div>
                  <div className="relative aspect-[40/21] w-full overflow-hidden rounded-lg border border-white/10">
                    <Image
                      src="/images/seo/stkpt-preview.jpg"
                      alt="StakePoint integration preview"
                      fill
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      className="object-cover object-top"
                    />
                  </div>
                  <a
                    href="https://stakepoint.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-xs uppercase tracking-[0.14em] text-cyan-200/90 hover:text-white"
                  >
                    Open stakepoint.app
                  </a>
                </article>

                <article className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white/90">CrosswalkDEX</h3>
                    <span className="rounded-full border border-amber-300/35 bg-amber-400/[0.12] px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.14em] text-amber-100">
                      Integrating
                    </span>
                  </div>
                  <div className="relative aspect-[40/21] w-full overflow-hidden rounded-lg border border-white/10">
                    <Image
                      src="/images/seo/dex-preview.png"
                      alt="CrosswalkDEX integration preview"
                      fill
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      className="object-cover object-top"
                    />
                  </div>
                  <a
                    href="https://x.com/crosswalkdex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-xs uppercase tracking-[0.14em] text-cyan-200/90 hover:text-white"
                  >
                    Open x.com/crosswalkdex
                  </a>
                </article>
              </div>
            </section>

            <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-lg font-medium">Pricing note</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">
                Integration is currently free during the early partner phase. It is not guaranteed to remain free forever.
                If commercial terms are introduced later, partners will get advance notice and migration guidance.
              </p>
            </section>

            <section className="mt-8 flex flex-col gap-3 rounded-2xl border border-cyan-300/25 bg-cyan-400/[0.08] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h2 className="text-lg font-medium text-white">Start an integration discussion</h2>
                <p className="mt-1 text-sm text-white/70">
                  Share your product context and preferred integration path.
                </p>
              </div>
              <a
                href="mailto:traxr-solana@crosswalk.pro?subject=TRAXR%20Integration"
                className="inline-flex items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-400/[0.12] px-5 py-2.5 text-[0.72rem] uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/55 hover:bg-cyan-300/18 hover:text-white"
              >
                traxr-solana@crosswalk.pro
              </a>
            </section>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
