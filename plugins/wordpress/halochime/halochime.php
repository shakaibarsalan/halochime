<?php
/**
 * Plugin Name:       Halochime
 * Plugin URI:        https://halochime.vercel.app
 * Description:       Adds your Halochime voice and chat support agent to every page of your site.
 * Version:           1.0.0
 * Requires at least: 5.7
 * Requires PHP:      7.4
 * Author:            Halochime
 * Author URI:        https://halochime.vercel.app
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       halochime
 *
 * @package Halochime
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'HALOCHIME_VERSION', '1.0.0' );
define( 'HALOCHIME_OPTION', 'halochime_settings' );
define( 'HALOCHIME_DEFAULT_SCRIPT_URL', 'https://halochime.vercel.app/widget.js' );

/**
 * Saved settings merged with the defaults.
 *
 * @return array{public_key: string, enabled: bool, hide_for_admins: bool, script_url: string}
 */
function halochime_settings() {
	$defaults = array(
		'public_key'      => '',
		'enabled'         => true,
		'hide_for_admins' => false,
		'script_url'      => HALOCHIME_DEFAULT_SCRIPT_URL,
	);
	$saved    = get_option( HALOCHIME_OPTION, array() );
	return wp_parse_args( is_array( $saved ) ? $saved : array(), $defaults );
}

/**
 * Whether a public key looks like one from the Halochime dashboard (pk_ and letters, digits, - or _).
 *
 * @param string $key The key to check.
 * @return bool
 */
function halochime_is_public_key( $key ) {
	return (bool) preg_match( '/^pk_[A-Za-z0-9_-]{10,64}$/', $key );
}

/**
 * Cleans the settings form before WordPress saves it (options.php has already unslashed it and checked
 * the nonce and capability). Invalid values keep the saved value and show a notice; Settings pages
 * show those notices by themselves.
 *
 * @param mixed $input The submitted values.
 * @return array
 */
function halochime_sanitize_settings( $input ) {
	$current = halochime_settings();
	$input   = is_array( $input ) ? $input : array();
	$clean   = array(
		'enabled'         => ! empty( $input['enabled'] ),
		'hide_for_admins' => ! empty( $input['hide_for_admins'] ),
		'public_key'      => $current['public_key'],
		'script_url'      => $current['script_url'],
	);

	$key = isset( $input['public_key'] ) ? trim( sanitize_text_field( (string) $input['public_key'] ) ) : '';
	if ( '' === $key || halochime_is_public_key( $key ) ) {
		$clean['public_key'] = $key;
	} else {
		add_settings_error(
			HALOCHIME_OPTION,
			'halochime_public_key',
			__( 'That public key does not look right. Copy it from the Install page of your Halochime dashboard (it starts with pk_).', 'halochime' )
		);
	}

	$url = isset( $input['script_url'] ) ? trim( (string) $input['script_url'] ) : '';
	if ( '' === $url ) {
		$clean['script_url'] = HALOCHIME_DEFAULT_SCRIPT_URL;
	} else {
		$url = esc_url_raw( $url, array( 'https' ) );
		if ( '' !== $url && 'https' === wp_parse_url( $url, PHP_URL_SCHEME ) && '/widget.js' === substr( (string) wp_parse_url( $url, PHP_URL_PATH ), -10 ) ) {
			$clean['script_url'] = $url;
		} else {
			add_settings_error(
				HALOCHIME_OPTION,
				'halochime_script_url',
				__( 'The widget script address must be an https address ending in /widget.js. The previous address was kept.', 'halochime' )
			);
		}
	}

	return $clean;
}

/**
 * Registers the setting and its fields.
 */
function halochime_register_settings() {
	register_setting(
		'halochime',
		HALOCHIME_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'halochime_sanitize_settings',
			'default'           => array(),
			'show_in_rest'      => false,
		)
	);

	add_settings_section(
		'halochime_main',
		__( 'Your agent', 'halochime' ),
		'halochime_section_intro',
		'halochime'
	);

	add_settings_field( 'halochime_public_key', __( 'Public key', 'halochime' ), 'halochime_field_public_key', 'halochime', 'halochime_main', array( 'label_for' => 'halochime_public_key' ) );
	add_settings_field( 'halochime_enabled', __( 'Show the widget', 'halochime' ), 'halochime_field_enabled', 'halochime', 'halochime_main' );
	add_settings_field( 'halochime_hide_for_admins', __( 'Administrators', 'halochime' ), 'halochime_field_hide_for_admins', 'halochime', 'halochime_main' );
	add_settings_field( 'halochime_script_url', __( 'Widget script address', 'halochime' ), 'halochime_field_script_url', 'halochime', 'halochime_main', array( 'label_for' => 'halochime_script_url' ) );
}
add_action( 'admin_init', 'halochime_register_settings' );

