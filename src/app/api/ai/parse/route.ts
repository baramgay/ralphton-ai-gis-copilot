import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseIntentWithFallbacks } from '@/lib/ai/parse-intent';
import { assessQuerySafety, MAX_QUERY_LENGTH } from '@/lib/analysis/query-rules';

const MAX_BODY_BYTES = 16 * 1024;
const INVALID_BODY_NOTICE = '요청 본문 형식이 올바르지 않습니다.';
const BODY_TOO_LARGE_NOTICE = '요청 본문이 너무 큽니다.';
const UNSAFE_QUERY_NOTICE = '요청한 질의는 처리할 수 없습니다.';

const ParseRequestSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(MAX_QUERY_LENGTH)
      .refine((value) => value.trim().length > 0)
      .transform((value) => value.trim()),
  })
  .strict();

class RequestBodyTooLargeError extends Error {}

async function readJsonWithinLimit(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');

  if (contentLength) {
    const declaredBytes = Number(contentLength);

    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) {
    return JSON.parse('');
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytesRead += value.byteLength;

    if (bytesRead > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return JSON.parse(text);
}

function errorResponse(notice: string, status: number) {
  return NextResponse.json(
    {
      intent: null,
      mode: 'demo',
      notice,
    },
    { status },
  );
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonWithinLimit(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(BODY_TOO_LARGE_NOTICE, 413);
    }

    return errorResponse(INVALID_BODY_NOTICE, 400);
  }

  const parsedBody = ParseRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return errorResponse(INVALID_BODY_NOTICE, 400);
  }

  const safety = assessQuerySafety(parsedBody.data.query);

  if (!safety.safe) {
    return errorResponse(UNSAFE_QUERY_NOTICE, 400);
  }

  const result = await parseIntentWithFallbacks(safety.query, {
    apiKey: process.env.QWEN_API_KEY,
    baseUrl: process.env.QWEN_BASE_URL,
    primaryModel: process.env.QWEN_PRIMARY_MODEL,
    fallbackModel: process.env.QWEN_JSON_FALLBACK_MODEL,
  });

  return NextResponse.json(result);
}
