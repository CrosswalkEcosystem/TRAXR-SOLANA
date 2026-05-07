import { DocsArticleShell } from "@/components/docs/DocsArticleShell";
import { ApiDocContent } from "@/components/docs/ApiDocContent";

export const metadata = {
  title: "API | Read-Only Solana Pool Analytics Endpoints | TRAXR-SOLANA",
  description:
    "Read-only API for TRAXR-SOLANA indexed Solana pool data, dataset summaries, pool scores, and trend lookups across Raydium, Orca, Meteora, and PumpSwap.",
  alternates: {
    canonical: "/api-preview",
  },
};

export default function ApiPreviewPage() {
  return (
    <DocsArticleShell
      mode="standalone"
      eyebrow="TRAXR-SOLANA API"
      title="TRAXR-SOLANA API (Preview)"
      subtitle="Read-only endpoints for indexed pool data, embedded CTS scoring, and dataset-specific trend lookups."
      footerTagline="Read-only by design. Deterministic by default."
    >
      <ApiDocContent />
    </DocsArticleShell>
  );
}
