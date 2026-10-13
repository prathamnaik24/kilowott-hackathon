#!/usr/bin/env bash
# Idempotent provisioning of the LOCAL WooCommerce test store (runs in the wordpress:cli container).
# Installs WordPress + WooCommerce, enables pretty permalinks (required by /wp-json), seeds products,
# customers and orders, creates a fixed local-only REST API key, and registers signed webhooks.
set -euo pipefail

SITE_URL="${WOO_SITE_URL:-http://localhost:8080}"
WEBHOOK_URL="${WOOPULSE_WEBHOOK_URL:-http://host.docker.internal:4000/api/webhooks/woocommerce}"
WEBHOOK_SECRET="${WOOPULSE_WEBHOOK_SECRET:-woopulse-webhook-secret}"
# Fixed keys are acceptable ONLY because this store is local, throwaway test data.
CONSUMER_KEY="${WOO_LOCAL_CONSUMER_KEY:-ck_woopulse_local_test_store_key_00000001}"
CONSUMER_SECRET="${WOO_LOCAL_CONSUMER_SECRET:-cs_woopulse_local_test_store_secret_0001}"

wp() { command wp --path=/var/www/html "$@"; }

echo "[setup] waiting for WordPress files and database..."
until [ -f /var/www/html/wp-config.php ] && wp db check >/dev/null 2>&1; do sleep 3; done

if ! wp core is-installed >/dev/null 2>&1; then
  echo "[setup] installing WordPress"
  wp core install --url="$SITE_URL" --title="WooPulse Test Store" \
    --admin_user=admin --admin_password=admin_password --admin_email=admin@example.com --skip-email
fi

wp rewrite structure '/%postname%/' >/dev/null
wp rewrite flush >/dev/null

if ! wp plugin is-active woocommerce >/dev/null 2>&1; then
  echo "[setup] installing WooCommerce"
  wp plugin install woocommerce --activate
fi
wp option update woocommerce_currency USD >/dev/null
wp option update woocommerce_onboarding_profile '{"skipped":true}' --format=json >/dev/null

# ---- REST API key (read/write) ------------------------------------------------------------
wp eval "
global \$wpdb;
\$table = \$wpdb->prefix . 'woocommerce_api_keys';
\$wpdb->delete(\$table, array('description' => 'WooPulse CRM (local)'));
\$wpdb->insert(\$table, array(
  'user_id' => 1, 'description' => 'WooPulse CRM (local)', 'permissions' => 'read_write',
  'consumer_key' => wc_api_hash('$CONSUMER_KEY'), 'consumer_secret' => '$CONSUMER_SECRET',
  'truncated_key' => substr('$CONSUMER_KEY', -7),
));
echo \"[setup] REST API key ready\n\";
"

# ---- Seed data (only once) ----------------------------------------------------------------
if [ "$(wp option get woopulse_seeded 2>/dev/null || echo no)" != "yes" ]; then
  echo "[setup] seeding products, customers and orders"
  declare -a P
  for spec in "Organic Cold Brew Coffee|24.50" "Handwoven Cotton Throw|68.00" "Ceramic Pour-Over Set|45.00" \
              "Noise-Cancelling Earbuds|129.00" "Leather Weekender Bag|219.00" "Ergonomic Office Chair|349.00"; do
    P+=("$(wp wc product create --user=admin --name="${spec%%|*}" --type=simple --regular_price="${spec##*|}" --porcelain)")
  done

  customer() { # first last email city country
    wp wc customer create --user=admin --porcelain --email="$3" --first_name="$1" --last_name="$2" \
      --password="customer_password" \
      --billing="{\"first_name\":\"$1\",\"last_name\":\"$2\",\"email\":\"$3\",\"city\":\"$4\",\"country\":\"$5\",\"phone\":\"+91 9800000000\"}"
  }
  C1=$(customer Priya Sharma priya.sharma@example.com Mumbai IN)
  C2=$(customer Arjun Mehta arjun.mehta@example.com Bengaluru IN)
  C3=$(customer Liam Walker liam.walker@example.com London GB)
  C4=$(customer Aisha Khan aisha.khan@example.com Dubai AE)
  C5=$(customer Kabir Iyer kabir.iyer@example.com Chennai IN)

  order() { # customer_id status first last email product qty
    wp wc shop_order create --user=admin --porcelain --customer_id="$1" --status="$2" \
      --payment_method=bacs --payment_method_title="Direct bank transfer" \
      --billing="{\"first_name\":\"$3\",\"last_name\":\"$4\",\"email\":\"$5\",\"country\":\"IN\"}" \
      --line_items="[{\"product_id\":$6,\"quantity\":$7}]" >/dev/null
  }
  order "$C1" completed  Priya Sharma priya.sharma@example.com "${P[0]}" 2
  order "$C1" on-hold    Priya Sharma priya.sharma@example.com "${P[4]}" 1
  order "$C2" processing Arjun Mehta arjun.mehta@example.com "${P[5]}" 1
  order "$C2" completed  Arjun Mehta arjun.mehta@example.com "${P[2]}" 1
  order "$C3" pending    Liam Walker liam.walker@example.com "${P[3]}" 1
  order "$C4" refunded   Aisha Khan aisha.khan@example.com "${P[1]}" 1
  order "$C4" processing Aisha Khan aisha.khan@example.com "${P[0]}" 3
  order "$C5" cancelled  Kabir Iyer kabir.iyer@example.com "${P[3]}" 1
  order "$C5" completed  Kabir Iyer kabir.iyer@example.com "${P[2]}" 2
  order 0     processing Vikram Desai vikram.desai@guestmail.com "${P[1]}" 1   # guest checkout
  order 0     completed  Olivia Chen olivia.chen@guestmail.com "${P[0]}" 1     # guest checkout
  wp option update woopulse_seeded yes >/dev/null
fi

# ---- Webhooks (recreated so URL/secret changes apply) -------------------------------------
for id in $(wp wc webhook list --user=admin --field=id 2>/dev/null); do
  wp wc webhook delete "$id" --user=admin --force=true >/dev/null
done
for topic in order.created order.updated customer.created customer.updated; do
  wp wc webhook create --user=admin --name="WooPulse $topic" --topic="$topic" \
    --delivery_url="$WEBHOOK_URL" --secret="$WEBHOOK_SECRET" --status=active --porcelain >/dev/null \
    && echo "[setup] webhook $topic → $WEBHOOK_URL" \
    || echo "[setup] WARNING: could not create webhook $topic"
done

cat <<EOF

[setup] Local WooCommerce store is ready.
  Store:        $SITE_URL   (WP admin: $SITE_URL/wp-admin  user: admin  pass: admin_password)
  REST API:     $SITE_URL/wp-json/wc/v3
  Consumer key: $CONSUMER_KEY
  Secret:       $CONSUMER_SECRET
  Webhooks  →   $WEBHOOK_URL
EOF
