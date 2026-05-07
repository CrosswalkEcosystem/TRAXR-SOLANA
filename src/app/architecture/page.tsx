import { DocsArticleShell } from "@/components/docs/DocsArticleShell";
import { ArchitectureDocContent } from "@/components/docs/ArchitectureDocContent";

export const metadata = {
  title: "Architecture | Solana Pool Data Pipeline | TRAXR-SOLANA",
  description:
    "Architecture overview for TRAXR-SOLANA covering Solana pool ingestion, NodeZero snapshots, local enrichment, and deterministic CTS scoring.",
  alternates: {
    canonical: "/architecture",
  },
};

export default function ArchitecturePage() {
  return (
    <DocsArticleShell
      mode="standalone"
      eyebrow="TRAXR-SOLANA | Architecture"
      title="TRAXR-SOLANA Architecture"
      subtitle="NodeZero snapshots, local enrichments, and deterministic CTS scoring."
      footerTagline="Know the system. Know the risk."
    >
      <ArchitectureDocContent />
    </DocsArticleShell>
  );
}
