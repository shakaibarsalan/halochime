/** Run: npx tsx --conditions=react-server src/lib/email/staff-reply.check.ts [folder to save the HTML in] */
import { writeFileSync } from "node:fs";
import { staffReplyEmail } from "./templates";

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
  if (!ok) failed++;
};

const a = staffReplyEmail({
  workspace: "Maple Market",
  staffName: "Sam",
  visitorName: "Ayesha Khan",
  messages: ['Your order <b>A-1001</b> ships today.\nTracking: "TRK-77" & more <script>alert(1)</script>'],
  pageUrl: "https://example.com/orders",
  replyable: true,
});
check("subject names the person and the business", a.subject === "Sam replied to your chat with Maple Market");
check("greets by first name", a.html.includes("Hi Ayesha,"));
check("no raw script tag in HTML", !a.html.includes("<script>") && a.html.includes("&lt;script&gt;"));
check("no raw <b> from the message", !a.html.includes("<b>A-1001</b>"));
check("line break kept", a.html.includes("<br"));
check("reply line when replyable", a.html.includes("Reply to this email to answer"));
check("button back to the page", a.html.includes("https://example.com/orders"));
check("plain text has the message", a.text.includes("Tracking: \"TRK-77\""));

const b = staffReplyEmail({ workspace: "Maple Market", staffName: " ", visitorName: null, messages: ["Hello"], pageUrl: null, replyable: false });
check("falls back to the business name", b.subject === "Maple Market replied to your chat with Maple Market");
check("no greeting without a name", !b.html.includes("Hi ,") && !b.text.includes("Hi ,"));
check("not replyable: website line", b.html.includes("carry on the chat on the website"));
check("no button without a page", !b.text.includes("Back to the website"));

if (process.argv[2]) writeFileSync(`${process.argv[2]}/staff-reply.html`, a.html);
console.log(failed ? `${failed} failed` : "all staff reply email checks passed");
process.exit(failed ? 1 : 0);
