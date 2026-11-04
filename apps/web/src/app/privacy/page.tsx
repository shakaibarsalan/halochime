import type { Metadata, Viewport } from "next";
import { A, B, Callout, DataTable, H2, H3, LegalPage, List, P, Section, type TocItem } from "@/components/site/prose";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/site";

// Facts on this page come from the code: db/schema/app.ts (what is stored), apps/agent (no audio is
// recorded), lib/summary.ts and apps/agent/agent.py (model providers), lib/webhooks/dispatch.ts
// (30-day delivery log), deploy/server/backup.sh (encrypted nightly backups). Change them together.

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Halochime stores, why, who else processes it, how long we keep it and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export const viewport: Viewport = { themeColor: "#07070c" };

const TOC: TocItem[] = [
  { id: "who-we-are", label: "Who we are" },
  { id: "roles", label: "Businesses and visitors" },
  { id: "what-we-collect", label: "What we collect" },
  { id: "voice", label: "Voice calls and audio" },
  { id: "how-we-use", label: "How we use it" },
  { id: "providers", label: "Who else processes it" },
  { id: "retention", label: "How long we keep it" },
  { id: "deletion", label: "Deleting your data" },
  { id: "rights", label: "Your rights" },
  { id: "storage", label: "Cookies and browser storage" },
  { id: "security", label: "Security" },
  { id: "businesses", label: "If Halochime is on your site" },
  { id: "changes", label: "Changes and contact" },
];

const DELETE_HREF = "/contact?topic=privacy";

