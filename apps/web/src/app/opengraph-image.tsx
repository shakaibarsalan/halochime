import { ImageResponse } from "next/og";
import { OG_ALT } from "@/lib/site";

// The social card for links to Halochime (1200 x 630). Satori draws it: flexbox and inline styles
// only, no Tailwind classes. The mark is the same drawing as LogoMark in components/logo.tsx.

export const alt = OG_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PITCH = "Voice and chat AI support for any website.";
const NOTE = "Visitors talk or type. It answers from your own knowledge.";

/** Inter at one weight, cut down to the characters used. null when Google Fonts can't be reached. */
async function inter(weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl, { signal: AbortSignal.timeout(5000) })).text();
    const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function Mark({ px }: { px: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: px,
        height: px,
        borderRadius: px * 0.29,
        backgroundImage:
          "radial-gradient(circle at 30% 18%, rgba(255,255,255,0.34), rgba(255,255,255,0) 55%), linear-gradient(155deg, #9d8cff 0%, #5b45e3 52%, #22d3ee 100%)",
        boxShadow: "0 18px 50px -12px rgba(91,69,227,0.75)",
      }}
    >
      <svg width={px} height={px} viewBox="1 1 30 30">
        <path
          d="M11 7.5h10a5.5 5.5 0 0 1 5.5 5.5v4a5.5 5.5 0 0 1-5.5 5.5h-6.2l-4.1 3.3c-.5.4-1.2 0-1.2-.6v-2.9A5.5 5.5 0 0 1 5.5 17v-4A5.5 5.5 0 0 1 11 7.5Z"
          fill="#fff"
        />
        <rect x="11.2" y="12.6" width="2.2" height="4.8" rx="1.1" fill="#5b45e3" />
        <rect x="14.9" y="10.6" width="2.2" height="8.8" rx="1.1" fill="#5b45e3" />
        <rect x="18.6" y="12" width="2.2" height="6" rx="1.1" fill="#5b45e3" />
      </svg>
    </div>
  );
}

/** The voice orb from the landing page, with a still waveform. */
function Orb() {
  const bars = [0.35, 0.6, 0.9, 0.55, 1, 0.75, 0.5, 0.85, 0.4];
  return (
    <div style={{ position: "absolute", right: 96, top: 150, display: "flex", width: 330, height: 330, alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", display: "flex", width: 330, height: 330, borderRadius: 999, border: "1px solid rgba(255,255,255,0.07)" }} />
      <div
        style={{
          display: "flex",
          width: 250,
          height: 250,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
          backgroundImage:
            "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 26%), radial-gradient(circle at 74% 80%, rgba(246,165,124,0.7) 0%, rgba(246,165,124,0) 24%), radial-gradient(circle at 78% 30%, rgba(34,211,238,0.95) 0%, rgba(34,211,238,0) 50%), linear-gradient(155deg, #4f3fd6 0%, #7c6cff 50%, #8b7dff 100%)",
          boxShadow: "0 0 140px -10px rgba(124,108,255,0.85)",
        }}
      >
        {bars.map((h, i) => (
          <div key={i} style={{ display: "flex", width: 8, height: 80 * h, borderRadius: 999, backgroundColor: "#fff" }} />
        ))}
      </div>
    </div>
  );
}

export default async function OpengraphImage() {
  const [bold, medium] = await Promise.all([inter(700, "halo"), inter(500, `chime${PITCH}${NOTE}`)]);
  // Without Inter (offline build), the card falls back to next/og's built-in font.
  const fonts: { name: string; data: ArrayBuffer; weight: 500 | 700; style: "normal" }[] = [];
  if (bold) fonts.push({ name: "Inter", data: bold, weight: 700, style: "normal" });
  if (medium) fonts.push({ name: "Inter", data: medium, weight: 500, style: "normal" });

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          backgroundColor: "#07070c",
          backgroundImage:
            "radial-gradient(60% 70% at 30% 0%, rgba(91,69,227,0.45) 0%, rgba(91,69,227,0) 70%), radial-gradient(40% 50% at 85% 35%, rgba(34,211,238,0.16) 0%, rgba(34,211,238,0) 70%), radial-gradient(50% 60% at 70% 110%, rgba(124,108,255,0.22) 0%, rgba(124,108,255,0) 70%)",
          fontFamily: "Inter",
          color: "#fff",
        }}
      >
        <Orb />
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <Mark px={112} />
          <div style={{ display: "flex", fontSize: 104, letterSpacing: "-0.045em", lineHeight: 1 }}>
            <span style={{ fontWeight: 700 }}>halo</span>
            <span style={{ fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>chime</span>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 52, maxWidth: 640, fontSize: 46, fontWeight: 500, lineHeight: 1.18, letterSpacing: "-0.025em" }}>
          {PITCH}
        </div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 26, fontWeight: 500, color: "rgba(255,255,255,0.55)" }}>{NOTE}</div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
