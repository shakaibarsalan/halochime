<?php
/**
 * Removes the plugin's settings when it is deleted from the Plugins screen.
 *
 * @package Halochime
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'halochime_settings' );

if ( is_multisite() ) {
	$halochime_site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ( $halochime_site_ids as $halochime_site_id ) {
		switch_to_blog( $halochime_site_id );
		delete_option( 'halochime_settings' );
		restore_current_blog();
	}
}
