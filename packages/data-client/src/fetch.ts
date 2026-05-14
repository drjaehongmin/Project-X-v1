// Low-level HTTP client.  Handles bearer auth, JSON encoding, refresh
// on 401, and module-id propagation.  Built on the global `fetch` so
// it works in browser and Node 20+ without polyfills.

export interface TokenStore {
  getAccessToken(): string | null;
  // Called when a 401 is received.  Returns the new access token, or
  // null if refresh failed (caller should surface the original 401).
  refresh(): Promise<string | null>;
  // Optional: called after a successful refresh so the shell can
  // persist the new token.
  onAccessTokenChanged?(token: string): void;
}

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly tokenStore: TokenStore;
  readonly moduleId?: string;
}

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly moduleId?: string;
}

export interface HttpResponse<T> {
  readonly status: number;
  readonly data: T;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export interface HttpClient {
  request<T>(req: HttpRequest): Promise<HttpResponse<T>>;
  get<T>(path: string, opts?: Omit<HttpRequest, 'method' | 'path'>): Promise<T>;
  post<T>(path: string, body: unknown, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
  patch<T>(path: string, body: unknown, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const trimmedBase = options.baseUrl.replace(/\/+$/, '');

  async function send<T>(req: HttpRequest, retry: boolean): Promise<HttpResponse<T>> {
    const url = buildUrl(trimmedBase, req.path, req.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = options.tokenStore.getAccessToken();
    if (token !== null) headers['Authorization'] = `Bearer ${token}`;
    const moduleId = req.moduleId ?? options.moduleId;
    if (moduleId !== undefined) headers['X-Module-Id'] = moduleId;

    const init: RequestInit = {
      method: req.method,
      headers,
      ...(req.body !== undefined && { body: JSON.stringify(req.body) }),
      ...(req.signal !== undefined && { signal: req.signal }),
    };

    const response = await fetch(url, init);

    if (response.status === 401 && retry) {
      const refreshed = await options.tokenStore.refresh();
      if (refreshed !== null) {
        options.tokenStore.onAccessTokenChanged?.(refreshed);
        return send<T>(req, false);
      }
    }

    const contentType = response.headers.get('content-type') ?? '';
    const bodyText = await response.text();
    const data = contentType.includes('application/json') && bodyText.length > 0
      ? (JSON.parse(bodyText) as unknown)
      : null;

    if (!response.ok) {
      const errorPayload =
        data !== null && typeof data === 'object' && 'error' in data
          ? (data as { error: { code?: string; message?: string; details?: unknown } }).error
          : undefined;
      throw new HttpError(
        response.status,
        errorPayload?.code ?? 'http_error',
        errorPayload?.message ?? response.statusText,
        errorPayload?.details,
      );
    }

    return { status: response.status, data: data as T };
  }

  const client: HttpClient = {
    request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
      return send<T>(req, true);
    },
    async get<T>(
      path: string,
      opts: Omit<HttpRequest, 'method' | 'path'> = {},
    ): Promise<T> {
      const res = await send<T>({ method: 'GET', path, ...opts }, true);
      return res.data;
    },
    async post<T>(
      path: string,
      body: unknown,
      opts: Omit<HttpRequest, 'method' | 'path' | 'body'> = {},
    ): Promise<T> {
      const res = await send<T>({ method: 'POST', path, body, ...opts }, true);
      return res.data;
    },
    async patch<T>(
      path: string,
      body: unknown,
      opts: Omit<HttpRequest, 'method' | 'path' | 'body'> = {},
    ): Promise<T> {
      const res = await send<T>({ method: 'PATCH', path, body, ...opts }, true);
      return res.data;
    },
  };

  return client;
}

function buildUrl(
  base: string,
  path: string,
  query?: Readonly<Record<string, string | undefined>>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${normalizedPath}`;
  if (query === undefined) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.append(key, value);
  }
  const qs = params.toString();
  return qs.length === 0 ? url : `${url}?${qs}`;
}
