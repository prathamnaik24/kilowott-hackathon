import { createHmac, randomBytes } from 'node:crypto';

/**
 * One-legged OAuth 1.0a request signing, as required by WooCommerce for REST calls over plain
 * HTTP (Basic auth with consumer key/secret is only accepted over HTTPS).
 *
 * Mirrors WC_REST_Authentication::check_oauth_signature():
 *   base string = METHOD & rawurlencode(url) & join('%26', enc(key) . '%3D' . enc(value))
 *   where enc() = rawurlencode then '%' → '%25' (i.e. double-encoded), params sorted by strcmp,
 *   key = consumer_secret . '&'
 */

/** PHP rawurlencode / RFC 3986: everything except A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface OAuthInput {
  method: string;
  /** Absolute URL without query string, exactly as WordPress sees its home URL + path. */
  url: string;
  query: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
  /** Injectable for deterministic tests. */
  timestamp?: number;
  nonce?: string;
}

export function oauthSignatureBaseString(method: string, url: string, params: Record<string, string>): string {
  const normalized = Object.keys(params)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) // strcmp: byte order
    .map((k) => `${rfc3986(k).replace(/%/g, '%25')}%3D${rfc3986(params[k]).replace(/%/g, '%25')}`);
  return `${method.toUpperCase()}&${rfc3986(url)}&${normalized.join('%26')}`;
}

/** Returns the full query parameter set (original + oauth_*) including oauth_signature. */
export function signOAuthRequest(input: OAuthInput): Record<string, string> {
  const params: Record<string, string> = {
    ...input.query,
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
  };
  const base = oauthSignatureBaseString(input.method, input.url, params);
  const signature = createHmac('sha256', `${input.consumerSecret}&`).update(base).digest('base64');
  return { ...params, oauth_signature: signature };
}
