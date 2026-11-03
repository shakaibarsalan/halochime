import type { Metadata, Viewport } from "next";
import { A, B, Callout, H2, LegalPage, List, P, Section, type TocItem } from "@/components/site/prose";
import { TRIAL_SECONDS } from "@/db/schema";
import { LOW_BALANCE_SECONDS } from "@/lib/conversations";
import { LEGAL_UPDATED } from "@/lib/site";

// Billing facts: lib/conversations.ts (per started minute, balance can run past zero on a live call,
// low-balance email), app/onboarding/actions.ts (free minutes on a user's first own workspace only).

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "How Halochime voice minutes are billed and bought, and when unused minutes can be refunded.",
  alternates: { canonical: "/refund-policy" },
};

export const viewport: Viewport = { themeColor: "#07070c" };

const TRIAL_MIN = TRIAL_SECONDS / 60;
const LOW_MIN = LOW_BALANCE_SECONDS / 60;
const BILLING_HREF = "/contact?topic=billing";

const TOC: TocItem[] = [
  { id: "in-short", label: "In short" },
  { id: "billing", label: "How voice is billed" },
  { id: "free-minutes", label: "Free minutes" },
  { id: "buying", label: "Buying minutes" },
  { id: "refunds", label: "Refunds" },
  { id: "asking", label: "How to ask for a refund" },
  { id: "text-chat", label: "Text chat" },
  { id: "closing", label: "Closing a workspace" },
];

export default function RefundPolicyPage() {
  return (
    <LegalPage
      label="Legal"
      eyebrow="Refund Policy"
      title="Billing and refunds,"
      accent="simply."
      updated={LEGAL_UPDATED}
      toc={TOC}
      intro={<p>How voice minutes are counted and bought, and when you can get your money back.</p>}
    >
      <Section first>
        <H2 id="in-short" n={1}>
          In short
        </H2>
        <List>
          <li>Voice uses prepaid minutes. Text chat is free during the beta.</li>
          <li>Minutes never expire.</li>
          <li>The unused minutes of a purchase can be refunded in full within 14 days of that purchase.</li>
          <li>Minutes you have used are not refundable, and free minutes have no cash value.</li>
        </List>
      </Section>

      <Section>
        <H2 id="billing" n={2}>
          How voice is billed
        </H2>
        <List>
          <li>
            Each workspace has its own wallet of voice minutes. A voice call takes minutes from the wallet of the workspace
            that owns the agent, rounded up per started minute: a call of 1 minute and 5 seconds uses 2 minutes.
          </li>
          <li>
            When the wallet is empty, new voice calls can&apos;t start until minutes are added. Text chat keeps working. A call
            that is already running when the balance reaches zero is allowed to finish, and the minutes it uses past zero are
            taken from the next minutes you add.
          </li>
          <li>
            The workspace&apos;s owners and admins get an email when fewer than {LOW_MIN} minutes are left, and again when the
            balance reaches zero.
          </li>
          <li>The Billing page in your dashboard shows your balance and every call, purchase and free credit.</li>
        </List>
      </Section>

      <Section>
        <H2 id="free-minutes" n={3}>
          Free minutes
        </H2>
        <P>
          The first workspace you create gets {TRIAL_MIN} free voice minutes, once. Workspaces you create after that start at
          zero.
        </P>
        <P>
          Free minutes have no cash value. They can&apos;t be refunded, paid out or moved to another workspace.
        </P>
      </Section>

      <Section>
        <H2 id="buying" n={4}>
          Buying minutes
        </H2>
        <P>For now, minutes are bought on request:</P>
        <List ordered>
          <li>
            Write to us through the <A href={BILLING_HREF}>contact page</A> and choose <B>Billing</B>. Tell us the workspace
            and how many minutes you want.
          </li>
          <li>We reply with the price and a payment link.</li>
          <li>Once your payment arrives, we add the minutes to that workspace&apos;s wallet and they show on your Billing page.</li>
        </List>
        <P>Minutes never expire, so there is no date to use them by.</P>
      </Section>

      <Section>
        <H2 id="refunds" n={5}>
          Refunds
        </H2>
        <List>
          <li>
            <B>Within 14 days of a purchase</B>, you can get a full refund for the minutes of that purchase you haven&apos;t
            used. We then remove those minutes from your wallet.
          </li>
          <li>
            <B>After 14 days</B>, that purchase can no longer be refunded, but its minutes stay in your wallet and never
            expire.
          </li>
          <li>Minutes you have used are not refundable.</li>
          <li>Free minutes have no cash value and are not refunded.</li>
        </List>
        <P>
          Minutes are used in the order they were added: free minutes first, then each purchase from oldest to newest. That
          decides which purchase a used minute came from.
        </P>
        <Callout>
          An example: your free minutes are used up and you buy 100 minutes on 1 March. By 10 March you have used 40 of them.
          Until 15 March you can ask for the other 60 to be refunded.
        </Callout>
        <P>If the law where you live gives you more rights than this policy, those rights apply.</P>
      </Section>

      <Section>
        <H2 id="asking" n={6}>
          How to ask for a refund
        </H2>
        <P>
          Use the <A href={BILLING_HREF}>contact page</A>, choose <B>Billing</B>, and include the workspace name, the date of
          the purchase and the email address you paid with. We send the refund back through the payment method you used; how
          long it takes to reach you depends on your bank or payment provider.
        </P>
        <P>Please talk to us before opening a dispute or chargeback with your bank. It is usually quicker for you.</P>
      </Section>

      <Section>
        <H2 id="text-chat" n={7}>
          Text chat
        </H2>
        <P>
          Text chats are free during the beta. If that changes, we will tell you before any charge applies, and minutes you
          already bought are not affected.
        </P>
      </Section>

      <Section>
        <H2 id="closing" n={8}>
          Closing a workspace
        </H2>
        <P>
          Deleting a workspace also deletes its wallet. If it has unused minutes from a purchase made in the last 14 days, ask
          for that refund before or together with your deletion request. Other unused minutes can&apos;t be refunded and are
          lost when the workspace is deleted.
        </P>
        <P>
          Questions about a payment or your balance: <A href={BILLING_HREF}>contact us</A>. See also the{" "}
          <A href="/terms">Terms of Service</A> and <A href="/privacy">Privacy Policy</A>.
        </P>
      </Section>
    </LegalPage>
  );
}
