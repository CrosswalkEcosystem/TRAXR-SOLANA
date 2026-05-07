import { DocsArticleShell } from "@/components/docs/DocsArticleShell";
import { DataModelDocContent } from "@/components/docs/DataModelDocContent";

export const metadata = {
  title: "Data Model | Solana Pool Entities and Metrics | TRAXR-SOLANA",
  description:
    "Overview of the TRAXR-SOLANA data model for Solana pool entities, token metadata, liquidity metrics, snapshots, and embedded scoring fields.",
  alternates: {
    canonical: "/data-model",
  },
};

export default function DataModelPage() {
  return (
    <DocsArticleShell
      mode="standalone"
      eyebrow="TRAXR-SOLANA | Data Model"
      title="TRAXR-SOLANA Data Model"
      subtitle="Indexed Solana pool entities used for normalization and scoring."
      footerTagline="Know the data. Know the risk."
    >
      <DataModelDocContent />
    </DocsArticleShell>
  );
}
