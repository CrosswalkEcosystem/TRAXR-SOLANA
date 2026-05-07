"use client";

import { useMemo, useState } from "react";
import { getTokenLogoDisplaySrc } from "@/lib/tokenLogo";

type Props = {
  src?: string | null;
  label: string;
  className?: string;
};

export default function TokenLogo({ src, label, className = "" }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const displaySrc = useMemo(() => getTokenLogoDisplaySrc(src), [src]);
  const initial = (label || "?").trim().charAt(0).toUpperCase() || "?";
  const failed = displaySrc !== null && failedSrc === displaySrc;

  if (!displaySrc || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-full border border-white/15 bg-white/10 text-[10px] font-semibold text-white/75 ${className}`}
      >
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displaySrc}
      alt={label}
      className={`rounded-full border border-white/15 bg-slate-900/80 object-cover ${className}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(displaySrc)}
    />
  );
}
