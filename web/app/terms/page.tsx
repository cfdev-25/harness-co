import type { Metadata } from "next";
import { LEGAL } from "../legal";
import { Contact, LegalDocument } from "../legal-document";

export const metadata: Metadata = {
  title: "Terms of Service · Harness",
  description: `The terms that govern use of ${LEGAL.company}'s harness management service.`,
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      lead={
        <p>
          These terms are an agreement between you and {LEGAL.entity} (&ldquo;{LEGAL.company},&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;). They cover the Harness website, web console, command-line
          client, and APIs (together, the &ldquo;Service&rdquo;). By creating an account or using the
          Service, you agree to them.
        </p>
      }
    >
      <h2>1. Who can use the Service</h2>
      <p>
        You must be at least 18 years old and able to form a binding contract. If you use the Service on
        behalf of a company or other organization, you confirm that you have authority to accept these
        terms for it, and &ldquo;you&rdquo; includes that organization.
      </p>

      <h2>2. Your account</h2>
      <p>
        Keep your sign-in details and any access tokens confidential. You are responsible for activity under
        your account and for the people you invite to your organization. Tell us promptly at{" "}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> if you believe your account has been compromised.
      </p>
      <p>
        Organization administrators control membership, roles, harnesses, and boundaries for everyone
        beneath them. If your account belongs to an organization, its administrators can see and manage
        what you do within it, including audit records of your sessions.
      </p>

      <h2>3. Your content</h2>
      <p>
        &ldquo;Your content&rdquo; means everything you or your organization put into the Service: skills,
        memories, prompts, harness definitions, organization structure, and settings. You keep all rights to
        it. You give us a limited license to host, copy, process, and display your content only as needed to
        run the Service for you, keep it secure, and meet our legal obligations. We do not use your content
        to train machine-learning models.
      </p>
      <p>
        You are responsible for your content and for having the rights to put it in the Service. Content you
        promote or share is made available to the people and teams your organization&apos;s settings allow.
      </p>

      <h2>4. Credentials you provide</h2>
      <p>
        You may store credentials, such as model-provider API keys, so the Service can issue them to
        sessions. We encrypt them at rest and release them only to sessions your organization&apos;s
        settings authorize. You remain responsible for those credentials, for the accounts they belong to,
        and for charges those accounts incur.
      </p>

      <h2>5. Agents, models, and other third-party services</h2>
      <p>
        The Service configures and launches agents you choose, such as Claude Code, Cursor, or Pi, and
        connects them to model providers and tools your organization selects. Those products are provided by
        third parties under their own terms and privacy policies, which you are responsible for following.
        We do not control them and are not responsible for their availability, outputs, or charges. Agent
        and model output can be wrong; review it before relying on it.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to, and not to let anyone else:</p>
      <ul>
        <li>break the law, infringe others&apos; rights, or use the Service to harm people;</li>
        <li>
          probe, bypass, or disable the Service&apos;s security, boundaries, or access controls, except
          through a coordinated disclosure to us;
        </li>
        <li>access accounts, organizations, or data you are not authorized to reach;</li>
        <li>upload malware or interfere with the Service or its infrastructure;</li>
        <li>resell or provide the Service to others except as we agree in writing;</li>
        <li>
          reverse engineer the Service, except where the law allows it despite this restriction, or use it to
          build a competing product.
        </li>
      </ul>

      <h2>7. Fees</h2>
      <p>
        Some features may require a paid plan. If you buy one, the price, billing period, and any usage
        limits shown at purchase or in your order form apply, along with these terms. Fees are
        non-refundable except where the law or your order form says otherwise. We will give you at least 30
        days&apos; notice before changing the price of a plan you are on.
      </p>

      <h2>8. Changes and availability</h2>
      <p>
        We are improving the Service continuously and may add, change, or remove features. We aim to keep it
        available, but we do not guarantee it will be uninterrupted or error-free. Features marked beta or
        preview are provided as they are and may change or end.
      </p>

      <h2>9. Feedback</h2>
      <p>
        If you send us ideas or suggestions, we may use them without owing you anything. This does not give
        us any rights to your content.
      </p>

      <h2>10. Ending your use</h2>
      <p>
        You can stop using the Service and close your account at any time. We may suspend or end your access
        if you materially breach these terms, if required by law, or to protect the Service or other users;
        where reasonable we will tell you first. After closure you may export your content for 30 days,
        after which we delete it as described in our <a href="/privacy">Privacy Policy</a>. Sections 3, 9,
        and 11 to 14 continue after closure.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        To the extent the law allows, the Service is provided &ldquo;as is&rdquo; and &ldquo;as
        available,&rdquo; without warranties of any kind, including warranties of merchantability, fitness
        for a particular purpose, and non-infringement.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the extent the law allows, neither party is liable for indirect, incidental, special,
        consequential, or punitive damages, or for lost profits, revenue, or data. Our total liability for
        all claims relating to the Service is limited to the greater of the amount you paid us in the 12
        months before the claim arose or US$100. These limits do not apply to liability that cannot be
        limited by law.
      </p>

      <h2>13. Indemnity</h2>
      <p>
        You will defend and indemnify {LEGAL.company} against third-party claims arising from your content or
        from your use of the Service in breach of these terms or the law.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These terms are governed by the laws of {LEGAL.jurisdiction}, without regard to conflict-of-law
        rules, and disputes will be heard in the courts located there. Nothing here limits rights you have
        as a consumer under the laws where you live.
      </p>

      <h2>15. Changes to these terms</h2>
      <p>
        We may update these terms. For material changes we will give notice through the Service or by email
        at least 30 days before they take effect. Continuing to use the Service after that means you accept
        the updated terms.
      </p>

      <h2>16. Contact</h2>
      <Contact />
    </LegalDocument>
  );
}
