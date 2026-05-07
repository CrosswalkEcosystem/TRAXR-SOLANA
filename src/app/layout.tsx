import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const OG_IMAGE_PATH = "/images/seo/solana-og-20260416-v2.png";

export const metadata: Metadata = {
  metadataBase: new URL("https://solana.traxr.pro"),
  title: "TRAXR-SOLANA | Solana Pool Analytics and Risk Intelligence",
  description:
    "Read-only Solana pool analytics with indexed snapshots, deterministic normalization, liquidity metrics, trend history, and CTS scoring.",
  applicationName: "TRAXR-SOLANA",
  keywords: [
    "solana analytics",
    "solana pool analytics",
    "solana dex analytics",
    "raydium",
    "orca",
    "meteora",
    "pumpswap",
    "liquidity analytics",
    "pool risk analytics",
    "cts scoring",
  ],
  category: "technology",
  creator: "Crosswalk Ecosystem LLC",
  publisher: "Crosswalk Ecosystem LLC",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "TRAXR-SOLANA | Solana Pool Analytics and Risk Intelligence",
    description:
      "Read-only Solana pool analytics with indexed snapshots, deterministic normalization, trend history, and embedded CTS scoring.",
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
    title: "TRAXR-SOLANA | Solana Pool Analytics",
    description:
      "Read-only Solana pool analytics with indexed snapshots, trust signals, and CTS scoring.",
    images: [{ url: OG_IMAGE_PATH, alt: "TRAXR-SOLANA" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Crosswalk Ecosystem LLC",
        url: "https://crosswalk.pro",
        email: "support@crosswalk.pro",
        sameAs: [
          "https://github.com/CrosswalkEcosystem",
          "https://crosswalk.pro",
        ],
      },
      {
        "@type": "WebSite",
        name: "TRAXR-SOLANA",
        url: "https://solana.traxr.pro",
        description:
          "Read-only analytics platform for Solana liquidity pools with deterministic indexing and CTS scoring.",
        keywords:
          "solana pool analytics, raydium analytics, orca analytics, meteora analytics, pumpswap analytics, cts scoring",
        publisher: {
          "@type": "Organization",
          name: "Crosswalk Ecosystem LLC",
        },
      },
      {
        "@type": "WebApplication",
        name: "TRAXR-SOLANA",
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: "https://solana.traxr.pro",
        description:
          "Read-only Solana pool analytics application with indexed snapshots, trust signals, and CTS scoring.",
        publisher: {
          "@type": "Organization",
          name: "Crosswalk Ecosystem LLC",
        },
      },
    ],
  };

  return (
    <html lang="en">
      <head>
        <meta
          name="norton-safeweb-site-verification"
          content="2207EC1SLVK11PIS9QJD9M4TQLNCL02-4QVFRBP685JQGKN569FIRMGR5-GVPKOS2RHU9YU34ON4S40VC4DF3OIR-123ZK-NMHPEYOY8FL-MNV1LIK9DGY2E0QS02GOW"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationSchema),
          }}
        />
        <div className="min-h-screen">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
