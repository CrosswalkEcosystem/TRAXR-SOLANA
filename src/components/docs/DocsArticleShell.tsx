import Image from "next/image";
import BackButton from "@/components/BackButton";
import SiteFooter from "@/components/SiteFooter";

type Mode = "standalone" | "embedded";

type Props = {
  mode?: Mode;
  eyebrow: string;
  title: string;
  subtitle?: string;
  footerTagline?: string;
  children: React.ReactNode;
};

export function DocsArticleShell({
  mode = "standalone",
  eyebrow,
  title,
  subtitle,
  footerTagline,
  children,
}: Props) {
  const standalone = mode === "standalone";

  const article = (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b1220]/90 via-[#0f1f36]/70 to-[#0b0f1d]/80 p-5 sm:p-7 shadow-[0_0_80px_rgba(0,255,255,0.14)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(0,180,255,0.12),transparent_28%)]" />

      <div className="relative mx-auto max-w-4xl">
        <div className="mb-8 flex flex-col items-start gap-3 sm:mb-10 sm:flex-row sm:items-center">
          <Image
            src="/images/TRAXR.png"
            alt="TRAXR-SOLANA"
            width={120}
            height={120}
            priority={standalone}
            className="h-16 w-auto opacity-90 sm:h-20"
          />
          <span className="text-xs tracking-wide text-slate-400 sm:text-sm">{eyebrow}</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-4 text-sm tracking-wide text-slate-400">{subtitle}</p> : null}

        {children}

        {standalone ? (
          <>
            <div className="mt-14">
              <BackButton />
            </div>
            {footerTagline ? <p className="mt-8 text-sm text-slate-500">{footerTagline}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );

  if (!standalone) return article;

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 sm:px-10 lg:px-16">
      <div className="pointer-events-none absolute inset-0 gridlines opacity-40" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-10 text-white">
        <BackButton />
        {article}
        <SiteFooter />
      </div>
    </main>
  );
}