/**
 * Text above the fields.
 */
function halochime_section_intro() {
	echo '<p>' . esc_html__( 'Copy the public key from the Install page of your Halochime dashboard. Also add this site\'s domain under Allowed domains on your agent, and publish the agent.', 'halochime' ) . '</p>';
}

/**
 * Public key field.
 */
function halochime_field_public_key() {
	$s = halochime_settings();
	printf(
		'<input type="text" id="halochime_public_key" name="%1$s[public_key]" value="%2$s" class="regular-text code" placeholder="pk_..." autocomplete="off" spellcheck="false" />',
		esc_attr( HALOCHIME_OPTION ),
		esc_attr( $s['public_key'] )
	);
	echo '<p class="description">' . esc_html__( 'It is safe to show in your page source. It is not a password.', 'halochime' ) . '</p>';
}

/**
 * On/off field.
 */
function halochime_field_enabled() {
	$s = halochime_settings();
	printf(
		'<label><input type="checkbox" name="%1$s[enabled]" value="1" %2$s /> %3$s</label>',
		esc_attr( HALOCHIME_OPTION ),
		checked( $s['enabled'], true, false ),
		esc_html__( 'Add the widget to every page of this site', 'halochime' )
	);
}

/**
 * Hide for administrators field.
 */
function halochime_field_hide_for_admins() {
	$s = halochime_settings();
	printf(
		'<label><input type="checkbox" name="%1$s[hide_for_admins]" value="1" %2$s /> %3$s</label>',
		esc_attr( HALOCHIME_OPTION ),
		checked( $s['hide_for_admins'], true, false ),
		esc_html__( 'Don\'t show it to logged-in administrators', 'halochime' )
	);
}

/**
 * Script address field (only for self-hosted Halochime).
 */
function halochime_field_script_url() {
	$s = halochime_settings();
	printf(
		'<input type="url" id="halochime_script_url" name="%1$s[script_url]" value="%2$s" class="regular-text code" placeholder="%3$s" />',
		esc_attr( HALOCHIME_OPTION ),
		esc_attr( $s['script_url'] ),
		esc_attr( HALOCHIME_DEFAULT_SCRIPT_URL )
	);
	echo '<p class="description">' . esc_html__( 'Leave as it is unless you run your own Halochime server.', 'halochime' ) . '</p>';
}

/**
 * Adds Settings > Halochime.
 */
function halochime_add_settings_page() {
	add_options_page(
		__( 'Halochime', 'halochime' ),
		__( 'Halochime', 'halochime' ),
		'manage_options',
		'halochime',
		'halochime_render_settings_page'
	);
}
add_action( 'admin_menu', 'halochime_add_settings_page' );

/**
 * The settings page. options.php checks the nonce and the capability when the form is saved.
 */
function halochime_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$s = halochime_settings();
	?>
	<div class="wrap">
		<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
		<?php if ( '' === $s['public_key'] ) : ?>
			<div class="notice notice-warning inline"><p><?php esc_html_e( 'Add your public key to show the widget on your site.', 'halochime' ); ?></p></div>
		<?php endif; ?>
		<form action="options.php" method="post">
			<?php
			settings_fields( 'halochime' );
			do_settings_sections( 'halochime' );
			submit_button( __( 'Save settings', 'halochime' ) );
			?>
		</form>
	</div>
	<?php
}

/**
 * A Settings link next to Deactivate on the Plugins screen.
 *
 * @param array $links Existing links.
 * @return array
 */
function halochime_action_links( $links ) {
	$url = admin_url( 'options-general.php?page=halochime' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'halochime' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'halochime_action_links' );

/**
 * Prints the widget script tag in the footer of public pages.
 */
function halochime_print_widget() {
	if ( is_admin() || wp_doing_ajax() || ( function_exists( 'wp_is_json_request' ) && wp_is_json_request() ) ) {
		return;
	}
	$s = halochime_settings();
	if ( ! $s['enabled'] || ! halochime_is_public_key( $s['public_key'] ) ) {
		return;
	}
	if ( $s['hide_for_admins'] && current_user_can( 'manage_options' ) ) {
		return;
	}
	/**
	 * Filters whether the Halochime widget is added to the current page.
	 *
	 * @param bool $show True to add it.
	 */
	if ( ! apply_filters( 'halochime_show_widget', true ) ) {
		return;
	}
	// wp_print_script_tag escapes every attribute.
	wp_print_script_tag(
		array(
			'src'      => esc_url( $s['script_url'] ),
			'data-key' => $s['public_key'],
			'async'    => true,
		)
	);
}
add_action( 'wp_footer', 'halochime_print_widget', 20 );
