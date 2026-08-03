// src/app/terms/page.tsx
//
// PUBLIC Terms and Conditions. Linked from the mandatory opt-in checkbox on the
// affiliate signup form (/affiliate) — affiliates accept these when they join
// the "I Know Someone" Club — and from the affiliate page footer.
//
// Same brand system as /affiliate: cream background, mint accents, Manrope
// headlines / Inter body. See [[brand_design_system]], [[affiliate_program]].

import Link from "next/link";
import type { Metadata } from "next";
import { BrandHeader, BrandFooter, Eyebrow } from "@/components/marketing/brand-chrome";

export const metadata: Metadata = {
  title: "Terms and Conditions | Credit Banc",
  description:
    "Terms and Conditions for www.creditbanc.io, operated by SAG Advisors LLC dba Credit Banc.",
};

const EFFECTIVE_DATE = "August 01, 2026";

// The Privacy Policy lives on the marketing site, not in the vault app.
const PRIVACY_POLICY_URL = "https://www.creditbanc.io/privacypolicy";

// Section copy is held as data so the legal text stays readable and diffable —
// edit the strings here, never the markup below. A paragraph may be JSX when it
// has to carry a link.
const SECTIONS: { title: string; body: React.ReactNode[] }[] = [
  {
    title: "Agreement between User and www.creditbanc.io",
    body: [
      'Welcome to www.creditbanc.io. The www.creditbanc.io website (the "Site") is comprised of various web pages operated by SAG Advisors LLC dba Credit Banc. www.creditbanc.io is offered to you conditioned on your acceptance without modification of the terms, conditions, and notices contained herein (the "Terms"). Your use of www.creditbanc.io constitutes your agreement to all such Terms. Please read these terms carefully and keep a copy of them for your reference.',
      "www.creditbanc.io is an E-Commerce Site focused on the sale and promotion of business consulting and small business loan products.",
    ],
  },
  {
    title: "Privacy",
    body: [
      <>
        Your use of www.creditbanc.io is subject to SAG Advisors LLC dba Credit Banc&apos;s{" "}
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-cb-mint hover:underline"
        >
          Privacy Policy
        </a>
        . Please review our Privacy Policy, which also governs the Site and informs users of our
        data collection practices.
      </>,
    ],
  },
  {
    title: "Electronic Communications",
    body: [
      "Visiting www.creditbanc.io or sending emails to SAG Advisors LLC dba Credit Banc constitutes electronic communications. You consent to receive electronic communications, and you agree that all agreements, notices, disclosures, and other communications that we provide to you electronically, via email and on the Site, satisfy any legal requirement that such communications be in writing.",
    ],
  },
  {
    title: "Your Account",
    body: [
      "If you use this site, you are responsible for maintaining the confidentiality of your account and password and for restricting access to your computer, and you agree to accept responsibility for all activities that occur under your account or password. You may not assign or otherwise transfer your account to any other person or entity. You acknowledge that SAG Advisors LLC dba Credit Banc is not responsible for third party access to your account that results from theft or misappropriation of your account. SAG Advisors LLC dba Credit Banc and its associates reserve the right to refuse or cancel service, terminate accounts, or remove or edit content in our sole discretion. You have knowingly participated in the ‘I Know Someone Club’ and agree to all promotional referral fees associated with this program. Credit Banc reserves the right to amend, supplement and alter the referral policy in its discretion.",
    ],
  },
  {
    title: "Children Under Thirteen",
    body: [
      "SAG Advisors LLC dba Credit Banc does not knowingly collect, either online or offline, personal information from persons under the age of thirteen. If you are under 18, you may use www.creditbanc.io only with permission of a parent or guardian.",
    ],
  },
  {
    title: "Links to Third Party Sites/Third Party Services",
    body: [
      'www.creditbanc.io may contain links to other websites ("Linked Sites"). The Linked Sites are not under the control of SAG Advisors LLC dba Credit Banc and SAG Advisors LLC dba Credit Banc is not responsible for the contents of any Linked Site, including without limitation any link contained in a Linked Site, or any changes or updates to a Linked Site. SAG Advisors LLC dba Credit Banc is providing these links to you only as a convenience, and the inclusion of any link does not imply endorsement by SAG Advisors LLC dba Credit Banc of the site or any association with its operators. Certain services made available via www.creditbanc.io are delivered by third party sites and organizations. By using any product, service or functionality originating from the www.creditbanc.io domain, you hereby acknowledge and consent that SAG Advisors LLC dba Credit Banc may share such information and data with any third party with whom SAG Advisors LLC dba Credit Banc has a contractual relationship to provide the requested product, service or functionality on behalf of www.creditbanc.io users and customers.',
    ],
  },
  {
    title: "No Unlawful or Prohibited Use/Intellectual Property",
    body: [
      "You are granted a non-exclusive, non-transferable, revocable license to access and use www.creditbanc.io strictly in accordance with these terms of use. As a condition of your use of the Site, you warrant to SAG Advisors LLC dba Credit Banc that you will not use the Site for any purpose that is unlawful or prohibited by these Terms. You may not use the Site in any manner which could damage, disable, overburden, or impair the Site or interfere with any other party's use and enjoyment of the Site. You may not obtain or attempt to obtain any materials or information through any means not intentionally made available or provided for through the Site.",
      "All content included as part of the Service, such as text, graphics, logos, images, as well as the compilation thereof, and any software used on the Site, is the property of SAG Advisors LLC dba Credit Banc or its suppliers and protected by copyright and other laws that protect intellectual property and proprietary rights. You agree to observe and abide by all copyright and other proprietary notices, legends or other restrictions contained in any such content and will not make any changes thereto.",
      "You will not modify, publish, transmit, reverse engineer, participate in the transfer or sale, create derivative works, or in any way exploit any of the content, in whole or in part, found on the Site. SAG Advisors LLC dba Credit Banc content is not for resale. Your use of the Site does not entitle you to make any unauthorized use of any protected content, and in particular you will not delete or alter any proprietary rights or attribution notices in any content. You will use protected content solely for your personal use, and will make no other use of the content without the express written permission of SAG Advisors LLC dba Credit Banc and the copyright owner. You agree that you do not acquire any ownership rights in any protected content. We do not grant you any licenses, express or implied, to the intellectual property of SAG Advisors LLC dba Credit Banc or our licensors except as expressly authorized by these Terms.",
    ],
  },
  {
    title: "Third Party Accounts",
    body: [
      "You will be able to connect your SAG Advisors LLC dba Credit Banc account to third party accounts. By connecting your SAG Advisors LLC dba Credit Banc account to your third-party account, you acknowledge and agree that you are consenting to the continuous release of information about you to others (in accordance with your privacy settings on those third-party sites). If you do not want information about you to be shared in this manner, do not use this feature.",
    ],
  },
  {
    title: "International Users",
    body: [
      "The Service is controlled, operated, and administered by SAG Advisors LLC dba Credit Banc from our offices within the USA. If you access the Service from a location outside the USA, you are responsible for compliance with all local laws. You agree that you will not use the SAG Advisors LLC dba Credit Banc Content accessed through www.creditbanc.io in any country or in any manner prohibited by any applicable laws, restrictions, or regulations.",
    ],
  },
  {
    title: "Indemnification",
    body: [
      "You agree to indemnify, defend and hold harmless SAG Advisors LLC dba Credit Banc, its officers, directors, employees, agents and third parties, for any losses, costs, liabilities and expenses (including reasonable attorney's fees) relating to or arising out of your use of or inability to use the Site or services, any user postings made by you, your violation of any terms of this Agreement or your violation of any rights of a third party, or your violation of any applicable laws, rules or regulations. SAG Advisors LLC dba Credit Banc reserves the right, at its own cost, to assume the exclusive defense and control of any matter otherwise subject to indemnification by you, in which event you will fully cooperate with SAG Advisors LLC dba Credit Banc in asserting any available defenses.",
    ],
  },
  {
    title: "Arbitration",
    body: [
      "In the event the parties are not able to resolve any dispute between them arising out of or concerning these Terms and Conditions, or any provisions hereof, whether in contract, tort, or otherwise at law or in equity for damages or any other relief, then such dispute shall be resolved only by final and binding arbitration pursuant to the Federal Arbitration Act, conducted by a single neutral arbitrator and administered by the American Arbitration Association, or a similar arbitration service selected by the parties, in a location mutually agreed upon by the parties. The arbitrator's award shall be final, and judgment may be entered upon it in any court having jurisdiction. In the event that any legal or equitable action, proceeding or arbitration arises out of or concerns these Terms and Conditions, the prevailing party shall be entitled to recover its costs and reasonable attorney's fees. The parties agree to arbitrate all disputes and claims in regard to these Terms and Conditions or any disputes arising as a result of these Terms and Conditions, whether directly or indirectly, including Tort claims that are a result of these Terms and Conditions. The parties agree that the Federal Arbitration Act governs the interpretation and enforcement of this provision. The entire dispute, including the scope and enforceability of this arbitration provision shall be determined by the Arbitrator. This arbitration provision shall survive the termination of these Terms and Conditions.",
    ],
  },
  {
    title: "Class Action Waiver",
    body: [
      "Any arbitration under these Terms and Conditions will take place on an individual basis; class arbitrations and class/representative/collective actions are not permitted. THE PARTIES AGREE THAT A PARTY MAY BRING CLAIMS AGAINST THE OTHER ONLY IN EACH'S INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PUTATIVE CLASS, COLLECTIVE AND/ OR REPRESENTATIVE PROCEEDING, SUCH AS IN THE FORM OF A PRIVATE ATTORNEY GENERAL ACTION AGAINST THE OTHER. Further, unless both you and SAG Advisors LLC dba Credit Banc agree otherwise, the arbitrator may not consolidate more than one person's claims and may not otherwise preside over any form of a representative or class proceeding.",
    ],
  },
  {
    title: "Liability Disclaimer",
    body: [
      "THE INFORMATION, SOFTWARE, PRODUCTS, AND SERVICES INCLUDED IN OR AVAILABLE THROUGH THE SITE MAY INCLUDE INACCURACIES OR TYPOGRAPHICAL ERRORS. CHANGES ARE PERIODICALLY ADDED TO THE INFORMATION HEREIN. SAG ADVISORS LLC DBA CREDIT BANC AND/OR ITS SUPPLIERS MAY MAKE IMPROVEMENTS AND/OR CHANGES IN THE SITE AT ANY TIME.",
      "SAG ADVISORS LLC DBA CREDIT BANC AND/OR ITS SUPPLIERS MAKE NO REPRESENTATIONS ABOUT THE SUITABILITY, RELIABILITY, AVAILABILITY, TIMELINESS, AND ACCURACY OF INFORMATION, SOFTWARE, PRODUCTS, SERVICES AND RELATED GRAPHICS CONTAINED ON THE SITE FOR ANY PURPOSE. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ALL SUCH INFORMATION, SOFTWARE, PRODUCTS, SERVICES AND RELATED GRAPHICS ARE PROVIDED \"AS IS\" WITHOUT WARRANTY OR CONDITION OF ANY KIND. SAG ADVISORS LLC DBA CREDIT BANC AND/OR ITS SUPPLIERS HEREBY DISCLAIM ALL WARRANTIES AND CONDITIONS WITH REGARD TO THIS INFORMATION, SOFTWARE, PRODUCTS, SERVICES AND RELATED GRAPHICS, INCLUDING ALL IMPLIED WARRANTIES OR CONDITIONS OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.",
      "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL SAG ADVISORS LLC DBA CREDIT BANC AND/OR ITS SUPPLIERS BE LIABLE FOR ANY DIRECT, INDIRECT, PUNITIVE, INCIDENTAL, SPECIAL, CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER INCLUDING, WITHOUT LIMITATION, DAMAGES FOR LOSS OF USE, DATA OR PROFITS, ARISING OUT OF OR IN ANY WAY CONNECTED WITH THE USE OR PERFORMANCE OF THE SITE, WITH THE DELAY OR INABILITY TO USE THE SITE OR RELATED SERVICES, THE PROVISION OF OR FAILURE TO PROVIDE SERVICES, OR FOR ANY INFORMATION, SOFTWARE, PRODUCTS, SERVICES AND RELATED GRAPHICS OBTAINED THROUGH THE SITE, OR OTHERWISE ARISING OUT OF THE USE OF THE SITE, WHETHER BASED ON CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY OR OTHERWISE, EVEN IF SAG ADVISORS LLC DBA CREDIT BANC OR ANY OF ITS SUPPLIERS HAS BEEN ADVISED OF THE POSSIBILITY OF DAMAGES. BECAUSE SOME STATES/JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF LIABILITY FOR CONSEQUENTIAL OR INCIDENTAL DAMAGES, THE ABOVE LIMITATION MAY NOT APPLY TO YOU. IF YOU ARE DISSATISFIED WITH ANY PORTION OF THE SITE, OR WITH ANY OF THESE TERMS OF USE, YOUR SOLE AND EXCLUSIVE REMEDY IS TO DISCONTINUE USING THE SITE.",
    ],
  },
  {
    title: "Termination/Access Restriction",
    body: [
      "SAG Advisors LLC dba Credit Banc reserves the right, in its sole discretion, to terminate your access to the Site and the related services or any portion thereof at any time, without notice. To the maximum extent permitted by law, this agreement is governed by the laws of the State of Florida, and you hereby consent to the exclusive jurisdiction and venue of courts in Florida in all disputes arising out of or relating to the use of the Site. Use of the Site is unauthorized in any jurisdiction that does not give effect to all provisions of these Terms, including, without limitation, this section.",
      "You agree that no joint venture, partnership, employment, or agency relationship exists between you and SAG Advisors LLC dba Credit Banc as a result of this agreement or use of the Site. SAG Advisors LLC dba Credit Banc's performance of this agreement is subject to existing laws and legal process, and nothing contained in this agreement is in derogation of SAG Advisors LLC dba Credit Banc's right to comply with governmental, court and law enforcement requests or requirements relating to your use of the Site or information provided to or gathered by SAG Advisors LLC dba Credit Banc with respect to such use. If any part of this agreement is determined to be invalid or unenforceable pursuant to applicable law including, but not limited to, the warranty disclaimers and liability limitations set forth above, then the invalid or unenforceable provision will be deemed superseded by a valid, enforceable provision that most closely matches the intent of the original provision and the remainder of the agreement shall continue in effect.",
      "Unless otherwise specified herein, this agreement constitutes the entire agreement between the user and SAG Advisors LLC dba Credit Banc with respect to the Site and it supersedes all prior or contemporaneous communications and proposals, whether electronic, oral or written, between the user and SAG Advisors LLC dba Credit Banc with respect to the Site. A printed version of this agreement and of any notice given in electronic form shall be admissible in judicial or administrative proceedings based upon or relating to this agreement to the same extent and subject to the same conditions as other business documents and records originally generated and maintained in printed form. It is the express wish to the parties that this agreement and all related documents be written in English.",
    ],
  },
  {
    title: "Changes to Terms",
    body: [
      "SAG Advisors LLC dba Credit Banc reserves the right, in its sole discretion, to change the Terms under which www.creditbanc.io is offered. The most current version of the Terms will supersede all previous versions. SAG Advisors LLC dba Credit Banc encourages you to periodically review the Terms to stay informed of our updates.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink selection:bg-cb-mint/20">
      <BrandHeader
        action={
          <Link
            href="/affiliate"
            className="text-sm font-semibold text-cb-gray hover:text-cb-ink transition-colors"
          >
            Back to <span className="text-cb-mint font-bold">the Club</span>
          </Link>
        }
      />

      <main className="max-w-4xl mx-auto px-4 py-16 md:py-24">
        <Eyebrow className="mb-4">Legal</Eyebrow>
        <h1 className="font-manrope text-4xl md:text-5xl font-extrabold tracking-tight leading-tight text-cb-ink">
          Terms and Conditions
        </h1>
        <p className="mt-4 text-cb-ink/50">Effective as of {EFFECTIVE_DATE}.</p>

        <div className="mt-14 space-y-12">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-manrope text-2xl font-extrabold tracking-tight text-cb-ink mb-4">
                {section.title}
              </h2>
              <div className="space-y-4">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-cb-ink/70">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}

          {/* contact — kept out of SECTIONS so the address can be marked up */}
          <section>
            <h2 className="font-manrope text-2xl font-extrabold tracking-tight text-cb-ink mb-4">
              Contact Us
            </h2>
            <p className="text-[15px] leading-relaxed text-cb-ink/70">
              SAG Advisors LLC dba Credit Banc welcomes your questions or comments regarding the
              Terms:
            </p>
            <address className="mt-5 not-italic text-[15px] leading-relaxed text-cb-ink/70 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
              <span className="block font-bold text-cb-ink">SAG Advisors LLC dba Credit Banc</span>
              <span className="block">27 The Plaza</span>
              <span className="block">Locust Valley, New York 11560</span>
              <span className="block mt-4">
                Email Address:{" "}
                <a
                  href="mailto:support@creditbanc.io"
                  className="font-bold text-cb-mint hover:underline"
                >
                  support@creditbanc.io
                </a>
              </span>
              <span className="block">
                Telephone number:{" "}
                <a href="tel:+19173415543" className="font-bold text-cb-mint hover:underline">
                  917-341-5543
                </a>
              </span>
            </address>
            <p className="mt-8 text-[15px] font-semibold text-cb-ink/50">
              Effective as of {EFFECTIVE_DATE}
            </p>
          </section>
        </div>
      </main>

      <BrandFooter />
    </div>
  );
}
