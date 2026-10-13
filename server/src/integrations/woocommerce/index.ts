import { env, wooStoreUrl } from '../../config/env.js';
import { WooCommerceClient } from './woocommerce.client.js';

export function createWooClient() {
  return new WooCommerceClient({
    storeUrl: wooStoreUrl(),
    consumerKey: env.WOO_CONSUMER_KEY,
    consumerSecret: env.WOO_CONSUMER_SECRET,
    signatureBaseUrl: env.WOO_SIGNATURE_BASE_URL || undefined,
  });
}
