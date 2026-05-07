import Image from "next/image";
import BackButton from "@/components/BackButton";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Contact | TRAXR-SOLANA Support and Security",
  description:
    "Contact TRAXR-SOLANA for support, security reporting, trust review, and product questions about the read-only Solana analytics interface.",
  alternates: {
    canonical: "/contact",
  },
};

const contactCards = [
  {
    label: "General",
    title: "Support and Product Questions",
    href: "mailto:support@crosswalk.pro",
    value: "support@crosswalk.pro",
    description:
      "Use for product, trust, documentation, or general operational questions.",
  },
  {
    label: "Security",
    title: "Security Reporting",
    href: "mailto:support@crosswalk.pro?subject=TRAXR-SOLANA%20Security%20Report",
    value: "support@crosswalk.pro",
    description:
      "Use for vulnerability reports or urgent trust and abuse concerns.",
  },
];

export default function ContactPage() {
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
                TRAXR-SOLANA | Contact
              </span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Contact
            </h1>
            <p className="mt-4 max-w-3xl text-sm tracking-wide text-slate-400">
              TRAXR-SOLANA is operated as a read-only analytics surface. If you
              need support, security review, or classification clarification,
              use the channels below.
            </p>

            <section className="mt-10 grid gap-4 sm:grid-cols-2">
              {contactCards.map((card) => (
                <a
                  key={card.title}
                  href={card.href}
                  className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-cyan-300/35 hover:bg-white/[0.08]"
                >
                  <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">
                    {card.label}
                  </div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {card.title}
                  </div>
                  <div className="mt-3 text-sm text-cyan-100 group-hover:text-white">
                    {card.value}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {card.description}
                  </p>
                </a>
              ))}
            </section>

            <section className="mt-10 rounded-md border border-white/10 bg-white/5 p-4">
              <h2 className="text-lg font-medium sm:text-xl">
                Trust and Classification Reviews
              </h2>
              <p className="mt-3 text-slate-300">
                If a browser, security tool, or reputation service flags
                TRAXR-SOLANA incorrectly, include the vendor name, alert text,
                a screenshot, and the date observed when you contact us.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="text-lg font-medium sm:text-xl">Company</h2>
              <p className="mt-3 text-slate-300">
                Crosswalk Ecosystem LLC
              </p>
              <p className="mt-2 text-slate-300">
                Primary ecosystem site:
                <a
                  href="https://crosswalk.pro"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-cyan-200 hover:text-white"
                >
                  crosswalk.pro
                </a>
              </p>
            </section>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
