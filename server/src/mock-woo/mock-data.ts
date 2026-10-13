import type { WooAddress, WooCustomer, WooOrder } from '../integrations/woocommerce/woocommerce.types.js';

/** Deterministic PRNG so every fresh boot produces the same demo store. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE: Array<[string, string, string, string]> = [
  ['Priya', 'Sharma', 'Mumbai', 'IN'],
  ['Arjun', 'Mehta', 'Bengaluru', 'IN'],
  ['Sara', 'Fernandes', 'Panaji', 'IN'],
  ['Liam', 'Walker', 'London', 'GB'],
  ['Aisha', 'Khan', 'Dubai', 'AE'],
  ['Rohan', 'Naik', 'Margao', 'IN'],
  ['Emma', 'Schulz', 'Berlin', 'DE'],
  ['Kabir', 'Iyer', 'Chennai', 'IN'],
  ['Noah', 'Brown', 'Austin', 'US'],
  ['Meera', 'Pillai', 'Kochi', 'IN'],
  ['Lucas', 'Martin', 'Paris', 'FR'],
  ['Ananya', 'Rao', 'Hyderabad', 'IN'],
];

const GUESTS: Array<[string, string, string, string]> = [
  ['Vikram', 'Desai', 'Pune', 'IN'],
  ['Olivia', 'Chen', 'Singapore', 'SG'],
  ['Dev', 'Kapoor', 'Delhi', 'IN'],
];

export const PRODUCTS: Array<[string, number]> = [
  ['Organic Cold Brew Coffee (1kg)', 24.5],
  ['Handwoven Cotton Throw', 68],
  ['Ceramic Pour-Over Set', 45],
  ['Noise-Cancelling Earbuds', 129],
  ['Bamboo Desk Organizer', 32],
  ['Leather Weekender Bag', 219],
  ['Smart LED Desk Lamp', 79],
  ['Single-Origin Tea Sampler', 28],
  ['Ergonomic Office Chair', 349],
  ['Stainless Steel Water Bottle', 22],
];

const PAYMENT = [
  ['razorpay', 'Razorpay (UPI / Cards)'],
  ['stripe', 'Credit Card (Stripe)'],
  ['cod', 'Cash on delivery'],
  ['paypal', 'PayPal'],
] as const;

export const toWooDate = (d: Date) => d.toISOString().slice(0, 19);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export function address(first: string, last: string, city: string, country: string, email: string, phone: string): WooAddress {
  return {
    first_name: first,
    last_name: last,
    company: '',
    address_1: `${(first.length * 7) % 90 + 10} Market Road`,
    address_2: '',
    city,
    state: '',
    postcode: '',
    country,
    email,
    phone,
  };
}

export interface MockStoreState {
  customers: WooCustomer[];
  orders: WooOrder[];
  nextCustomerId: number;
  nextOrderId: number;
}

/**
 * Generates a realistic store: registered customers with order histories, guest checkouts,
 * and orders deliberately placed in risky states (long on-hold, cancellations, refunds).
 */
export function generateStore(now = new Date(), seed = 42): MockStoreState {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  const customers: WooCustomer[] = PEOPLE.map(([first, last, city, country], i) => {
    const email = `${slug(first)}.${slug(last)}@example.com`;
    const created = hoursAgo(24 * (200 - i * 12));
    return {
      id: 101 + i,
      date_created_gmt: toWooDate(created),
      date_modified_gmt: toWooDate(created),
      email,
      first_name: first,
      last_name: last,
      role: 'customer',
      username: slug(first) + slug(last),
      billing: address(first, last, city, country, email, `+91 98${String(10000000 + i * 7919).slice(0, 8)}`),
      shipping: address(first, last, city, country, '', ''),
      is_paying_customer: true,
    };
  });

  const orders: WooOrder[] = [];
  let nextOrderId = 5001;

  const makeOrder = (
    customerId: number,
    billing: WooAddress,
    status: string,
    createdHoursAgo: number,
    modifiedHoursAgo: number,
    itemCount = 1 + Math.floor(rand() * 3),
  ): WooOrder => {
    const items = Array.from({ length: itemCount }, (_, idx) => {
      const [name, price] = pick(PRODUCTS);
      const quantity = 1 + Math.floor(rand() * 2);
      return { id: nextOrderId * 10 + idx, name, product_id: PRODUCTS.findIndex((p) => p[0] === name) + 1, quantity, total: (price * quantity).toFixed(2), price };
    });
    const total = items.reduce((s, li) => s + Number(li.total), 0);
    const [method, title] = pick(PAYMENT);
    const id = nextOrderId++;
    return {
      id,
      number: String(id),
      status,
      currency: 'USD',
      date_created_gmt: toWooDate(hoursAgo(createdHoursAgo)),
      date_modified_gmt: toWooDate(hoursAgo(modifiedHoursAgo)),
      total: total.toFixed(2),
      customer_id: customerId,
      billing,
      shipping: billing,
      payment_method: method,
      payment_method_title: title,
      line_items: items,
    };
  };

  // Order history: mostly completed, older orders first.
  customers.forEach((c, i) => {
    const historyCount = 1 + ((i * 3) % 5);
    for (let k = 0; k < historyCount; k++) {
      const age = 24 * (25 + k * 35 + i * 3);
      orders.push(makeOrder(c.id, c.billing, rand() < 0.88 ? 'completed' : 'refunded', age, age - 48));
    }
  });

  // Current pipeline with deliberate risk scenarios for the demo.
  const by = (first: string) => customers.find((c) => c.first_name === first)!;
  orders.push(makeOrder(by('Priya').id, by('Priya').billing, 'on-hold', 40, 30, 3)); // long on-hold
  orders.push(makeOrder(by('Liam').id, by('Liam').billing, 'on-hold', 6, 5, 1));
  orders.push(makeOrder(by('Arjun').id, by('Arjun').billing, 'processing', 120, 110, 2)); // slow fulfilment
  orders.push(makeOrder(by('Kabir').id, by('Kabir').billing, 'cancelled', 30, 20, 2)); // loyal customer cancelled
  orders.push(makeOrder(by('Emma').id, by('Emma').billing, 'failed', 8, 7, 1)); // failed payment
  orders.push(makeOrder(by('Aisha').id, by('Aisha').billing, 'refunded', 300, 280, 1));
  orders.push(makeOrder(by('Aisha').id, by('Aisha').billing, 'refunded', 200, 190, 1));
  orders.push(makeOrder(by('Aisha').id, by('Aisha').billing, 'processing', 10, 9, 1)); // refund pattern
  for (const c of customers.slice(6)) {
    orders.push(makeOrder(c.id, c.billing, pick(['processing', 'processing', 'pending', 'completed']), 3 + rand() * 20, 2));
  }

  // Guest checkouts (customer_id = 0): only known by billing email.
  GUESTS.forEach(([first, last, city, country], i) => {
    const email = `${slug(first)}.${slug(last)}@guestmail.com`;
    const billing = address(first, last, city, country, email, '');
    orders.push(makeOrder(0, billing, 'completed', 24 * (60 - i * 10), 24 * (58 - i * 10)));
    if (i === 0) orders.push(makeOrder(0, billing, 'processing', 12, 11, 2));
  });

  return { customers, orders, nextCustomerId: 101 + customers.length, nextOrderId };
}

export { PEOPLE, GUESTS, PAYMENT };
