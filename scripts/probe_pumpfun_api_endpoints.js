#!/usr/bin/env node
"use strict";

const endpoints = [
  "https://frontend-api-v3.pump.fun/coins?offset=0&limit=50",
  "https://frontend-api-v3.pump.fun/coins/latest",
  "https://frontend-api-v3.pump.fun/coins/currently-live?offset=0&limit=50",
  "https://frontend-api-v3.pump.fun/coins/graduated?offset=0&limit=50",
  "https://frontend-api-v2.pump.fun/coins?offset=0&limit=50",
  "https://frontend-api-2.pump.fun/coins?offset=0&limit=50",
  "https://frontend-api.pump.fun/coins?offset=0&limit=50",
  "https://advanced-api-v2.pump.fun/coins/graduated",
  "https://advanced-api-v2.pump.fun/coins?offset=0&limit=50",
  "https://advanced-api-v2.pump.fun/coins/all?offset=0&limit=50",
];

async function main() {
  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) throw new Error("JWT_SECRET is missing");

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/json",
          Origin: "https://pump.fun",
        },
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const type = Array.isArray(parsed) ? "array" : typeof parsed;
      const len = Array.isArray(parsed) ? parsed.length : "";
      console.log(`${res.status} ${url} -> ${type} ${len}`);
    } catch (err) {
      console.log(`ERR ${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
