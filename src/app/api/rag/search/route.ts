import { NextResponse } from "next/server";
import { z } from "zod";

import { augmentQueryWithRag } from "@/lib/rag/augment";
import { assessQuerySafety, MAX_QUERY_LENGTH } from "@/lib/analysis/query-rules";

const BodySchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    limit: z.number().int().min(1).max(10).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  })
  .strict();

/**
 * Public RAG search for debugging and future UI “근거 보기”.
 * Offline corpus only — no external vector DB required.
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

  const augmentation = augmentQueryWithRag(safety.query, {
    extraTags: parsed.data.tags,
  });

  const limit = parsed.data.limit ?? 4;
  const hits = augmentation.hits.slice(0, limit).map((hit) => ({
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
    mode: "hybrid-bm25-hash-embed",
    hits,
    context: augmentation.context,
  });
}
