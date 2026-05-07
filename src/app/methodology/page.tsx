import { DocsArticleShell } from "@/components/docs/DocsArticleShell";
import { MethodologyDocContent } from "@/components/docs/MethodologyDocContent";

export const metadata = {
  title: "Methodology | Solana Pool Analytics and CTS Scoring | TRAXR-SOLANA",
  description:
    "Methodology for TRAXR-SOLANA Solana pool analytics: indexed snapshots, normalization, derived liquidity heuristics, trust signals, and CTS scoring.",
  alternates: {
    canonical: "/methodology",
  },
};

export default function MethodologyPage() {
  return (
    <DocsArticleShell
      mode="standalone"
      eyebrow="TRAXR-SOLANA | Methodology"
      title="How TRAXR-SOLANA Works"
      subtitle="Pool Risk Intelligence"
      footerTagline="Know your data. Know your risk."
    >
      <MethodologyDocContent />
    </DocsArticleShell>
  );
}
