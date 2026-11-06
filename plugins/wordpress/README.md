# Halochime for WordPress

A standard WordPress plugin (`halochime/`): **Settings > Halochime** for the public key and options, and the
widget script tag in the footer of public pages. Settings are removed when the plugin is deleted
(`uninstall.php`).

Build the zip the dashboard offers for download (`apps/web/public/downloads/halochime-wordpress.zip`):

```
npm run plugins:zip                            # or: node plugins/wordpress/build-zip.mjs
node plugins/wordpress/build-zip.mjs --check   # fails if the committed zip is out of date
```

Run it after every change to the plugin and commit the zip with the change. The zip is the same byte for
byte when nothing changed. Bump `Version` in `halochime.php` and `Stable tag` in `readme.txt` together.

Options: public key (`pk_...`), show the widget on or off, hide it from logged-in administrators, and the
widget script address (only for a self-hosted Halochime). Developers can hide it on some pages with the
`halochime_show_widget` filter.

To publish it on wordpress.org, submit the zip at https://wordpress.org/plugins/developers/add/ (review takes
a few weeks; the `Contributors` name in `readme.txt` must be the wordpress.org account that submits it).
