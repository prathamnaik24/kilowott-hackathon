<?php
/**
 * Plugin Name: WooPulse local webhooks (LOCAL TEST STORE ONLY)
 * Description: Lets WooCommerce deliver webhooks to WooPulse on a private Docker network.
 *
 * WooCommerce sends webhooks with wp_safe_remote_request(), which refuses private IPs
 * (Docker networks are 172.x) and every port except 80/443/8080. That blocks delivery to
 * http://api:4000 or http://host.docker.internal:4000. This must-use plugin allows exactly
 * those WooPulse hosts and port 4000. Never install it on a production store.
 */

const WOOPULSE_ALLOWED_HOSTS = array( 'api', 'host.docker.internal' );

add_filter( 'http_request_host_is_external', function ( $is_external, $host ) {
	return in_array( $host, WOOPULSE_ALLOWED_HOSTS, true ) ? true : $is_external;
}, 10, 2 );

add_filter( 'http_allowed_safe_ports', function ( $ports, $host ) {
	if ( in_array( $host, WOOPULSE_ALLOWED_HOSTS, true ) ) {
		$ports[] = 4000;
	}
	return $ports;
}, 10, 2 );

/*
 * WooCommerce normally queues deliveries in Action Scheduler, which runs via WP-Cron loopback
 * requests to the site URL (http://localhost:8080). Inside the container nothing listens on
 * :8080, so queued webhooks would never fire. Deliver synchronously instead.
 */
add_filter( 'woocommerce_webhook_deliver_async', '__return_false' );
