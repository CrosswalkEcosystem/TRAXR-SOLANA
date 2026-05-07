import { TraxrTrajectoryLab } from "@/components/TraxrTrajectoryLab";

export const metadata = {
  title: "Trajectory Lab | Solana Liquidity Trajectory Viewer | TRAXR-SOLANA",
  description:
    "Interactive trajectory lab for exploring TRAXR-SOLANA liquidity and pool movement patterns in a read-only 3D environment.",
  alternates: {
    canonical: "/lab/trajectory-3d",
  },
};

export default function Trajectory3DPage() {
  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 xl:px-14">
      <div className="pointer-events-none absolute inset-0 gridlines opacity-40" />
      <div className="relative mx-auto max-w-[1520px]">
        <TraxrTrajectoryLab />
      </div>
    </main>
  );
}
