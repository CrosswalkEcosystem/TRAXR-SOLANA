import { NextRequest } from "next/server";

import { getPoolTrend } from "@/lib/traxrTrendService";
import {
  getPoolById,
  getDatasetPoolsPage,
  getDatasetSummary,
  getTopPools,
  getTopPoolsTotal,
  getTraxrScore,
  searchDatasetPools,
  searchPools,
} from "@/lib/traxrService";

const DATASET_CACHE_CONTROL =
  "public, max-age=15, s-maxage=60, stale-while-revalidate=120";

const json = (
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: headers ? new Headers(headers) : undefined,
  });

const notFound = (message = "Not found") =>
  json({ error: message }, 404);

function decodeSlug(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  const { slug = [] } = await context.params;
  const [resource, id] = slug;

  if (!resource) {
    return notFound("Missing endpoint");
  }

  try {
    switch (resource) {
      case "score": {
        const mintA = request.nextUrl.searchParams.get("mintA");
        const mintB = request.nextUrl.searchParams.get("mintB");
        const dataset = request.nextUrl.searchParams.get("dataset") || undefined;

        if (!mintA || !mintB) {
          return json(
            { error: "mintA and mintB are required" },
            400,
          );
        }

        const score = await getTraxrScore(mintA, mintB, dataset);
        if (!score) {
          return notFound("No Solana pool found for pair");
        }
        return json(score);
      }
      case "pools": {
        if (id) {
          const poolId = decodeSlug(id);
          const dataset = request.nextUrl.searchParams.get("dataset") || undefined;
          const pool = await getPoolById(poolId, dataset);
          if (!pool) return notFound("Pool not found");
          return json(pool);
        }

        const limitParam = request.nextUrl.searchParams.get("limit");
        const offsetParam = request.nextUrl.searchParams.get("offset");
        const pageParam = request.nextUrl.searchParams.get("page");
        const includeMeta = request.nextUrl.searchParams.get("meta") === "true";
        const limit =
          limitParam !== null
            ? Number.parseInt(limitParam, 10)
            : undefined;
        if (
          typeof limitParam === "string" &&
          limitParam.toLowerCase() === "all"
        ) {
          return json({ error: "limit=all is not supported" }, 400);
        }
        const offset =
          offsetParam
            ? Number.parseInt(offsetParam, 10)
            : pageParam && typeof limit === "number" && Number.isFinite(limit)
              ? Math.max(0, (Number.parseInt(pageParam, 10) - 1) * limit)
              : undefined;
        const pools = await getTopPools(limit, offset);
        if (!includeMeta) return json(pools);
        const total = await getTopPoolsTotal();
        const safeLimit =
          typeof limit === "number" && Number.isFinite(limit) && limit > 0
            ? limit
            : pools.length;
        const safeOffset =
          typeof offset === "number" && Number.isFinite(offset) && offset > 0
            ? offset
            : 0;
        const page =
          safeLimit > 0 ? Math.floor(safeOffset / safeLimit) + 1 : 1;
        return json({ total, limit: safeLimit, offset: safeOffset, page, pools });
      }
      case "dataset": {
        const dataset = request.nextUrl.searchParams.get("name") || "";
        if (!dataset) {
          return json({ error: "Missing dataset name" }, 400);
        }
        const limitParam = request.nextUrl.searchParams.get("limit");
        const offsetParam = request.nextUrl.searchParams.get("offset");
        const includeSummary =
          request.nextUrl.searchParams.get("summary") === "true";
        const limit =
          limitParam && limitParam.toLowerCase() !== "all"
            ? Number.parseInt(limitParam, 10)
            : undefined;
        const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;
        const payload = await getDatasetPoolsPage(dataset, limit, offset);
        if (!includeSummary) {
          return json(payload, 200, { "Cache-Control": DATASET_CACHE_CONTROL });
        }
        const summary = await getDatasetSummary(dataset);
        return json({ ...payload, summary }, 200, {
          "Cache-Control": DATASET_CACHE_CONTROL,
        });
      }
      case "dataset-summary": {
        const dataset = request.nextUrl.searchParams.get("name") || "";
        if (!dataset) {
          return json({ error: "Missing dataset name" }, 400);
        }
        const summary = await getDatasetSummary(dataset);
        return json(summary, 200, { "Cache-Control": DATASET_CACHE_CONTROL });
      }
      case "search": {
        const query = request.nextUrl.searchParams.get("q") || "";
        if (!query.trim()) return json([]);
        const limitParam = request.nextUrl.searchParams.get("limit");
        const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;
        const dataset = request.nextUrl.searchParams.get("dataset") || "";
        const results = dataset
          ? await searchDatasetPools(dataset, query, limit)
          : await searchPools(query, limit);
        return json(results);
      }
      case "pool-trend": {
        const poolId = request.nextUrl.searchParams.get("poolId") || "";
        const dataset = request.nextUrl.searchParams.get("dataset") || undefined;
        if (!poolId) {
          return json({ error: "Missing poolId" }, 400);
        }

        const trend = getPoolTrend(poolId, dataset);
        return json(trend);
      }
      case "alerts": {
        const pools = await getTopPools();
        const alerts = pools
          .filter((pool) => pool.warnings?.length)
          .map((pool) => ({
            poolId: pool.poolId,
            score: pool.score,
            ctsNodes: pool.ctsNodes,
            warnings: pool.warnings,
            tokenAName: pool.tokenAName,
            tokenASymbol: pool.tokenASymbol,
            tokenBName: pool.tokenBName,
            tokenBSymbol: pool.tokenBSymbol,
            updatedAt: pool.updatedAt,
          }));

        return json({ count: alerts.length, alerts });
      }
      default:
        return notFound("Unknown endpoint");
    }
  } catch (e) {
    console.error("[TRAXR] API error", e);
    return json({ error: "Internal error" }, 500);
  }
}
