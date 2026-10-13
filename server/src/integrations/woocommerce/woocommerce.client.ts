import { signOAuthRequest } from './woocommerce.oauth.js';
import type { WooCustomer, WooOrder } from './woocommerce.types.js';

export interface WooClientConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /**
   * Base URL used for OAuth signatures when it differs from storeUrl — WordPress signs against its
   * own home URL (e.g. API in Docker calls http://wordpress but WP thinks it is http://localhost:8080).
   */
  signatureBaseUrl?: string;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

export class WooCommerceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface Page<T> {
  data: T;
  totalPages: number;
}

/** Thin typed client over the WooCommerce REST API v3 (consumer key/secret via HTTP Basic Auth). */
export class WooCommerceClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: WooClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getCustomers(page = 1, perPage = 50) {
    return this.request<WooCustomer[]>('/customers', { page, per_page: perPage });
  }

  getOrders(page = 1, perPage = 50, status?: string) {
    return this.request<WooOrder[]>('/orders', { page, per_page: perPage, ...(status ? { status } : {}) });
  }

  async getOrderById(id: number) {
    return (await this.request<WooOrder>(`/orders/${id}`)).data;
  }

  async getCustomerById(id: number) {
    return (await this.request<WooCustomer>(`/customers/${id}`)).data;
  }

  async updateOrderStatus(id: number, status: string) {
    return (await this.request<WooOrder>(`/orders/${id}`, {}, { method: 'PUT', body: { status } })).data;
  }

  /** Iterates every page of a paginated collection using the X-WP-TotalPages header. */
  async fetchAll<T>(fetchPage: (page: number) => Promise<Page<T[]>>): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const { data, totalPages } = await fetchPage(page);
      all.push(...data);
      if (page >= totalPages || data.length === 0) return all;
    }
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number> = {},
    init: { method?: string; body?: unknown } = {},
    attempt = 1,
  ): Promise<Page<T>> {
    const method = init.method ?? 'GET';
    const base = this.config.storeUrl.replace(/\/+$/, '');
    const url = new URL(`${base}/wp-json/wc/v3${path}`);
    const params = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (url.protocol === 'https:') {
      // WooCommerce accepts consumer key/secret as HTTP Basic auth only over HTTPS.
      headers.Authorization = `Basic ${Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64')}`;
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    } else {
      // Over plain HTTP (e.g. the local Docker store) WooCommerce requires OAuth 1.0a signatures.
      // The signature must use the URL WordPress believes it lives at (its home URL), which differs
      // from the request URL when calling across a Docker network (http://wordpress vs http://localhost:8080).
      const signingBase = (this.config.signatureBaseUrl ?? base).replace(/\/+$/, '');
      const signed = signOAuthRequest({
        method,
        url: `${signingBase}/wp-json/wc/v3${path}`,
        query: params,
        consumerKey: this.config.consumerKey,
        consumerSecret: this.config.consumerSecret,
      });
      for (const [k, v] of Object.entries(signed)) url.searchParams.set(k, v);
    }

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    // Back off and retry on rate limits / transient store errors.
    if (RETRYABLE.has(res.status) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      return this.request<T>(path, query, init, attempt + 1);
    }
    if (!res.ok) {
      throw new WooCommerceError(`WooCommerce ${init.method ?? 'GET'} ${path} failed: ${res.status}`, res.status);
    }
    return {
      data: (await res.json()) as T,
      totalPages: Number(res.headers.get('x-wp-totalpages') ?? 1),
    };
  }
}
