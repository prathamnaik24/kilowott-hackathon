import { WOO_ORDER_STATUSES } from '../integrations/woocommerce/woocommerce.types.js';
import type { MockStoreState } from './mock-data.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Server-rendered page that mimics the WooCommerce admin "Orders" screen. */
export function renderControlPanel(state: MockStoreState, base: string): string {
  const rows = [...state.orders]
    .reverse()
    .slice(0, 40)
    .map((o) => {
      const options = WOO_ORDER_STATUSES.map(
        (s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`,
      ).join('');
      const who = `${o.billing.first_name} ${o.billing.last_name}${o.customer_id === 0 ? ' <em>(guest)</em>' : ''}`;
      return `<tr>
        <td>#${o.number}</td><td>${esc(who)}</td><td>${o.currency} ${o.total}</td>
        <td><span class="st st-${o.status}">${o.status}</span></td>
        <td><form method="post" action="${base}/panel/orders/${o.id}/status">
          <select name="status">${options}</select> <button>Update</button></form></td>
      </tr>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Mock WooCommerce · Orders</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:14px/1.4 -apple-system,Segoe UI,sans-serif;margin:0;background:#f0f0f1;color:#1d2327}
  header{background:#1d2327;color:#fff;padding:12px 20px;display:flex;gap:16px;align-items:center}
  header b{color:#c9a6ff} main{padding:20px;max-width:1000px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #c3c4c7}
  td,th{padding:8px 10px;border-bottom:1px solid #f0f0f1;text-align:left}
  .st{padding:2px 8px;border-radius:4px;background:#e5e5e5;font-size:12px}
  .st-processing{background:#c6e1c6}.st-on-hold{background:#f8dda7}.st-completed{background:#c8d7e1}
  .st-cancelled,.st-failed{background:#eba3a3}.st-refunded{background:#e5e5e5}
  button{background:#2271b1;color:#fff;border:0;border-radius:3px;padding:5px 10px;cursor:pointer}
  .bar{display:flex;gap:8px;margin-bottom:12px}
</style></head><body>
<header><b>WooCommerce</b><span>Mock store admin · ${state.orders.length} orders · ${state.customers.length} customers</span></header>
<main>
  <p>Changes here fire signed <code>order.*</code> / <code>customer.*</code> webhooks to WooPulse CRM, exactly like a real store.</p>
  <div class="bar">
    <form method="post" action="${base}/panel/orders"><button>+ Simulate new order</button></form>
    <form method="post" action="${base}/panel/customers"><button>+ Simulate new customer</button></form>
  </div>
  <table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Change status</th></tr></thead>
  <tbody>${rows}</tbody></table>
</main></body></html>`;
}
