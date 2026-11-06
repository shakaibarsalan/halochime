import "server-only";
import { Fragment, type ReactNode } from "react";

// Install steps per platform, shared by the dashboard Install page and the public docs.
// Steps use <b> for labels the user clicks and <code> for files and fields; each surface styles them.
// Menu names were checked against each platform's own help pages in October 2026.

export type CodeSample = { label: string; lang: "html" | "tsx" | "jsx" | "liquid"; code: string };

export type PlatformGuide = {
  id: string;
  label: string;
  /** One line: where the snippet goes. */
  summary: string;
  steps: ReactNode[];
  code: CodeSample[];
  notes?: ReactNode[];
};

/** The WordPress plugin, built by plugins/wordpress/build-zip.mjs into apps/web/public/downloads. */
export const WORDPRESS_ZIP = "/downloads/halochime-wordpress.zip";
const DOWNLOAD_LINK =
  "font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

/** The script tag for one agent. */
export const embedSnippet = (appUrl: string, publicKey: string) =>
  `<script src="${appUrl}/widget.js" data-key="${publicKey}" async></script>`;

export function platformGuides(appUrl: string, publicKey: string): PlatformGuide[] {
  const src = `${appUrl}/widget.js`;
  const snippet = embedSnippet(appUrl, publicKey);

  const guides: PlatformGuide[] = [
    {
      id: "html",
      label: "HTML",
      summary: "Paste the tag before </body> on every page.",
      steps: [
        <>Open the HTML of your pages. If your site has a shared footer or layout file, use that so every page gets it.</>,
        <>
          Paste the snippet just before the closing <code>&lt;/body&gt;</code> tag.
        </>,
        <>Upload or publish the change. The chat button appears in the corner of the page.</>,
      ],
      code: [
        {
          label: "index.html",
          lang: "html",
          code: `<!doctype html>
<html lang="en">
  <head>
    <!-- ... -->
  </head>
  <body>
    <!-- your page -->

    ${snippet}
  </body>
</html>`,
        },
      ],
    },
    {
      id: "nextjs",
      label: "Next.js",
      summary: "Add it once with next/script in the root layout.",
      steps: [
        <>
          App Router: open <code>app/layout.tsx</code>. Pages Router: open <code>pages/_app.tsx</code>.
        </>,
        <>
          Import <code>Script</code> from <code>next/script</code> and render it once with{" "}
          <code>strategy=&quot;afterInteractive&quot;</code>.
        </>,
        <>Deploy. The widget stays on screen while visitors move between pages.</>,
      ],
      code: [
        {
          label: "app/layout.tsx",
          lang: "tsx",
          code: `import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${src}"
          data-key="${publicKey}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`,
        },
        {
          label: "pages/_app.tsx",
          lang: "tsx",
          code: `import type { AppProps } from "next/app";
import Script from "next/script";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Script
        src="${src}"
        data-key="${publicKey}"
        strategy="afterInteractive"
      />
    </>
  );
}`,
        },
      ],
    },
    {
      id: "react",
      label: "React",
      summary: "Paste it into index.html (Vite or Create React App).",
      steps: [
        <>
          Vite: open <code>index.html</code> in the project root. Create React App: open <code>public/index.html</code>.
        </>,
        <>
          Paste the snippet just before <code>&lt;/body&gt;</code>, then build and deploy as usual.
        </>,
        <>
          Can&apos;t edit the HTML file? Render the small component below once, near the top of your app. It adds the
          script a single time.
        </>,
      ],
      code: [
        {
          label: "index.html",
          lang: "html",
          code: `  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
    ${snippet}
  </body>`,
        },
        {
          label: "HalochimeWidget.jsx",
          lang: "jsx",
          code: `import { useEffect } from "react";

export function HalochimeWidget() {
  useEffect(() => {
    if (document.querySelector('script[src="${src}"]')) return;
    const script = document.createElement("script");
    script.src = "${src}";
    script.async = true;
    script.dataset.key = "${publicKey}";
    document.body.appendChild(script);
  }, []);
  return null;
}`,
        },
      ],
    },
    {
      id: "wordpress",
      label: "WordPress",
      summary: "Install the Halochime plugin and paste your public key.",
      steps: [
        <>
          <a href={WORDPRESS_ZIP} download className={DOWNLOAD_LINK}>
            Download the Halochime plugin
          </a>{" "}
          (<code>halochime-wordpress.zip</code>). Keep the file zipped.
        </>,
        <>
          In your WordPress admin, go to <b>Plugins</b> &rsaquo; <b>Add New Plugin</b> &rsaquo; <b>Upload Plugin</b>, choose the
          file, select <b>Install Now</b>, then <b>Activate</b>.
        </>,
        <>
          Go to <b>Settings</b> &rsaquo; <b>Halochime</b>, paste your public key and select <b>Save settings</b>.
        </>,
      ],
      code: [
        { label: "Public key", lang: "html", code: publicKey },
        { label: "Snippet, if you don't use the plugin", lang: "html", code: snippet },
      ],
      notes: [
        <>
          The plugin can hide the widget from logged-in administrators, and removes its settings when you delete it.
        </>,
        <>
          Without the plugin: paste the snippet into the <b>Footer</b> box of a header and footer plugin such as{" "}
          <b>WPCode</b>, or before <code>&lt;/body&gt;</code> in your child theme&apos;s <code>footer.php</code>.
        </>,
        <>On WordPress.com, uploading plugins needs a plan that allows them.</>,
      ],
    },
    {
      id: "shopify",
      label: "Shopify",
      summary: "Paste it into your theme's theme.liquid, or turn on the Halochime app embed.",
      steps: [
        <>
          In your Shopify admin, go to <b>Online Store</b> &rsaquo; <b>Themes</b>.
        </>,
        <>
          Next to your current theme, select the <b>&hellip;</b> button, then <b>Edit code</b>.
        </>,
        <>
          In the <b>Layout</b> folder, open <code>theme.liquid</code>.
        </>,
        <>
          Paste the snippet just above <code>&lt;/body&gt;</code> and select <b>Save</b>.
        </>,
      ],
      code: [
        {
          label: "layout/theme.liquid",
          lang: "liquid",
          code: `    {% comment %} ...the rest of your theme... {% endcomment %}
    ${snippet}
  </body>
</html>`,
        },
      ],
      notes: [
        <>
          Installed the Halochime app from an install link? Skip the code: go to <b>Online Store</b> &rsaquo; <b>Themes</b> &rsaquo;{" "}
          <b>Customize</b> &rsaquo; <b>App embeds</b>, turn on <b>Halochime widget</b>, paste your public key (
          <code>{publicKey}</code>) and select <b>Save</b>. It keeps working when you switch themes. Halochime support can send you an install link.
        </>,
        <>Shopify checkout pages don&apos;t use your theme, so the widget doesn&apos;t show there.</>,
        <>If you switch themes later, add the snippet to the new theme too (not needed with the app embed).</>,
      ],
    },
    {
      id: "webflow",
      label: "Webflow",
      summary: "Site settings, Custom code, Footer code.",
      steps: [
        <>
          Open your site&apos;s <b>Site settings</b> and go to <b>Custom code</b>.
        </>,
        <>
          Paste the snippet into <b>Footer code</b> (it runs before <code>&lt;/body&gt;</code> on every page).
        </>,
        <>
          Select <b>Save changes</b>, then <b>Publish</b> the site.
        </>,
      ],
      code: [{ label: "Footer code", lang: "html", code: snippet }],
      notes: [<>Webflow only runs custom code on sites with a paid Site or Workspace plan.</>],
    },
    {
      id: "wix",
      label: "Wix",
      summary: "Settings, Custom Code, Body - end.",
      steps: [
        <>
          In your site&apos;s dashboard, open <b>Settings</b>. Under <b>Development &amp; integrations</b>, select{" "}
          <b>Custom Code</b>.
        </>,
        <>
          Select <b>+ Add Custom Code</b>, paste the snippet and name it, for example &quot;Halochime&quot;.
        </>,
        <>
          Under <b>Add Code to Pages</b>, choose <b>All pages</b> and <b>Load code once</b>.
        </>,
        <>
          Under <b>Place Code in</b>, choose <b>Body - end</b>, then select <b>Apply</b>.
        </>,
      ],
      code: [{ label: "Custom Code", lang: "html", code: snippet }],
      notes: [<>Wix runs custom code only on published sites with a connected domain.</>],
    },
    {
      id: "squarespace",
      label: "Squarespace",
      summary: "Code Injection, Footer.",
      steps: [
        <>
          Open the <b>Code Injection</b> panel. In the current editor it is under <b>Website</b> &rsaquo; <b>Pages</b>{" "}
          &rsaquo; <b>Custom code</b>; on older sites it is under <b>Settings</b> &rsaquo; <b>Advanced</b>.
        </>,
        <>
          Paste the snippet into the <b>Footer</b> field.
        </>,
        <>
          Select <b>Save</b>. It runs on every page of your site.
        </>,
      ],
      code: [{ label: "Footer", lang: "html", code: snippet }],
      notes: [<>Squarespace offers Code Injection on its Core, Plus and Advanced plans (and some older plans).</>],
    },
    {
      id: "gtm",
      label: "Google Tag Manager",
      summary: "A Custom HTML tag on All Pages.",
      steps: [
        <>
          In your container, go to <b>Tags</b> &rsaquo; <b>New</b>.
        </>,
        <>
          Select <b>Tag Configuration</b> &rsaquo; <b>Custom HTML</b> and paste the snippet.
        </>,
        <>
          Select <b>Triggering</b> &rsaquo; <b>All Pages</b>, name the tag and select <b>Save</b>.
        </>,
        <>
          Select <b>Submit</b>, then <b>Publish</b>.
        </>,
      ],
      code: [{ label: "Custom HTML", lang: "html", code: snippet }],
      notes: [
        <>
          Tags added by Tag Manager run in the browser, so &quot;Check my site&quot; can&apos;t see them. Open your site
          and look for the chat button instead.
        </>,
      ],
    },
  ];
  // Element arrays cross the server/client boundary, so give every step and note a key.
  const keyed = (list: ReactNode[] | undefined) => list?.map((n, i) => <Fragment key={i}>{n}</Fragment>);
  return guides.map((g) => ({ ...g, steps: keyed(g.steps)!, notes: keyed(g.notes) }));
}

/** CSP sources for the widget on this deployment (LiveKit Cloud uses wildcard project hosts). */
export function cspSources(appUrl: string): { scriptSrc: string; connectSrc: string } {
  const origin = new URL(appUrl).origin;
  let media = "wss://*.livekit.cloud https://*.livekit.cloud";
  try {
    const raw = process.env.LIVEKIT_URL;
    if (raw) {
      const host = new URL(raw.replace(/^ws/, "http")).host;
      if (!/\.livekit\.cloud$/i.test(host)) media = `wss://${host} https://${host}`;
    }
  } catch {
    // keep the LiveKit Cloud default
  }
  return { scriptSrc: origin, connectSrc: `${origin} ${media}` };
}
