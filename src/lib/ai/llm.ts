/**
 * Server-only chat-completion adapter (OpenAI-compatible providers).
 * Keep imports rooted in Route Handlers; this module has no client entry point
 * and never exposes credentials through its return type.
 *
 * 기본 제공자는 DeepSeek이다. base URL을 비워 두면 기본값으로 붙는다 — 예전에는
 * 필수였고, 값이 허용 목록 밖이면 조용히 예외가 나 규칙 폴백으로만 돌았다(운영에서
 * 실제로 그 상태였다). 설정 하나가 빠졌다고 기능이 통째로 죽지 않게 기본값을 둔다.
 */
export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmCompletionOptions {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  responseFormat?: { type: 'json_object' };
  enableThinking?: boolean;
  timeoutMs?: number;
}

export interface LlmClientDeps {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * 실패 사유를 부를 이름. 화면·응답에 그대로 실어도 제공사·모델·키가 드러나지 않는
 * 낱말만 쓴다(응답 privacy 테스트가 이 규칙을 지킨다).
 */
/**
 * `upstream_rejected`는 자격증명·과금처럼 다시 걸어도 결과가 같은 거절이다. 재시도로는
 * 못 고치므로 호출자가 남은 시도를 건너뛴다(잔액 0인 계정에서 3회를 다 태우면 사용자만
 * 기다린다).
 */
export type LlmFailureCode =
  | 'credential_missing'
  | 'endpoint_invalid'
  | 'endpoint_not_allowed'
  | 'upstream_status'
  | 'upstream_rejected'
  | 'upstream_timeout'
  | 'upstream_unreachable'
  | 'response_not_json';

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: LlmFailureCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** 기본 제공자(DeepSeek). 환경변수가 비어 있을 때 쓰인다. */
export const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com/v1';
/** 최저가 계열. 의도 파싱은 짧은 JSON 한 덩이라 flash로 충분하다. */
export const DEFAULT_PRIMARY_MODEL = 'deepseek-v4-flash';
/** 1차가 JSON을 깨뜨렸을 때만 쓰는 상위 모델. */
export const DEFAULT_FALLBACK_MODEL = 'deepseek-v4-pro';

const DEFAULT_TIMEOUT_MS = 12_000;

const DASHSCOPE_HOSTS = new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']);
const DEEPSEEK_HOSTS = new Set(['api.deepseek.com']);
const ALLOWED_HOSTS = new Set([...DEEPSEEK_HOSTS, ...DASHSCOPE_HOSTS]);

/** 호스트가 DashScope 계열인가 — 그쪽에만 있는 요청 필드를 가르는 데 쓴다. */
export function isDashscopeHost(hostname: string): boolean {
  return DASHSCOPE_HOSTS.has(hostname);
}

export function resolveBaseUrl(raw?: string): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : DEFAULT_LLM_BASE_URL;
}

/** 검증만 하고 던지지 않는 판정. 상태 표시가 "쓸 수 있는가"를 물을 때 쓴다. */
export function describeEndpoint(raw?: string): { ok: true; url: string } | { ok: false; code: LlmFailureCode } {
  try {
    return { ok: true, url: validateBaseUrl(resolveBaseUrl(raw)) };
  } catch (error) {
    return { ok: false, code: error instanceof LlmError ? error.code : 'endpoint_invalid' };
  }
}

function validateBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch (error) {
    throw new LlmError('AI endpoint is invalid', 'endpoint_invalid', error);
  }

  if (url.protocol !== 'https:') {
    throw new LlmError('AI endpoint must use HTTPS', 'endpoint_not_allowed');
  }

  if (url.username || url.password) {
    throw new LlmError('AI endpoint must not contain credentials', 'endpoint_not_allowed');
  }

  if (!ALLOWED_HOSTS.has(url.hostname) || (url.port && url.port !== '443')) {
    throw new LlmError('AI endpoint host is not allowed', 'endpoint_not_allowed');
  }

  if (url.search || url.hash || /\.\.|%2e/i.test(trimmed)) {
    throw new LlmError(
      'AI endpoint must not contain query, fragment, or traversal segments',
      'endpoint_not_allowed',
    );
  }

  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/chat/completions')
    ? basePath
    : `${basePath}/chat/completions`;

  return url.toString();
}

export async function createChatCompletion(
  deps: LlmClientDeps,
  options: LlmCompletionOptions,
): Promise<unknown> {
  const apiKey = deps.apiKey?.trim();

  if (!apiKey) {
    throw new LlmError('AI credential is missing', 'credential_missing');
  }

  const url = validateBaseUrl(resolveBaseUrl(deps.baseUrl));
  const dashscope = isDashscopeHost(new URL(url).hostname);
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetchImpl(url, {
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
          // enable_thinking은 DashScope 전용 필드다. 다른 제공자에 보내면 요청이
          // 통째로 400으로 되돌아온다.
          ...(dashscope ? { enable_thinking: options.enableThinking ?? false } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new LlmError(
        aborted ? 'AI request timed out' : 'AI request could not be delivered',
        aborted ? 'upstream_timeout' : 'upstream_unreachable',
        error,
      );
    }

    if (!response.ok) {
      const permanent =
        response.status === 401 || response.status === 402 || response.status === 403;
      throw new LlmError(
        `AI request failed with status ${response.status}`,
        permanent ? 'upstream_rejected' : 'upstream_status',
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };

    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      throw new LlmError('AI response content is missing or not a string', 'response_not_json');
    }

    try {
      return JSON.parse(content);
    } catch (error) {
      throw new LlmError(
        'Failed to parse AI response content as JSON',
        'response_not_json',
        error,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