export default function PrivacyPage() {
  return (
    <LegalPage
      label="Legal"
      eyebrow="Privacy Policy"
      title="What we keep, and"
      accent="why."
      updated={LEGAL_UPDATED}
      toc={TOC}
      intro={
        <p>
          This policy explains what Halochime stores, why, who else handles it, and how to have it deleted. It covers the
          businesses that use Halochime and the visitors who talk to their agents.
        </p>
      }
    >
      <Section first>
        <H2 id="who-we-are" n={1}>
          Who we are
        </H2>
        <P>
          Halochime is a voice and text support agent that businesses add to their websites. The service is provided by{" "}
          {OPERATOR} (&ldquo;Halochime&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). You can reach us through the{" "}
          <A href="/contact">contact page</A>.
        </P>
      </Section>

      <Section>
        <H2 id="roles" n={2}>
          Businesses and visitors
        </H2>
        <P>Halochime handles two kinds of personal data, in two different roles.</P>
        <List>
          <li>
            <B>Businesses, our customers.</B> When you create an account, we decide how your account data is used. For that
            data we are the controller.
          </li>
          <li>
            <B>Visitors.</B> When someone talks to a business&apos;s agent, the business decides what the agent does and what
            it collects. The business is the controller of its visitors&apos; data. We process that data for the business, on
            its instructions, to run the service: we are its processor.
          </li>
        </List>
        <Callout>
          If you talked to an agent on a website and have a question about that conversation, or want it deleted, ask the
          business that runs the website. If you can&apos;t reach them, <A href={DELETE_HREF}>contact us</A> and we will pass
          your request on and help them answer it.
        </Callout>
      </Section>

      <Section>
        <H2 id="what-we-collect" n={3}>
          What we collect
        </H2>
        <H3>Your account</H3>
        <List>
          <li>Your name, email address and password. The password is stored only as a secure hash.</li>
          <li>
            If you continue with Google: your name, email address and profile picture from your Google account, and Google&apos;s
            account id. We don&apos;t get your Google password or anything else in your Google account.
          </li>
          <li>The workspaces you create or join, your role in each, and the invites you send or receive.</li>
          <li>Your sign-in sessions, with the IP address and browser of each, so you stay signed in and we can spot misuse.</li>
          <li>One-time codes for verifying your email and resetting your password. They expire after 10 minutes.</li>
          <li>Messages you send us through the contact form, and our replies.</li>
        </List>
        <H3>What you set up</H3>
        <List>
          <li>Agent settings: name, greeting, persona, instructions, language, voice, colours and an optional picture.</li>
          <li>
            Knowledge: text you paste, text read from web pages you import, and text taken from files you upload. We keep the
            text, not the original file.
          </li>
          <li>
            Allowed domains, actions (the addresses and headers your agent may call) and webhook endpoints. Action headers,
            identity secrets and webhook signing secrets are stored encrypted.
          </li>
        </List>
        <H3>Conversations, kept for the business</H3>
        <List>
          <li>
            The transcript of each voice call and chat: what the visitor and the agent said, as text, and the results of any
            actions the agent ran.
          </li>
          <li>The page the conversation started on (its address without the query string or fragment) and its title.</li>
          <li>A random visitor id kept in the visitor&apos;s browser, so a returning visitor can be recognised.</li>
          <li>
            If the business signs its users in with identity tokens: the user id, name, email and any other facts the
            business puts in the token.
          </li>
          <li>Details the visitor chooses to give, such as a name, email, phone number and a message for the team.</li>
          <li>
            A short summary and the details picked out of the conversation, such as the topic, the outcome, how the visitor
            seemed, and any fields the business asked the agent to note.
          </li>
          <li>When it started and ended, how long it lasted and why it ended.</li>
        </List>
        <H3>Usage and billing</H3>
        <List>
          <li>Each workspace&apos;s balance of voice minutes, every top up, and the minutes each call used.</li>
          <li>
            What you bought and paid. The payment itself is handled by the payment provider behind the link we send you; we
            don&apos;t receive your card or bank details.
          </li>
        </List>
        <H3>Technical data</H3>
        <List>
          <li>A log of each event we sent to your webhook endpoints, with its payload and your server&apos;s answer.</li>
          <li>
            To limit abuse, we count new conversations and sign-in attempts per IP address over a few minutes. These counts
            live in memory only and are not saved.
          </li>
          <li>Our hosting providers keep short technical logs, such as IP addresses and request times, to run and protect the service.</li>
        </List>
      </Section>

      <Section>
        <H2 id="voice" n={4}>
          Voice calls and audio
        </H2>
        <P>
          <B>We don&apos;t record or store the audio of voice calls.</B> During a call, the visitor&apos;s voice travels through
          LiveKit to the speech services that listen and answer (OpenAI and Deepgram), which turn it into text and speech as
          the call happens. What we save is the text transcript.
        </P>
        <P>
          The widget only uses the microphone after the visitor starts a voice call and allows it in their browser. Visitors
          can always type instead.
        </P>
      </Section>

      <Section>
        <H2 id="how-we-use" n={5}>
          How we use it
        </H2>
        <List>
          <li>
            To run Halochime: answer visitors, search your knowledge, call your actions, write summaries, show conversations
            and messages in your dashboard, and send your webhooks.
          </li>
          <li>
            To send the emails the service needs: verification and password codes, invites, alerts when a visitor leaves a
            message, low-minute warnings and a welcome email.
          </li>
          <li>To count voice minutes and keep your balance right.</li>
          <li>To keep the service safe, find and fix problems, and answer your messages to us.</li>
        </List>
        <P>
          We don&apos;t sell personal data, show ads or use analytics or tracking tools. We don&apos;t use your knowledge or
          your conversations to train AI models. We look at a workspace&apos;s data only when we need to: to give support you
          asked for, fix a problem, keep the service safe or follow the law.
        </P>
        <P>
          Where data protection law asks for a legal basis: we use account data to provide the service you signed up for
          (our contract with you) and for our legitimate interest in running and protecting it. We process visitors&apos;
          data on the business&apos;s instructions.
        </P>
      </Section>

      <Section>
        <H2 id="providers" n={6}>
          Who else processes it
        </H2>
        <P>These companies process data for us, each for its own part of the service:</P>
        <DataTable
          head={["Provider", "What it does for Halochime", "What it handles"]}
          rows={[
            ["Vercel", "Hosts the website, the dashboard and the API.", "Every request to Halochime and the data in it."],
            [
              "Oracle Cloud",
              "Runs our server in Mumbai, India: the database, the voice agent and our own knowledge search.",
              "Everything we store.",
            ],
            ["LiveKit", "Carries the live voice and chat connection between the visitor and the agent.", "Call audio and chat messages, while the conversation runs."],
            [
              "OpenAI",
              "The realtime voice model, conversation summaries, and a backup text model.",
              "Call audio, conversation text and matching parts of your knowledge.",
            ],
            ["Deepgram", "Speech to text, and the voices of the classic voice engine.", "Call audio and the agent's spoken replies."],
            [
              "Groq",
              "The default text model for chats and classic voice calls, and a backup for summaries.",
              "Conversation text and matching parts of your knowledge.",
            ],
            ["Anthropic", "Text replies, only for agents set to a Claude model.", "Conversation text and matching parts of your knowledge."],
            [
              "Google",
              "Sign in with Google (if you choose it). Gmail sends our emails. Gemini can stand in as a backup text model.",
              "Your Google sign-in; email addresses and email content; conversation text when Gemini is used.",
            ],
            ["GitHub", "Stores our nightly database backups, which are encrypted before they leave our server.", "Encrypted backup files only."],
          ]}
        />
        <P>
          Knowledge search runs on our own server, so your content isn&apos;t sent anywhere else to be searched. The parts of
          your knowledge that match a question are sent to the AI model along with the conversation, so it can answer.
        </P>
        <P>
          Our database is stored in India (Oracle Cloud, Mumbai) and the website runs in Mumbai too. Some providers process
          data in other countries, mainly the United States, so data can leave the country where you or your visitors are. Each provider handles it under its own terms and privacy commitments.
        </P>
        <P>
          Apart from these providers, data leaves Halochime only when the business sends it somewhere (through its webhooks
          and actions), when the law requires it, or if Halochime is ever sold or merged, in which case the new owner must
          keep to this policy.
        </P>
      </Section>

      <Section>
        <H2 id="retention" n={7}>
          How long we keep it
        </H2>
        <DataTable
          head={["Data", "Kept"]}
          rows={[
            ["Account data", "While your account exists."],
            [
              "Agents, knowledge, conversations, transcripts and messages for your team",
              "Until the business deletes them or asks us to. Knowledge, actions and webhook endpoints can be deleted in the dashboard.",
            ],
            ["Webhook delivery log", "30 days, then deleted automatically."],
            ["Verification and password codes", "10 minutes."],
            ["Records of purchases and refunds", "As long as the law requires, even after an account is deleted."],
          ]}
        />
        <P>
          Every night we make an encrypted copy of the database and keep the copies for 30 days. Deleted data can remain in
          those copies until they expire. We use them only to recover from a failure, and if we ever restore one, we delete
          again anything that had been deleted.
        </P>
      </Section>

      <Section>
        <H2 id="deletion" n={8}>
          Deleting your data
        </H2>
        <P>
          There is no delete button for a whole account or workspace yet. To delete your account, a workspace or particular
          conversations, send a request through the <A href={DELETE_HREF}>contact page</A> and choose{" "}
          <B>Privacy or data deletion</B>. We check that the request comes from the account holder (for a workspace, its
          owner), delete the data within 30 days and tell you when it&apos;s done.
        </P>
        <P>
          Deleting a workspace removes its agents, knowledge, conversations, transcripts, messages, webhooks and usage
          history. Unused voice minutes are covered by the <A href="/refund-policy">Refund Policy</A>.
        </P>
      </Section>

      <Section>
        <H2 id="rights" n={9}>
          Your rights
        </H2>
        <P>
          Depending on where you live, you may have the right to see the personal data we hold about you, correct it, delete
          it, get a copy of it, object to or limit some uses of it, and complain to a data protection authority. To use any of
          these rights, <A href={DELETE_HREF}>contact us</A>. We reply within 30 days.
        </P>
        <P>
          Visitors: the business whose website you were on decides about your conversation data, so please ask them first.
          We help them answer.
        </P>
      </Section>

      <Section>
        <H2 id="storage" n={10}>
          Cookies and browser storage
        </H2>
        <List>
          <li>
            The Halochime website and dashboard use only the cookies needed to keep you signed in. There are no advertising or
            analytics cookies.
          </li>
          <li>
            The widget on a business&apos;s website sets no cookies. It keeps a random visitor id in the browser&apos;s local
            storage so a returning visitor can be recognised. Clearing the site&apos;s data in the browser removes it.
          </li>
        </List>
      </Section>

      <Section>
        <H2 id="security" n={11}>
          Security
        </H2>
        <P>
          Connections to Halochime use HTTPS, and our database only accepts the app&apos;s connections over TLS. Passwords are
          hashed, action headers and identity and webhook secrets are encrypted, and backups are encrypted before they leave
          our server.
          No system is perfectly secure. If a breach affects your data, we will tell you without undue delay.
        </P>
      </Section>

      <Section>
        <H2 id="businesses" n={12}>
          If Halochime is on your site
        </H2>
        <P>As the business, you decide what your agent asks and collects. You are responsible for:</P>
        <List>
          <li>
            telling your visitors that your site uses an AI agent provided by Halochime and that conversations are
            transcribed, for example in your own privacy notice;
          </li>
          <li>having a lawful reason for what you ask the agent to collect, and any consent the law requires;</li>
          <li>
            not asking the agent to collect sensitive data such as card numbers, passwords, government ID numbers or health
            details;
          </li>
          <li>answering your visitors&apos; requests about their data. We help when you need us to.</li>
        </List>
        <P>
          Halochime is a service for businesses. Accounts are for adults, and the widget should not be used on sites made for
          children.
        </P>
      </Section>

      <Section>
        <H2 id="changes" n={13}>
          Changes and contact
        </H2>
        <P>
          If we change this policy, we post the new version here with a new date. If a change affects how we use your data,
          we also email account owners before it takes effect.
        </P>
        <P>
          Questions or requests: use the <A href="/contact">contact page</A>. See also our <A href="/terms">Terms of Service</A>{" "}
          and <A href="/refund-policy">Refund Policy</A>.
        </P>
      </Section>
    </LegalPage>
  );
}
