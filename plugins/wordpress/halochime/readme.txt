=== Halochime ===
Contributors: halochime
Tags: chat, support, voice, live chat, ai
Requires at least: 5.7
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Add your Halochime voice and chat support agent to every page of your WordPress site.

== Description ==

Halochime is an AI support agent your visitors can talk to or chat with, in their own language. This plugin adds the Halochime widget to your site, so you don't have to edit your theme.

* Paste your public key once, under Settings > Halochime.
* The widget loads in the background and never slows your pages.
* Turn it off at any time, or hide it from logged-in administrators.

You need a Halochime account and an agent. The agent's settings (voice, greeting, knowledge, look) are managed in your Halochime dashboard.

= External service =

This plugin loads the Halochime widget script from https://halochime.vercel.app/widget.js (or the address you set) on your public pages. When a visitor opens the widget, their messages and, for voice calls, their microphone audio are sent to Halochime to answer them. See the Halochime Terms of Service (https://halochime.vercel.app/terms) and Privacy Policy (https://halochime.vercel.app/privacy).

== Installation ==

1. In your WordPress admin, go to Plugins > Add New Plugin > Upload Plugin, choose the Halochime zip file (halochime-wordpress.zip) and select Install Now, then Activate.
2. Go to Settings > Halochime.
3. Paste the public key from the Install page of your Halochime dashboard and select Save settings.
4. In your Halochime dashboard, add this site's domain under Allowed domains on your agent, and publish the agent.

== Frequently Asked Questions ==

= Where do I find my public key? =

In your Halochime dashboard, open Install. The key starts with pk_. It is safe to show in your page source.

= The widget doesn't show. =

Check that the agent is published, that your site's domain is in the agent's Allowed domains, and that "Show the widget" is ticked under Settings > Halochime. Caching plugins may need their cache cleared.

= Can I hide it on some pages? =

Yes, with the halochime_show_widget filter. For example, to hide it on the cart page:

`add_filter( 'halochime_show_widget', function ( $show ) { return function_exists( 'is_cart' ) && is_cart() ? false : $show; } );`

= Does it work with WordPress.com? =

Yes, on plans that allow uploading plugins.

== Changelog ==

= 1.0.0 =
* First release: settings page, footer widget tag, hide for administrators, clean uninstall.
