import type { Metadata } from "next";
import { LEGAL } from "../legal";
import { Contact, LegalDocument } from "../legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy · Harness",
  description: `What ${LEGAL.company} collects, why, and the choices you have.`,
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      lead={
        <p>
          This policy explains what personal information {LEGAL.entity} (&ldquo;{LEGAL.company},&rdquo;
          &ldquo;we&rdquo;) collects when you use the Harness website, web console, command-line client, and
          APIs (the &ldquo;Service&rdquo;), what we do with it, and the choices you have. The short version:
          we collect what we need to run your organization&apos;s harnesses, we do not sell it, and the
          conversations between your agents and your model provider do not pass through us.
        </p>
      }
    >
      <h2>1. What we collect</h2>
      <h3>Account information</h3>
      <p>
        Your name, email address, and sign-in credentials, handled by our authentication provider. If you
        join through an invitation, we also record who invited you and to which organization.
      </p>
      <h3>Organization information</h3>
      <p>
        Your organization&apos;s structure: its teams and sub-teams, who belongs to each, and their roles,
        along with the boundaries and policies set for them.
      </p>
      <h3>Content you store</h3>
      <p>
        Skills, memories, prompts, system prompts, harness definitions, and version history. These can
        contain personal information if you or your colleagues put it there.
      </p>
      <h3>Credentials</h3>
      <p>
        API keys and similar secrets your organization adds. We encrypt them at rest, show only their last
        four characters afterwards, and release them only to sessions your organization&apos;s settings
        authorize.
      </p>
      <h3>Session and audit records</h3>
      <p>
        When a session starts we record who started it, which harness and agent it used, when it ran, and
        what our Service did for it, such as the assets resolved and the credentials issued. Changes to
        assets, teams, and policies are recorded in a tamper-evident audit log attributed to the person who
        made them.
      </p>
      <h3>Account requests</h3>
      <p>
        If you ask for an account through our public form, we keep the address and the details you
        give us — your name, company, team size, and note — so we can reply. We also keep a salted
        hash of your IP address, never the address itself, to limit abuse of the form.
      </p>
      <h3>Technical information</h3>
      <p>
        IP address, browser and device type, and request logs, which our servers and hosting providers
        record when you use the Service.
      </p>

      <h2>2. What we don&apos;t collect</h2>
      <p>
        Agents run on your own machine and send model requests directly to the model provider your
        organization configures. We do not receive or store the prompts you type or the responses the model
        returns, unless you choose to save something as an asset. We do not use advertising or third-party
        analytics trackers.
      </p>

      <h2>3. How we use it</h2>
      <ul>
        <li>to provide the Service: sign you in, resolve harnesses, issue scoped credentials, and sync assets;</li>
        <li>to enforce the boundaries your organization sets and keep the audit trail it relies on;</li>
        <li>to secure the Service, prevent abuse, and investigate incidents;</li>
        <li>to support you and send essential messages about your account or the Service;</li>
        <li>to meet legal obligations.</li>
      </ul>
      <p>
        We do not sell personal information, share it for targeted advertising, or use your content to train
        machine-learning models.
      </p>
      <p>
        If you are in the European Economic Area or the United Kingdom, we rely on these legal bases:
        performing our contract with you or your organization; our legitimate interests in securing and
        improving the Service; compliance with legal obligations; and, where we ask for it, your consent.
      </p>

      <h2>4. Your organization&apos;s role</h2>
      <p>
        When you use the Service as a member of an organization, that organization decides much of what
        happens to the information in it: who can see which assets, how long records are kept, and whether
        records are placed on legal hold. For that information we act on the organization&apos;s instructions
        as its processor. Administrators can see audit records of members&apos; activity. If you have a
        request about information your organization controls, contact its administrator; we will help them
        respond.
      </p>

      <h2>5. Who we share it with</h2>
      <ul>
        <li>
          <strong>Service providers</strong> that host and operate the Service for us, including our database
          and authentication provider (Supabase) and our hosting providers. They may use the information only
          to provide their services to us.
        </li>
        <li>
          <strong>People in your organization</strong>, according to the sharing and access settings your
          organization chooses.
        </li>
        <li>
          <strong>Authorities</strong>, when the law requires it or to protect the rights, property, or safety
          of our users, the public, or us.
        </li>
        <li>
          <strong>A successor</strong>, if we are involved in a merger, acquisition, or sale of assets, subject
          to this policy.
        </li>
      </ul>

      <h2>6. How long we keep it</h2>
      <p>
        We keep account, organization, and content information while your account is active. Audit and
        session records follow the retention your organization sets, and records under legal hold are kept
        until the hold is released. When an account or organization is closed we delete its information
        within 30 days of the end of the export period, except where we must keep it longer by law. Deleted
        data may remain in encrypted backups for up to 30 more days.
      </p>

      <h2>7. How we protect it</h2>
      <p>
        We encrypt data in transit and credentials at rest, issue credentials to sessions only in the scope
        they were granted, limit staff access to what is needed to run the Service, and record changes in an
        audit log. No system is perfectly secure; if a breach affects your information, we will notify you
        as the law requires.
      </p>

      <h2>8. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, export, or delete your
        personal information, to object to or restrict how we use it, and to withdraw consent. Email{" "}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> to make a request. We will respond within the time
        the law requires and will not treat you differently for exercising your rights. You may also
        complain to your local data protection authority.
      </p>

      <h2>9. International transfers</h2>
      <p>
        We and our service providers may process information in countries other than yours. Where the law
        requires it, we protect transfers with safeguards such as the European Commission&apos;s Standard
        Contractual Clauses.
      </p>

      <h2>10. Cookies and browser storage</h2>
      <p>
        We use only what the Service needs to work: browser storage that keeps you signed in and remembers
        your display theme. We do not use advertising or cross-site tracking cookies.
      </p>

      <h2>11. Children</h2>
      <p>
        The Service is not directed to children, and we do not knowingly collect information from anyone
        under 16. If you believe a child has given us information, contact us and we will delete it.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We will post any changes here and update the effective date. For material changes we will give
        notice through the Service or by email before they take effect.
      </p>

      <h2>13. Contact</h2>
      <Contact />
    </LegalDocument>
  );
}
