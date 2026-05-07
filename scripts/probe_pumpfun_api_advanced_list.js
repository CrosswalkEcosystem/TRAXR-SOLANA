#!/usr/bin/env node
"use strict";

const BASE_URL = "https://advanced-api-v2.pump.fun/coins/list";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, jwt, attempt = 0) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
      Origin: "https://pump.fun",
    },
  });
  if (res.ok) return res.json();
  if (res.status === 429 && attempt < 5) {
    const delay = 500 * 2 ** attempt;
    console.warn(`[pumpfun] 429 retry in ${delay}ms`);
    await sleep(delay);
    return fetchJson(url, jwt, attempt + 1);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}: ${text}`);
}

function buildUrl(params) {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function main() {
  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) throw new Error("JWT_SECRET is missing");

  const testParams = [];
  const limits = [30, 50, 100, 200];
  const sorts = [
    "creationTime",
    "marketCap",
    "volume",
    "numHolders",
    "transactions",
  ];
  const orders = ["asc", "desc"];

  for (const limit of limits) {
    testParams.push({ limit });
  }
  for (const sort of sorts) {
    for (const order of orders) {
      testParams.push({ limit: 50, sort, order });
    }
  }
  testParams.push({ limit: 50, lastScore: 30 });
  testParams.push({ limit: 50, lastScore: 100 });

  for (const params of testParams) {
    const url = buildUrl(params);
    try {
      const data = await fetchJson(url, jwt);
      const coins = Array.isArray(data?.coins) ? data.coins.length : "n/a";
      const pagination = data?.pagination || null;
      console.log(`${url} -> coins=${coins} pagination=${JSON.stringify(pagination)}`);
    } catch (err) {
      console.log(`${url} -> ERR ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(200);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
