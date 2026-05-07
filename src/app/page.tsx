import type { Metadata } from "next";
import HomePageClient from "@/components/HomePageClient";

const OG_IMAGE_PATH = "/images/seo/solana-og-20260416-v2.png";

export const metadata: Metadata = {
  title: "Solana Pool Analytics | Raydium, Orca, Meteora & PumpSwap | TRAXR-SOLANA",
  description:
    "Read-only Solana pool analytics for Raydium, Orca, Meteora, and PumpSwap with indexed snapshots, liquidity metrics, trend history, trust signals, and CTS scoring.",
  keywords: [
    "solana pool analytics",
    "solana dex analytics",
    "raydium analytics",
    "orca analytics",
    "meteora analytics",
    "pumpswap analytics",
    "solana pool risk",
    "solana liquidity analytics",
    "cts scoring",
    "raydium clmm analytics",
    "meteora damm v2 analytics",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Solana Pool Analytics | TRAXR-SOLANA",
    description:
      "Read-only analytics for Solana liquidity pools across Raydium, Orca, Meteora, and PumpSwap with trend history, trust signals, and CTS scoring.",
    url: "https://solana.traxr.pro",
    siteName: "TRAXR-SOLANA",
    type: "website",
    images: [
      {
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "TRAXR-SOLANA",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Solana Pool Analytics | TRAXR-SOLANA",
    description:
      "Read-only Solana pool analytics with indexed snapshots, trust signals, and CTS scoring.",
    images: [{ url: OG_IMAGE_PATH, alt: "TRAXR-SOLANA" }],
  },
};

export default function HomePage() {
  return <HomePageClient />;
}
