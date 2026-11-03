// Email HTML building blocks. Table layout with inline styles, because Gmail, Outlook and Apple Mail
// each drop different parts of modern CSS. Every dynamic string goes through esc().
// Brand: violet #5b45e3 to cyan #22d3ee on a light background. No tracking pixels, no remote fonts.

export const BRAND = "#5b45e3";
const CYAN = "#22d3ee";
const INK = "#14121f";
const BODY = "#47445a";
const MUTED = "#7b788c";
const LINE = "#e8e6f0";
const PAGE_BG = "#f4f3f9";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** Escapes text for HTML content and attribute values. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escaped text with line breaks kept (white-space: pre-wrap is not supported everywhere). */
export const escLines = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

export function heading(text: string): string {
  return `<h1 class="tf-h1" style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:${INK};">${esc(text)}</h1>`;
}

/** A paragraph. `html` must already be escaped (use esc() for dynamic parts). */
export function p(html: string, opts: { muted?: boolean; small?: boolean; last?: boolean } = {}): string {
  const size = opts.small ? "13px" : "15px";
  const lh = opts.small ? "20px" : "24px";
  return `<p style="margin:0 0 ${opts.last ? 0 : 16}px;font-family:${FONT};font-size:${size};line-height:${lh};color:${opts.muted ? MUTED : BODY};">${html}</p>`;
}

export const strong = (text: string) => `<strong style="color:${INK};font-weight:600;">${esc(text)}</strong>`;

export function link(href: string, label: string): string {
  return `<a href="${esc(href)}" target="_blank" style="color:${BRAND};text-decoration:underline;">${esc(label)}</a>`;
}

/** Bulletproof button: padded table cell with a background colour, so Outlook draws it too. */
export function button(href: string, label: string): string {
  const h = esc(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;border-collapse:separate;">
<tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px;background-color:${BRAND};">
<a href="${h}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;mso-padding-alt:0;"><!--[if mso]><i style="mso-font-width:150%;mso-text-raise:22pt" hidden>&#8195;</i><![endif]--><span style="mso-text-raise:11pt;">${esc(label)}</span><!--[if mso]><i style="mso-font-width:150%;" hidden>&#8195;&#8203;</i><![endif]--></a>
</td></tr></table>`;
}

/** The one-time code, big and easy to copy. */
export function codeBox(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
<tr><td align="center" style="padding:22px 16px;background-color:#f5f3ff;border:1px solid #e3dcff;border-radius:12px;">
<span style="display:inline-block;padding-left:10px;font-family:${MONO};font-size:34px;line-height:40px;font-weight:700;letter-spacing:10px;color:${INK};">${esc(code)}</span>
</td></tr></table>`;
}

/** A command or id to copy, in a small monospace box that wraps instead of widening the email. */
export function codeLine(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">
<tr><td style="padding:12px 14px;background-color:#f8f7fc;border:1px solid ${LINE};border-radius:10px;font-family:${MONO};font-size:12px;line-height:19px;color:${INK};word-break:break-all;">${esc(text)}</td></tr></table>`;
}

/** Monospace inline text, e.g. an id inside details(). */
export const mono = (text: string) => `<span style="font-family:${MONO};font-size:13px;word-break:break-all;">${esc(text)}</span>`;

/** Label / value rows, e.g. the visitor's contact details. Values must already be escaped. */
export function details(rows: { label: string; html: string }[]): string {
  const tr = rows
    .map(
      (r, i) => `<tr>
<td valign="top" style="padding:10px 12px 10px 0;width:84px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};${i ? `border-top:1px solid ${LINE};` : ""}">${esc(r.label)}</td>
<td valign="top" style="padding:10px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${INK};word-break:break-word;${i ? `border-top:1px solid ${LINE};` : ""}">${r.html}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">${tr}</table>`;
}

/** A quoted block, e.g. the visitor's message. `html` must already be escaped. */
export function quote(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">
<tr><td style="padding:14px 16px;background-color:#f8f7fc;border-left:3px solid ${BRAND};border-radius:0 10px 10px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${INK};word-break:break-word;">${html}</td></tr></table>`;
}

/** Numbered steps with a title, a line of text and a link each. */
export function steps(items: { title: string; text: string; href: string; cta: string }[]): string {
  const rows = items
    .map(
      (s, i) => `<tr>
<td valign="top" width="40" style="padding:14px 0;${i ? `border-top:1px solid ${LINE};` : ""}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="28" height="28" style="width:28px;height:28px;border-radius:14px;background-color:#efecff;font-family:${FONT};font-size:13px;line-height:28px;font-weight:700;color:${BRAND};">${i + 1}</td></tr></table>
</td>
<td valign="top" style="padding:14px 0;${i ? `border-top:1px solid ${LINE};` : ""}">
<p style="margin:0 0 2px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:${INK};">${esc(s.title)}</p>
<p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:21px;color:${BODY};">${esc(s.text)}</p>
<a href="${esc(s.href)}" target="_blank" style="font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${BRAND};text-decoration:none;">${esc(s.cta)} &rarr;</a>
</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">${rows}</table>`;
}

/** Thin rule between the main message and a secondary note. */
export const divider = () =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 20px;"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;background-color:${LINE};">&nbsp;</td></tr></table>`;

/**
 * The whole email. `preheader` is the grey preview line inboxes show after the subject; the
 * filler after it stops clients from pulling body text into the preview.
 */
export function layout(opts: { appUrl: string; subject: string; preheader: string; body: string; footer: string }): string {
  const filler = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(opts.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  @media (max-width: 600px) {
    .tf-outer { padding: 16px 8px !important; }
    .tf-pad { padding: 28px 22px !important; }
    .tf-h1 { font-size: 22px !important; line-height: 30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${PAGE_BG};">${esc(opts.preheader)}${filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}" style="background-color:${PAGE_BG};">
<tr><td align="center" class="tf-outer" style="padding:32px 16px 40px;">
<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;">
<tr><td style="background-color:#ffffff;border:1px solid ${LINE};border-radius:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="4" bgcolor="${BRAND}" style="height:4px;line-height:4px;font-size:0;background-color:${BRAND};background-image:linear-gradient(90deg,${BRAND},${CYAN});border-radius:16px 16px 0 0;">&nbsp;</td></tr>
<tr><td class="tf-pad" style="padding:32px 40px 36px;">
<a href="${esc(opts.appUrl)}" target="_blank" style="display:inline-block;text-decoration:none;"><img src="${esc(opts.appUrl)}/email/logo.png" width="128" height="32" alt="Halochime" style="display:block;width:128px;height:32px;border:0;font-family:${FONT};font-size:18px;font-weight:700;color:${INK};"></a>
<div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>
${opts.body}
</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 12px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">
${opts.footer}<br>
<a href="${esc(opts.appUrl)}" target="_blank" style="color:${MUTED};text-decoration:underline;">Halochime</a>, voice and chat support for your website.
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
