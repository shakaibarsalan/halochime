import type { Metadata, Viewport } from "next";
import { A, B, H2, LegalPage, List, P, Section, type TocItem } from "@/components/site/prose";
import { TRIAL_SECONDS } from "@/db/schema";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using Halochime: accounts, your content, AI answers, acceptable use, voice minutes and liability.",
  alternates: { canonical: "/terms" },
};

export const viewport: Viewport = { themeColor: "#07070c" };

const TRIAL_MIN = TRIAL_SECONDS / 60;

const TOC: TocItem[] = [
  { id: "agreement", label: "These terms" },
  { id: "service", label: "The service" },
  { id: "accounts", label: "Accounts and workspaces" },
  { id: "content", label: "Your content and your visitors" },
  { id: "ai", label: "AI answers" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "payment", label: "Voice minutes and payment" },
  { id: "availability", label: "Changes and availability" },
  { id: "ending", label: "Suspension and closing" },
  { id: "liability", label: "Disclaimers and liability" },
  { id: "law", label: "Governing law" },
  { id: "changes", label: "Changes and contact" },
];

export default function TermsPage() {
  return (
    <LegalPage
      label="Legal"
      eyebrow="Terms of Service"
      title="The rules, in"
      accent="plain words."
      updated={LEGAL_UPDATED}
      toc={TOC}
      intro={<p>These terms cover your use of Halochime. Please read them before you create an account.</p>}
    >
      <Section first>
        <H2 id="agreement" n={1}>
          These terms
        </H2>
        <P>
          These terms are an agreement between you and {OPERATOR}. By creating an account or using Halochime, you agree to
          them. If you use Halochime for a business, you agree for that business, and &ldquo;you&rdquo; includes it.
        </P>
        <P>
          Our <A href="/privacy">Privacy Policy</A> and <A href="/refund-policy">Refund Policy</A> are part of these terms.
        </P>
      </Section>

      <Section>
        <H2 id="service" n={2}>
          The service
        </H2>
        <P>
          Halochime gives your website an AI agent that answers visitors by voice and text from the knowledge you add, takes
          messages for your team, and can connect to your own systems through actions and webhooks.
        </P>
        <P>
          Halochime is in beta. Features change, and there will be bugs and some downtime. We work to keep it reliable, but
          please don&apos;t rely on it as your only way for customers to reach you.
        </P>
      </Section>

      <Section>
        <H2 id="accounts" n={3}>
          Accounts and workspaces
        </H2>
        <List>
          <li>You must be at least 18 and able to enter into this agreement.</li>
          <li>
            Use a real email address and keep your password safe. You are responsible for what happens in your account and in
            the workspaces you own, including what the members you invite do.
          </li>
          <li>
            Each person gets the {TRIAL_MIN} free voice minutes once, on the first workspace they create. Don&apos;t create
            extra accounts to get more.
          </li>
          <li>Tell us straight away if you think someone else has used your account.</li>
        </List>
      </Section>

      <Section>
        <H2 id="content" n={4}>
          Your content and your visitors
        </H2>
        <List>
          <li>
            <B>Your content stays yours.</B> That includes your knowledge, your agent settings and your visitors&apos;
            conversations. You let us store, copy and process it only as needed to run Halochime for you, including sending it
            to the providers listed in the <A href="/privacy#providers">Privacy Policy</A>.
          </li>
          <li>You confirm you have the right to use what you add, and that it doesn&apos;t break the law or anyone&apos;s rights.</li>
          <li>
            For your visitors&apos; data, you are the controller and we are your processor. You are responsible for telling
            visitors about the agent, getting any consent the law requires (for example for transcribing calls) and
            answering their requests. We follow the instructions you set in your dashboard and help you with requests.
          </li>
          <li>If you send us ideas or feedback, we may use them without owing you anything.</li>
        </List>
      </Section>

      <Section>
        <H2 id="ai" n={5}>
          AI answers
        </H2>
        <List>
          <li>
            Answers are written by AI models from your knowledge and instructions. They can be wrong, incomplete or out of
            date, even when your knowledge is right. Review your conversations and keep your knowledge current.
          </li>
          <li>
            Your agent speaks for your business on your website. You are responsible for how you set it up and for what it
            tells or promises your visitors.
          </li>
          <li>
            Don&apos;t use Halochime where a wrong answer could cause serious harm, such as medical, legal or financial advice,
            or emergencies.
          </li>
        </List>
      </Section>

      <Section>
        <H2 id="acceptable-use" n={6}>
          Acceptable use
        </H2>
        <P>You must not use Halochime to:</P>
        <List>
          <li>break the law or anyone&apos;s rights, including privacy and consumer protection law;</li>
          <li>collect card numbers, passwords, government ID numbers, health information or other sensitive data;</li>
          <li>mislead people, including telling visitors the agent is a person;</li>
          <li>send spam, or harass, threaten or abuse anyone;</li>
          <li>run an agent on a website you don&apos;t control or aren&apos;t allowed to use;</li>
          <li>point actions or webhooks at systems you don&apos;t own or don&apos;t have permission to use;</li>
          <li>attack, overload or get around the limits or security of the hosted service, or help anyone else do so.</li>
        </List>
      </Section>

      <Section>
        <H2 id="payment" n={7}>
          Voice minutes and payment
        </H2>
        <List>
          <li>
            Voice calls use prepaid minutes held in each workspace&apos;s wallet, counted per started minute. Text chat is free
            during the beta.
          </li>
          <li>
            To buy minutes, ask us through the <A href="/contact?topic=billing">contact page</A>. We send you the price and a
            payment link, and once you have paid we add the minutes to your workspace.
          </li>
          <li>
            Minutes don&apos;t expire. Refunds follow the <A href="/refund-policy">Refund Policy</A>.
          </li>
          <li>
            We may change prices for future purchases, and we may start charging for text chat after the beta. We will tell
            you before any new charge applies. Minutes you already bought are not affected.
          </li>
        </List>
      </Section>

      <Section>
        <H2 id="availability" n={8}>
          Changes and availability
        </H2>
        <List>
          <li>
            We keep improving Halochime and may add, change or remove features. During the beta we don&apos;t promise any
            particular uptime.
          </li>
          <li>
            We may set or change limits, such as call length, sessions per visitor or knowledge size, to keep the service
            working for everyone. The current limits are in the <A href="/docs#limits">docs</A>.
          </li>
          <li>
            Halochime&apos;s source code is published under the GNU Affero General Public License v3. These terms cover the
            hosted service on this website; your use of the code itself is covered by that licence.
          </li>
        </List>
      </Section>

      <Section>
        <H2 id="ending" n={9}>
          Suspension and closing
        </H2>
        <List>
          <li>
            You can stop using Halochime at any time. An owner can delete a workspace in its Settings. To close your
            account, or to have us delete a workspace for you, ask through the <A href="/contact?topic=privacy">contact page</A>.
            We delete it within 30 days, as the <A href="/privacy#deletion">Privacy Policy</A> describes.
          </li>
          <li>
            We may suspend or close an account, a workspace or an agent if it breaks these terms, puts the service or other
            people at risk, or if the law requires it. Where we can, we tell you first and give you a chance to fix the
            problem.
          </li>
        </List>
      </Section>

      <Section>
        <H2 id="liability" n={10}>
          Disclaimers and liability
        </H2>
        <P>
          Halochime is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. As far as the law allows, we make no
          promises beyond those in these terms, including that the service will be free of errors, always available or fit
          for a particular purpose.
        </P>
        <P>As far as the law allows:</P>
        <List>
          <li>we are not liable for indirect or consequential losses, such as lost profits, revenue, data or goodwill;</li>
          <li>our total liability for any claim about Halochime is limited to what you paid us in the 12 months before the claim;</li>
          <li>
            you will cover our losses from claims by others that come from your content, from your use of Halochime against
            these terms, or from your dealings with your visitors.
          </li>
        </List>
        <P>Nothing in these terms limits any liability that the law does not allow to be limited.</P>
      </Section>

      <Section>
        <H2 id="law" n={11}>
          Governing law
        </H2>
        <P>
          These terms are governed by the laws of Pakistan. If there is a dispute, please contact us first so we can try to
          solve it together. If we can&apos;t, the courts of Pakistan will decide it.
        </P>
      </Section>

      <Section>
        <H2 id="changes" n={12}>
          Changes and contact
        </H2>
        <P>
          We may update these terms. We post the new version here with a new date, and email account owners about important
          changes before they apply. If you keep using Halochime after a change applies, you accept the new terms.
        </P>
        <P>
          Questions about these terms: use the <A href="/contact">contact page</A>.
        </P>
      </Section>
    </LegalPage>
  );
}
