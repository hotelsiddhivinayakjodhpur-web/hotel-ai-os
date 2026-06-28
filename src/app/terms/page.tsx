import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service — Hotel Siddhi Vinayak AI Operating System",
  description:
    "Terms governing use of the Hotel Siddhi Vinayak AI Operating System, a private internal operations tool.",
};

const UPDATED = "June 28, 2026";
const CONTACT = "hotelsiddhivinayakjodhpur@gmail.com";

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={UPDATED}>
      <p>
        These Terms govern use of the <strong>Hotel Siddhi Vinayak AI Operating System</strong> (the
        &ldquo;Application&rdquo;), a private, internal operations tool built and operated solely for
        <strong> Hotel Siddhi Vinayak, Jodhpur</strong>. By accessing the Application you agree to these Terms.
      </p>

      <LegalSection heading="1. Purpose &amp; scope">
        <p>
          The Application aggregates the hotel&rsquo;s own operational and digital data — Stayflexi Night Audit reports
          (via Gmail), Google Analytics, Google Search Console, and website health — into internal dashboards for
          authorized hotel staff. It is not a public product and is not licensed to any other party.
        </p>
      </LegalSection>

      <LegalSection heading="2. Authorized use">
        <p>
          Access is limited to authorized personnel of Hotel Siddhi Vinayak. You agree not to misuse the Application,
          attempt to access data beyond your authorization, or use it for any purpose other than the hotel&rsquo;s
          internal operations.
        </p>
      </LegalSection>

      <LegalSection heading="3. Google account &amp; data">
        <p>
          The Application connects to Google services (including Gmail) using OAuth, strictly to automate processing of
          the hotel&rsquo;s Stayflexi Night Audit emails. Your use of Google data through the Application is also subject
          to the{" "}
          <a className="text-brand underline" href="/privacy">Privacy Policy</a> and Google&rsquo;s own terms. You may
          revoke Google access at any time via your Google Account settings.
        </p>
      </LegalSection>

      <LegalSection heading="4. Data accuracy">
        <p>
          Metrics shown are derived from third-party sources (Stayflexi, Google). While we parse them faithfully and
          never fabricate figures, the Application is provided for informational and operational support only and should
          not be the sole basis for material business or financial decisions.
        </p>
      </LegalSection>

      <LegalSection heading="5. Availability">
        <p>
          The Application is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not warrant
          uninterrupted or error-free operation, and automated data syncs may be delayed or unavailable due to upstream
          provider outages.
        </p>
      </LegalSection>

      <LegalSection heading="6. Limitation of liability">
        <p>
          To the maximum extent permitted by law, the operators of the Application are not liable for any indirect,
          incidental, or consequential damages arising from use of, or inability to use, the Application.
        </p>
      </LegalSection>

      <LegalSection heading="7. Changes">
        <p>
          We may update these Terms as the Application evolves. Continued use after changes constitutes acceptance of the
          updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="8. Contact">
        <p>
          Questions about these Terms: <span className="font-mono">{CONTACT}</span> — Hotel Siddhi Vinayak, Jodhpur,
          Rajasthan, India.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
