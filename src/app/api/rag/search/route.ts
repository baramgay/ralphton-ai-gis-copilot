import { NextResponse } from "next/server";
import { z } from "zod";

import { assessQuerySafety, MAX_QUERY_LENGTH } from "@/lib/analysis/query-rules";
import { formatRagContext } from "@/lib/rag/retrieve";
import { getEmbedCacheMeta } from "@/lib/rag/embed-cache";
import { retrieveRagChunksWithRemote } from "@/lib/rag/retrieve-remote";

const BodySchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    limit: z.number().int().min(1).max(10).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
    useRemoteEmbed: z.boolean().optional(),
  })
  .strict();

/**
 * Public RAG search for debugging and UI “근거 보기”.
 * Default: offline hybrid BM25 + hash-embed.
 * Optional: DashScope embedding re-rank when keys + useRemoteEmbed.
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const safety = assessQuerySafety(parsed.data.query);
  if (!safety.safe) {
    return NextResponse.json({ ok: false, error: "처리할 수 없는 질의입니다." }, { status: 400 });
  }

  const limit = parsed.data.limit ?? 4;
  const wantRemote = parsed.data.useRemoteEmbed !== false;
  const embedDeps =
    wantRemote && process.env.QWEN_API_KEY && process.env.QWEN_BASE_URL
      ? {
          apiKey: process.env.QWEN_API_KEY,
          baseUrl: process.env.QWEN_BASE_URL,
          model: process.env.QWEN_EMBED_MODEL,
        }
      : undefined;

  const { hits: rawHits, remote } = await retrieveRagChunksWithRemote(
    {
      query: safety.query,
      limit,
      boostTags: parsed.data.tags,
    },
    embedDeps,
  );

  const hits = rawHits.map((hit) => ({
    id: hit.chunk.id,
    title: hit.chunk.title,
    body: hit.chunk.body,
    tags: hit.chunk.tags,
    score: Number(hit.score.toFixed(3)),
    lexicalScore:
      hit.lexicalScore !== undefined ? Number(hit.lexicalScore.toFixed(3)) : undefined,
    vectorScore:
      hit.vectorScore !== undefined ? Number(hit.vectorScore.toFixed(3)) : undefined,
    reasons: hit.reasons,
  }));

  return NextResponse.json({
    ok: true,
    query: safety.query,
    mode: remote ? "hybrid-bm25-hash+remote-embed" : "hybrid-bm25-hash-embed",
    remoteEmbed: remote,
    embedCache: getEmbedCacheMeta(),
    hits,
    context: formatRagContext(rawHits),
  });
}
