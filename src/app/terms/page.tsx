import Image from "next/image";
import BackButton from "@/components/BackButton";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Terms | TRAXR-SOLANA Read-Only Analytics",
  description:
    "Terms for the TRAXR-SOLANA read-only analytics platform and API covering informational use, non-custodial access, and no-transaction design.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 sm:px-10 lg:px-16">
      <div className="pointer-events-none absolute inset-0 gridlines opacity-40" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-10 text-white">
        <BackButton />

        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b1220]/90 via-[#0f1f36]/70 to-[#0b0f1d]/80 p-6 shadow-[0_0_80px_rgba(0,255,255,0.14)] sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(0,180,255,0.12),transparent_28%)]" />

          <div className="relative mx-auto max-w-4xl">
            <div className="mb-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Image
                src="/images/TRAXR.png"
                alt="TRAXR-SOLANA"
                width={120}
                height={120}
                priority
                className="opacity-90"
              />
              <span className="text-xs tracking-wide text-slate-400 sm:text-sm">
                TRAXR-SOLANA | Terms
              </span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Terms of Use
            </h1>
            <p className="mt-4 max-w-3xl text-sm tracking-wide text-slate-400">
              These terms govern access to the TRAXR-SOLANA website and its
              read-only API surfaces.
            </p>

            <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-medium sm:text-xl">
                Product Scope
              </h2>
              <p className="mt-3 text-slate-300">
                TRAXR-SOLANA is an analytics and intelligence interface. It is
                not a brokerage, exchange, wallet, custody service, execution
                venue, or transaction relay.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-medium sm:text-xl">
                No Financial Advice
              </h2>
              <p className="mt-3 text-slate-300">
                Scores, warnings, heuristics, and visualizations are provided
                for informational purposes only. They do not constitute
                investment, legal, tax, security, or trading advice.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-medium sm:text-xl">
                Read-Only Access
              </h2>
              <p className="mt-3 text-slate-300">
                The site is intended for inspection of indexed liquidity data.
                It does not ask visitors to connect wallets, sign messages,
                approve token movements, or submit seed phrases or private keys.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-medium sm:text-xl">
                Accuracy and Availability
              </h2>
              <p className="mt-3 text-slate-300">
                TRAXR-SOLANA relies on snapshot-backed datasets, local
                enrichments, and best-effort derived metrics. Data freshness,
                completeness, and protocol coverage can change over time.
              </p>
            </section>

            <section className="mt-10 rounded-md border border-yellow-400/30 bg-yellow-400/5 p-4">
              <h2 className="text-lg font-medium text-yellow-300 sm:text-xl">
                Acceptable Use
              </h2>
              <p className="mt-3 text-slate-300">
                Do not use the service to interfere with availability, scrape in
                abusive patterns, misrepresent TRAXR-SOLANA output, or attribute
                execution guarantees to informational metrics.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-medium sm:text-xl">External Links</h2>
              <p className="mt-3 text-slate-300">
                The site may link to GitHub, Crosswalk properties, or other
                third-party resources. Those destinations operate under their
                own policies and terms.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-medium sm:text-xl">Contact</h2>
              <p className="mt-3 text-slate-300">
                Terms questions can be directed to
                <a
                  href="mailto:support@crosswalk.pro"
                  className="ml-1 text-cyan-200 hover:text-white"
                >
                  support@crosswalk.pro
                </a>
                .
              </p>
            </section>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
