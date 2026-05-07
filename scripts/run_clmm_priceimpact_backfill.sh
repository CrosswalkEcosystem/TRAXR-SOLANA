#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data"

START_TS="${1:-}"
if [[ -z "${START_TS}" ]]; then
  echo "Usage: $0 <start_timestamp> [end_timestamp]" >&2
  echo "Example: $0 2026-03-30T054542706Z 2026-03-30T234621215Z" >&2
  exit 1
fi

END_TS="${2:-}"
IMPORT_TO_SQLITE="${IMPORT_TO_SQLITE:-0}"

collect_snapshots() {
  local start="$1"
  local end="$2"
  local files
  mapfile -t files < <(ls -1 "${DATA_DIR}"/clmm.live.json_*.json 2>/dev/null | \
    grep -v "priceimpact" | sort)

  for f in "${files[@]}"; do
    local base
    base="$(basename "${f}")"
    local ts="${base#clmm.live.json_}"
    ts="${ts%.json}"

    if [[ "${ts}" < "${start}" ]]; then
      continue
    fi
    if [[ -n "${end}" && "${ts}" > "${end}" ]]; then
      continue
    fi
    echo "${f}"
  done
}

merge_priceimpact() {
  local base_json="$1"
  local retry_json="$2"
  local out_json="$3"

  node -e "
const fs=require('fs');
const base=JSON.parse(fs.readFileSync('${base_json}','utf8'));
const retry=JSON.parse(fs.readFileSync('${retry_json}','utf8'));
const map=new Map(base.map(r=>[r.id||r.pool_id,r]));
for(const row of retry){
  const id=row.id||row.pool_id;
  if(!id) continue;
  const target=map.get(id);
  if(target) Object.assign(target,row);
  else base.push(row);
}
fs.writeFileSync('${out_json}', JSON.stringify(base,null,2));
console.log('wrote', '${out_json}', 'rows', base.length);
"
}

run_one_snapshot() {
  local snapshot_file="$1"
  local base
  base="$(basename "${snapshot_file}")"
  local ts="${base#clmm.live.json_}"
  ts="${ts%.json}"

  local out_base="${DATA_DIR}/clmm.live.json_${ts}.priceimpact.batch.json"
  local out_retry="${DATA_DIR}/clmm.live.json_${ts}.priceimpact.batch.retry.json"
  local out_merged="${DATA_DIR}/clmm.live.json_${ts}.priceimpact.batch.merged.json"

  echo
  echo "==> Snapshot ${ts}"
  time node scripts/recompute_clmm_priceimpact_native.js \
    --snapshot "clmm.live.json_${ts}.json" \
    --min-liquidity-usd 1000 \
    --tick-array-window 2 \
    --tick-array-limit 8 \
    --state-batch-size 200 \
    --concurrency 1 \
    --output "$(basename "${out_base}")" \
    --write

  time node scripts/recompute_clmm_priceimpact_native.js \
    --snapshot "clmm.live.json_${ts}.json" \
    --retry-from "$(basename "${out_base}")" \
    --retry-only-failed \
    --tick-array-window 5 \
    --tick-array-limit 24 \
    --state-batch-size 200 \
    --concurrency 1 \
    --output "$(basename "${out_retry}")" \
    --write

  merge_priceimpact "${out_base}" "${out_retry}" "${out_merged}"

  if [[ "${IMPORT_TO_SQLITE}" == "1" ]]; then
    if [[ -z "${TRAXR_SQLITE_DIR:-}" ]]; then
      echo "TRAXR_SQLITE_DIR not set; skipping sqlite import" >&2
    else
      node scripts/build_snapshot_sqlite.js --file "${out_merged}"
    fi
  fi
}

snapshots=()
while IFS= read -r f; do
  snapshots+=("${f}")
done < <(collect_snapshots "${START_TS}" "${END_TS}")

if [[ "${#snapshots[@]}" -eq 0 ]]; then
  echo "No snapshots found for range." >&2
  exit 1
fi

echo "Found ${#snapshots[@]} snapshot(s) to process."
for f in "${snapshots[@]}"; do
  run_one_snapshot "${f}"
done
