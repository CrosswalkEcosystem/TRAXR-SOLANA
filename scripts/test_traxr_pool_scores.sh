#!/usr/bin/env bash
set -euo pipefail

HOST="https://solana.traxr.pro"

POOL_IDS=(
  "A1d4sAmgi4Njnodmc289HP7TaPxw54n4Ey3LRDfrBvo5"
  "EwacCmhY4HmAAuJ8XSnQG4NrP4Jm9ZvD25j13PbkyGTM"
  "EFNrQHayZyXzCA6J1n34vXdHX2ox6ByapBrRvLkSmRN6"
  "EnWuoyUfQHBNN7zUpBLnbgarGwtW6pbLqV7NM3eXRHTM"
  "7Y9JYKKZV824idJewK6e4CN4C9jEm3x4xHzpZfhT3bAs"
  "FQE94FG1VAxCGt6mNzicJKeHbDNmYqhTJyvSokKy7CPd"
  "FmMXv9kLxzn1vaJXMD4rnWumeYVchtwinyVJ9zxBJqjM"
  "5ijaSiZco7KYEov8WAYqdGR9PQuiqcsvFyHY5pWcvCbt"
  "6tDL16nwiD4DB3EH5iNyP1itpRRf5Wi3aLTrPE3V3Gct"
  "Wu2852jaM1PvUDVfK78RP2UGjJjbWjK4kE8AsovHnPe"
  "Dg91beFDbhSibYffMS35aPX9ZxiEt7dq26WNJDWw46wA"
  "E3r6FxKQWfgQZZsEVgBefaorGaxQpSv1oDMS7JLMh7RG"
  "9YGfshDXHscaDDRS4gQrAGKTweuBDSBgJiptpDv3z2Tw"
)

if command -v jq >/dev/null 2>&1; then
  for id in "${POOL_IDS[@]}"; do
    echo "== $id =="
    curl -sS "${HOST}/api/traxr/pools/${id}" | jq -r '
      def val(x): if x == null then "n/a" else x end;
      if .error then
        "error: \(.error)"
      else
        "dataset: \(val(.dataset // .source // .metrics.source // .metrics.poolType))\nscore: \(val(.score // .ctsScore // .metrics.ctsScore))\nctsNodes: \(val(.ctsNodes // .metrics.ctsNodes))\npriceImpactPct: \(val(.priceImpactPct // .metrics.priceImpactPct))\nupdatedAt: \(val(.updatedAt // .metrics.poolUpdatedAt))"
      end
    '
    echo
  done
else
  echo "jq not found; printing raw JSON"
  for id in "${POOL_IDS[@]}"; do
    echo "== $id =="
    curl -sS "${HOST}/api/traxr/pools/${id}"
    echo
  done
fi
