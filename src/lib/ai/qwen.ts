/**
 * Server-only adapter. Keep imports rooted in Route Handlers; this module has
 * no client entry point and never exposes credentials through its return type.
 */
export interface QwenMessage {
  role: 'system' | 'user';
  content: string;
}

export interface QwenCompletionOptions {
  model: string;
  messages: QwenMessage[];
  temperature?: number;
  responseFormat?: { type: 'json_object' };
  enableThinking?: boolean;
  timeoutMs?: number;
}

export interface QwenClientDeps {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class QwenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'QwenError';
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const ALLOWED_DASHSCOPE_HOSTS = new Set([
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
]);

function validateBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch (error) {
    throw new QwenError('AI endpoint is invalid', error);
  }

  if (url.protocol !== 'https:') {
    throw new QwenError('AI endpoint must use HTTPS');
  }

  if (url.username || url.password) {
    throw new QwenError('AI endpoint must not contain credentials');
  }

  if (!ALLOWED_DASHSCOPE_HOSTS.has(url.hostname) || (url.port && url.port !== '443')) {
    throw new QwenError('AI endpoint host is not allowed');
  }

  if (url.search || url.hash || /\.\.|%2e/i.test(trimmed)) {
    throw new QwenError('AI endpoint must not contain query, fragment, or traversal segments');
  }

  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/chat/completions')
    ? basePath
    : `${basePath}/chat/completions`;

  return url.toString();
}

export async function createQwenCompletion(
  deps: QwenClientDeps,
  options: QwenCompletionOptions,
): Promise<unknown> {
  const apiKey = deps.apiKey?.trim();

  if (!apiKey) {
    throw new QwenError('AI credential is missing');
  }

  const baseUrl = deps.baseUrl?.trim();

  if (!baseUrl) {
    throw new QwenError('AI endpoint is missing');
  }

  const url = validateBaseUrl(baseUrl);
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.1,
        response_format: options.responseFormat ?? { type: 'json_object' },
        enable_thinking: options.enableThinking ?? false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new QwenError(`AI request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };

    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      throw new QwenError('AI response content is missing or not a string');
    }

    try {
      return JSON.parse(content);
    } catch (error) {
      throw new QwenError('Failed to parse AI response content as JSON', error);
    }
  } finally {
    clearTimeout(timeout);
  }
}
