# Halochime for Shopify (theme app extension)

An app embed block that adds the Halochime widget script to every storefront page. The merchant turns it
on in the theme editor and pastes their agent's public key. It reads no store data and needs no access
scopes.

```
plugins/shopify/
  shopify.app.toml                          app config (client_id is filled in by the CLI)
  package.json                              shortcuts for the Shopify CLI
  extensions/halochime-widget/
    shopify.extension.toml                  type = "theme"
    blocks/halochime.liquid                 the app embed (target "body", settings: public key, script address)
    locales/en.default.json
```

The script tag is only printed when the key starts with `pk_` and the script address is an `https://`
address ending in `/widget.js`. Both values are escaped.

## What you need

- A Shopify Partner account (free): https://www.shopify.com/partners
- A development store to test on (create one from the Partner Dashboard or the Dev Dashboard, under Stores).
- Node.js 20 or newer, and the Shopify CLI: `npm install -g @shopify/cli@latest`
- A Halochime agent with a public key, published, with the test store's domain (for example
  `your-test-store.myshopify.com`) in its Allowed domains.

## Create the app and connect this folder

1. Open a terminal in this folder: `cd plugins/shopify`
2. Run `shopify app config link`.
   - Log in with your Partner account when the browser opens.
   - Pick your Partner organization.
   - When asked to create a new app, answer yes and name it **Halochime**.
   - The CLI writes the new app's `client_id` into `shopify.app.toml` (it may rewrite the file; that is fine).
     Commit that change: the client id is not a secret.
3. Check it worked: `shopify app info` shows the app name and the `halochime-widget` extension.

If the CLI asks for an app URL, use `https://halochime.vercel.app`. This app has no pages of its own.

## Try it on the development store

1. Run `shopify app dev` and pick your development store. Open the preview link it prints and install the app
   on the store when asked.
2. In the store admin go to **Online Store** > **Themes** > **Customize**.
3. In the left bar open **App embeds** (the puzzle piece icon), turn on **Halochime widget**, paste the public
   key and select **Save**.
4. Open the store: the Halochime button shows in the corner. Stop `shopify app dev` with Ctrl+C when done
   (the preview stops with it).

## Release it

1. Run `shopify app deploy`. It uploads the extension and creates a new app version. Answer yes to release it.
2. In the Partner Dashboard open **Apps** > **Halochime** > **Distribution**.
   - **Custom distribution**: enter the merchant's store domain to get an install link for that store (or a
     Shopify Plus organization). Send the link to the merchant. This is the only option for an app like this
     one that has no hosted app pages: Shopify allows extension-only apps to be installed through custom
     distribution only.
   - **Public distribution (Shopify App Store)** needs an app with its own hosted pages, the mandatory privacy
     webhooks (customers/data_request, customers/redact, shop/redact) and Shopify's review. That would be a
     separate project; until then merchants can also paste the snippet into `theme.liquid` (the manual steps
     on the Install page).
3. After the merchant installs it, they turn on the embed as in "Try it" step 2 and 3.

Each later change: edit the files here, run `shopify app deploy` again and release the new version. Stores
that installed the app get the new version automatically.

## What can't be tested here

The extension was written and checked by hand against Shopify's theme app extension format; it has not been
run with the Shopify CLI or on a real store. The first `shopify app dev` run is the real test. If the CLI
reports a schema problem, it names the file and setting.
