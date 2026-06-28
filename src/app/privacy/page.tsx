import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — Hotel Siddhi Vinayak AI Operating System",
  description:
    "How the Hotel Siddhi Vinayak AI Operating System collects, uses, and protects data, including Gmail (Google OAuth) usage for Night Audit automation.",
};

const UPDATED = "June 28, 2026";
const CONTACT = "hotelsiddhivinayakjodhpur@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains how the <strong>Hotel Siddhi Vinayak AI Operating System</strong> (the
        &ldquo;Application&rdquo;) collects, uses, stores, and protects information. The Application is a private,
        internal operations tool built and operated solely for <strong>Hotel Siddhi Vinayak, Jodhpur</strong>. It is
        not a public service, and it is not offered to or used by any other organization.
      </p>

      <LegalSection heading="1. Who this applies to">
        <p>
          The Application is used only by authorized staff of Hotel Siddhi Vinayak to monitor the hotel&rsquo;s own
          operational and digital performance. It does not collect data from hotel guests or members of the public.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we process">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Gmail (Google account) data</strong> — via Google OAuth, the Application reads the hotel&rsquo;s own
            mailbox (<span className="font-mono">{CONTACT}</span>) to locate and process the daily
            <strong> Stayflexi Night Audit</strong> report emails.
          </li>
          <li>
            <strong>Hotel operational metrics</strong> — occupancy, ADR, RevPAR, room revenue, and payment summaries
            parsed from those Stayflexi report emails.
          </li>
          <li>
            <strong>Google Analytics &amp; Search Console data</strong> — aggregate website traffic and search
            performance for the hotel&rsquo;s own website, accessed via a Google service account.
          </li>
          <li>
            <strong>Website health data</strong> — publicly available technical signals about the hotel&rsquo;s own
            website (uptime, performance, SSL, sitemap).
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. How Gmail data is used (Google OAuth)">
        <p>
          The Application requests the <span className="font-mono">gmail.modify</span> scope. This access is used
          <strong> exclusively</strong> to:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>find unread Stayflexi Night Audit report emails sent to the hotel&rsquo;s mailbox;</li>
          <li>read the contents of those report emails to extract the hotel&rsquo;s own performance metrics;</li>
          <li>mark each processed report email as read so it is not processed again.</li>
        </ul>
        <p>
          The Application does <strong>not</strong> read, index, or store any other emails, does not send email, and
          does not delete email. Only messages identified as Stayflexi Night Audit reports are processed.
        </p>
      </LegalSection>

      <LegalSection heading="4. Limited Use disclosure (Google API Services)">
        <p>
          The Application&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
          <a className="text-brand underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the <strong>Limited Use</strong> requirements. Specifically, data obtained from Google (including
          Gmail) is used only to provide and improve the Night Audit automation features described here; it is{" "}
          <strong>not</strong> sold, <strong>not</strong> used for advertising, and <strong>not</strong> transferred to
          others except as required to operate the Application or to comply with applicable law. No human reads the
          Gmail data except where necessary for security, to comply with law, or with the hotel&rsquo;s explicit consent.
        </p>
      </LegalSection>

      <LegalSection heading="5. No third-party data sharing">
        <p>
          We do <strong>not</strong> sell, rent, or share any data with third parties for marketing or any other
          purpose. Data is processed only by the infrastructure providers required to run the Application on the
          hotel&rsquo;s behalf — namely Google (source data), Supabase/PostgreSQL (encrypted database), and Vercel
          (hosting) — each acting as a processor under their own security and privacy commitments.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data storage &amp; security">
        <p>
          Parsed report data is stored in a private Supabase (PostgreSQL) database. Access is restricted to the
          Application&rsquo;s server using credentials held only in encrypted server-side environment variables.
          Connections use TLS, secrets are never exposed to the browser, and privileged endpoints are
          authentication-gated.
        </p>
      </LegalSection>

      <LegalSection heading="7. Data retention &amp; deletion">
        <p>
          Operational metrics are retained only as long as useful for hotel reporting. The hotel may request deletion
          of stored data at any time by contacting us. Google access can be revoked at any time from the Google Account{" "}
          <a className="text-brand underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            permissions page
          </a>
          ; once revoked, the Application can no longer read the mailbox.
        </p>
      </LegalSection>

      <LegalSection heading="8. Changes to this policy">
        <p>
          We may update this Privacy Policy as the Application evolves. Material changes will be reflected here with an
          updated date above.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions about this policy or your data: <span className="font-mono">{CONTACT}</span> — Hotel Siddhi
          Vinayak, Jodhpur, Rajasthan, India.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
