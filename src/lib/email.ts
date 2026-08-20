// src/lib/email.ts
import nodemailer from 'nodemailer';
import path from 'path';

/**
 * Interface for client welcome email data
 */
interface ClientWelcomeEmailData {
  client_name: string;
  client_email: string;
  client_password?: string; // Legacy: temp password. No longer surfaced — magic_link is used instead.
  magic_link?: string; // Passwordless login link; logs the client straight into onboarding.
  advisor_name: string;
  advisor_email: string;
  advisor_phone?: string;
  advisor_cc_email?: string; // Optional: CC the advisor on the client welcome email
  advisor_cc_emails?: string[]; // Optional: CC follower advisors so they stay in the loop
  requested_documents: string[];
  login_url: string;
}

/**
 * Interface for the "your password was updated" confirmation sent to the client
 * after they create their password in onboarding Step 3.
 */
export interface PasswordUpdatedNotificationData {
  client_name: string;
  client_email: string;
  login_url: string;
}

/**
 * Interface for advisor welcome email data
 */
export interface AdvisorWelcomeEmailData {
  advisor_name: string;
  advisor_email: string;
  advisor_password?: string; // Optional - not sent in email for security
  login_url: string;
}

/**
 * Interface for underwriting welcome email data
 */
export interface UnderwritingWelcomeEmailData {
  underwriter_name: string;
  underwriter_email: string;
  login_url: string;
}

/**
 * Interface for advisor document notification data
 */
export interface AdvisorDocumentNotificationData {
  advisor_name: string;
  advisor_email: string;
  advisor_cc_emails?: string[]; // CC follower advisors
  client_name: string;
  missing_documents?: string[];    // Required items the client still owes
  additional_documents?: string[]; // Extra documents underwriting is requesting
  login_url: string;
  custom_message?: string; // Internal note from underwriting to include in the email
}

/**
 * Interface for advisor vault submission notification data
 */
export interface AdvisorVaultSubmissionData {
  advisor_name: string;
  advisor_email: string;
  advisor_cc_emails?: string[]; // CC follower advisors
  client_name: string;
  company_name: string;
  submission_date: string;
  login_url: string;
}

/**
 * Interface for advisor new document upload notification data
 */
export interface NewDocumentUploadedData {
  advisor_name: string;
  advisor_email: string;
  advisor_cc_emails?: string[]; // CC follower advisors
  client_name: string;
  document_name: string;
  document_category: string;
  upload_date: string;
  login_url: string;
}

/**
 * Interface for underwriting vault ready notification data
 */
export interface UnderwritingVaultReadyData {
  underwriter_email: string;
  client_name: string;
  company_name: string;
  advisor_name: string;
  capital_requested: number;
  client_profile_url: string;
}

/**
 * Interface for "admin approved lenders for submission" notification data
 */
export interface LenderReviewApprovedNotificationData {
  underwriter_email: string;
  client_name: string;
  company_name: string;
  admin_name: string;
  /** List of lender names the admin just cleared for outreach. */
  approved_lenders: string[];
  /** Optional per-lender notes (visible to UW). */
  notes_by_lender?: Record<string, string | null>;
  client_profile_url: string;
}

/**
 * Interface for client vault submitted notification data
 */
export interface ClientVaultSubmittedData {
  client_name: string;
  client_email: string;
  advisor_name: string;
  advisor_cc_emails?: string[]; // CC primary advisor + follower advisors
  company_name: string;
  login_url: string;
}

/**
 * Creates Nodemailer transporter with SMTP credentials
 * Uses Mailgun SMTP through LeadConnector
 *
 * CLICK TRACKING IS OFF, deliberately, for every message we send.
 *
 * With tracking on, Mailgun rewrites every href in the HTML to
 * http://email.creditbanc.net/c/<opaque> and 302s from there. That domain is
 * Mailgun's tracking CNAME for creditbanc.net, and it is not answering — so
 * every link in every email times out. That's how this was found: a staff
 * invitation link that went to "email.creditbanc.net took too long to respond"
 * instead of the vault.
 *
 * Turning it off rather than fixing the DNS, because the links we send are
 * CREDENTIALS — magic links, password resets, staff invitations, lender share
 * links. Routing a single-use token through a third-party redirector puts it in
 * that service's click logs and makes delivery of a login depend on an
 * analytics subdomain being healthy. Neither is a trade worth making for
 * click-through stats on transactional mail.
 *
 * (If per-campaign click tracking is ever wanted, set up the CNAME first and
 * override X-Mailgun-Track-Clicks on that specific send — not here.)
 */
function create_smtp_transporter() {
  return nodemailer.createTransport(
    {
      host: process.env.SMTP_HOST || 'smtp.mailgun.org',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    {
      // Transport-level defaults, merged into every sendMail() call. No call
      // site passes `headers`, so nothing overrides this today — if one ever
      // does, it must re-include these or its links get rewritten again.
      headers: {
        'X-Mailgun-Track-Clicks': 'no',
        // The open pixel loads from the same dead subdomain. A broken pixel is
        // invisible rather than blocking, but it's the same wager: a tracker
        // that can't load in exchange for nothing.
        'X-Mailgun-Track-Opens': 'no',
      },
    }
  );
}

/**
 * Builds a deduped CC list from any combination of single emails and arrays.
 * Filters out falsy entries and anything that is not a plausible address.
 */
function build_cc_list(...inputs: (string | string[] | null | undefined)[]): string[] {
  const flat: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      for (const entry of input) {
        if (typeof entry === 'string' && entry.includes('@')) flat.push(entry);
      }
    } else if (typeof input === 'string' && input.includes('@')) {
      flat.push(input);
    }
  }
  return Array.from(new Set(flat.map(e => e.trim().toLowerCase()))).filter(Boolean);
}

/**
 * Generates HTML for client welcome email
 * Beautiful, responsive email template with all necessary information
 */
export function generate_client_welcome_email_html(data: ClientWelcomeEmailData): string {
  data = escape_email_strings(data);
  const {
    client_name,
    advisor_name,
    advisor_email,
    advisor_phone,
    requested_documents,
    magic_link,
    login_url,
  } = data;

  // The magic link is the primary entry point; fall back to the login page if,
  // for any reason, link generation failed upstream.
  const access_url = magic_link || login_url;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Credit Banc Vault</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header Section -->
          <tr>
            <td style="background-color: #10b981; padding: 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 48px; width: auto; display: block; margin: 0 auto;">
            </td>
          </tr>
          <tr>
            <td style="padding: 0; text-align: center; line-height: 0;">
              <img src="cid:vault_email_header" alt="Welcome to the Credit Banc Vault" style="width: 100%; max-width: 600px; height: auto; display: block;">
            </td>
          </tr>

          <!-- Welcome Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 24px; font-weight: 600;">Welcome to Credit Banc Vault! 🎉</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Hi <strong>${client_name}</strong>,
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Great news! Your advisor <strong>${advisor_name}</strong> has created your Credit Banc Vault account. 
                You now have access to our secure funding portal where you can track your application, upload documents, 
                and communicate with your dedicated advisor.
              </p>
            </td>
          </tr>

          <!-- Magic Link Access Box -->
          <tr>
            <td style="padding: 0 40px 20px;">
              <table role="presentation" style="width: 100%; background-color: #10b981; border-radius: 12px; padding: 24px;">
                <tr>
                  <td style="text-align: center;">
                    <h3 style="margin: 0 0 12px; color: #ffffff; font-size: 20px; font-weight: 600;">🔐 Access Your Account</h3>
                    <p style="margin: 0 0 20px; color: #ffffff; font-size: 15px; line-height: 1.6;">
                      No password needed — just tap the secure button below to log in. During setup you'll create your own password.
                    </p>
                    <a href="${access_url}" style="display: inline-block; background-color: #ffffff; color: #047857; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 700;">
                      Access Your Account
                    </a>
                    <p style="margin: 16px 0 0; color: #d1fae5; font-size: 13px; line-height: 1.5;">
                      This secure link is personal to you. For your security, it expires after a short time — if it stops working, we'll send you a fresh one.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${requested_documents.length > 0 ? `
          <!-- Documents Section -->
          <tr>
            <td style="padding: 20px 40px;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <h3 style="margin: 20px 0 12px; color: #1e293b; font-size: 20px; font-weight: 600;">📄 Documents Needed</h3>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                To proceed with your funding application, please upload the following documents:
              </p>
              <ul style="margin: 0 0 16px; padding-left: 20px; color: #475569; font-size: 16px; line-height: 1.8;">
                ${requested_documents.map(doc => `<li style="margin-bottom: 8px;">${doc}</li>`).join('')}
              </ul>
              <p style="margin: 0; color: #475569; font-size: 16px; line-height: 1.6;">
                You can upload these documents securely through your portal after logging in.
              </p>
            </td>
          </tr>
          ` : ''}

          <!-- Next Steps -->
          <tr>
            <td style="padding: 20px 40px;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <h3 style="margin: 20px 0 12px; color: #1e293b; font-size: 20px; font-weight: 600;">✅ Next Steps</h3>
              <ol style="margin: 0; padding-left: 20px; color: #475569; font-size: 16px; line-height: 1.8;">
                <li style="margin-bottom: 12px;"><strong>Access your account</strong> using the secure link above</li>
                <li style="margin-bottom: 12px;"><strong>Complete your business profile</strong></li>
                <li style="margin-bottom: 12px;"><strong>Review &amp; sign</strong> your funding application</li>
                <li style="margin-bottom: 12px;"><strong>Create your password</strong> to finish setup and secure your account</li>
                <li style="margin-bottom: 12px;"><strong>Track your progress</strong> in real-time through your dashboard</li>
              </ol>
            </td>
          </tr>

          <!-- Advisor Contact -->
          <tr>
            <td style="padding: 20px 40px;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <div style="background-color: #f1f5f9; border-radius: 12px; padding: 24px;">
                <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 20px; font-weight: 600;">👤 Your Dedicated Advisor</h3>
                <p style="margin: 0 0 12px; color: #475569; font-size: 16px; line-height: 1.6;">
                  <strong>${advisor_name}</strong> is here to help you throughout the funding process.
                </p>
                <p style="margin: 0; color: #475569; font-size: 16px; line-height: 1.8;">
                  📧 Email: <a href="mailto:${advisor_email}" style="color: #10b981; text-decoration: none;">${advisor_email}</a>
                  ${advisor_phone ? `<br>📞 Phone: <a href="tel:${advisor_phone}" style="color: #10b981; text-decoration: none;">${advisor_phone}</a>` : ''}
                </p>
                <p style="margin: 12px 0 0; color: #475569; font-size: 16px; line-height: 1.6;">
                  Don't hesitate to reach out if you have any questions!
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px;">
              <p style="margin: 0 0 8px;">© ${new Date().getFullYear()} Credit Banc. All rights reserved.</p>
              <p style="margin: 0;">
                <a href="https://creditbanc.io/privacy" style="color: #64748b; text-decoration: underline;">Privacy Policy</a>
                ·
                <a href="https://creditbanc.io/terms" style="color: #64748b; text-decoration: underline;">Terms of Service</a>
                ·
                <a href="https://creditbanc.io/support" style="color: #64748b; text-decoration: underline;">Support</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Generates plain text version of welcome email
 * Fallback for email clients that don't support HTML
 */
export function generate_client_welcome_email_text(data: ClientWelcomeEmailData): string {
  const {
    client_name,
    advisor_name,
    advisor_email,
    advisor_phone,
    requested_documents,
    magic_link,
    login_url,
  } = data;

  const access_url = magic_link || login_url;

  return `
Welcome to Credit Banc Vault!

Hi ${client_name},

Your advisor ${advisor_name} has created your Credit Banc Vault account.

Access Your Account (no password needed):
${access_url}

This secure link logs you straight in. During setup you'll create your own
password. The link is personal to you and expires after a short time — if it
stops working, we'll send you a fresh one.

${requested_documents.length > 0 ? `
Documents Needed:
${requested_documents.map(doc => `- ${doc}`).join('\n')}

You can upload these documents securely through your portal after logging in.
` : ''}

Next Steps:
1. Access your account using the secure link above
2. Complete your business profile
3. Review & sign your funding application
4. Create your password to finish setup
5. Track your progress

Your Dedicated Advisor: ${advisor_name}
Email: ${advisor_email}
${advisor_phone ? `Phone: ${advisor_phone}` : ''}

Don't hesitate to reach out if you have any questions!

© ${new Date().getFullYear()} Credit Banc. All rights reserved.
  `.trim();
}

/**
 * Sends welcome email to newly created client using SMTP
 * Works with Mailgun SMTP through LeadConnector/GHL
 * 
 * @param data - Client and advisor information
 * @returns Nodemailer send result
 */
export async function send_client_welcome_email(data: ClientWelcomeEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  const html_content = generate_client_welcome_email_html(data);
  const text_content = generate_client_welcome_email_text(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: 'Welcome to Credit Banc Vault - Your Account is Ready!',
    text: text_content,
    html: html_content,
    attachments: [
      {
        filename: 'CBLOGOWHITE.png',
        path: path.join(process.cwd(), 'public', 'CBLOGOWHITE.png'),
        cid: 'cb_logo_white'
      },
      {
        filename: 'vaultemailheader.png',
        path: path.join(process.cwd(), 'public', 'vaultemailheader.png'),
        cid: 'vault_email_header'
      }
    ]
  };

  // CC the primary advisor and any follower advisors so they all see the credentials
  const cc_list = build_cc_list(data.advisor_cc_email, data.advisor_cc_emails);
  if (cc_list.length > 0) {
    mail_options.cc = cc_list;
  }

  const result = await transporter.sendMail(mail_options);

  return result;
}

/**
 * ============================================================================
 * SPEED-FORM DOCUMENT REQUEST EMAIL
 * ============================================================================
 * Sent the moment a speed-form client signs their pre-filled funding
 * application (SignWell webhook). Unlike the welcome email, this is a complete
 * document request: it names the proposed loan type and funding amount so the
 * client understands exactly what the documents are for.
 */

export interface SpeedDocRequestEmailData {
  client_name: string;
  client_email: string;
  company_name: string;
  proposed_loan_type: string;
  capital_requested: number;
  requested_documents: string[]; // human labels
  magic_link?: string;           // doc-upload magic link (falls back to login_url)
  login_url: string;
  advisor_name: string;
  advisor_email: string;
  advisor_phone?: string;
  advisor_cc_email?: string;
  advisor_cc_emails?: string[];
}

function format_usd(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function generate_speed_doc_request_email_html(data: SpeedDocRequestEmailData): string {
  data = escape_email_strings(data);
  const {
    client_name,
    company_name,
    proposed_loan_type,
    capital_requested,
    requested_documents,
    magic_link,
    login_url,
    advisor_name,
    advisor_email,
    advisor_phone,
  } = data;

  const access_url = magic_link || login_url;
  const amount = format_usd(capital_requested);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documents Needed for Your Funding Request</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header Section -->
          <tr>
            <td style="background-color: #10b981; padding: 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 48px; width: auto; display: block; margin: 0 auto;">
            </td>
          </tr>
          <tr>
            <td style="background-color: #10b981; padding: 0 40px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.2;">Application signed let's get you funded!</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 8px;">
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Hi <strong>${client_name}</strong>,
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Thank you for signing your funding application for <strong>${company_name}</strong>.
                To move your request to underwriting, we now need a few documents from you.
              </p>
            </td>
          </tr>

          <!-- Funding Summary -->
          <tr>
            <td style="padding: 12px 40px;">
              <table role="presentation" style="width: 100%; background-color: #f0fdf4; border: 1px solid #dcfce7; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <h3 style="margin: 0 0 12px; color: #166534; font-size: 16px; font-weight: 700;">📌 Your Funding Request</h3>
                    ${proposed_loan_type ? `<p style="margin: 0 0 8px; color: #166534; font-size: 15px;"><strong>Proposed Loan Type:</strong> ${proposed_loan_type}</p>` : ''}
                    ${amount ? `<p style="margin: 0; color: #166534; font-size: 15px;"><strong>Funding Amount Requested:</strong> ${amount}</p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Documents Section -->
          <tr>
            <td style="padding: 20px 40px 8px;">
              <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 20px; font-weight: 600;">📄 Documents Needed</h3>
              <ul style="margin: 0 0 8px; padding-left: 20px; color: #475569; font-size: 16px; line-height: 1.8;">
                ${requested_documents.map(doc => `<li style="margin-bottom: 8px;">${doc}</li>`).join('')}
              </ul>
            </td>
          </tr>

          <!-- Upload CTA -->
          <tr>
            <td style="padding: 16px 40px 8px;">
              <table role="presentation" style="width: 100%; background-color: #10b981; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <p style="margin: 0 0 20px; color: #ffffff; font-size: 15px; line-height: 1.6;">
                      Upload your documents securely through your portal — no password needed, just tap the button below.
                    </p>
                    <a href="${access_url}" style="display: inline-block; background-color: #ffffff; color: #047857; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 700;">
                      Upload Documents
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Advisor Contact -->
          <tr>
            <td style="padding: 20px 40px;">
              <div style="background-color: #f1f5f9; border-radius: 12px; padding: 24px;">
                <p style="margin: 0 0 12px; color: #475569; font-size: 16px; line-height: 1.6;">
                  Questions? Your advisor <strong>${advisor_name}</strong> is here to help.
                </p>
                <p style="margin: 0; color: #475569; font-size: 16px; line-height: 1.8;">
                  📧 <a href="mailto:${advisor_email}" style="color: #10b981; text-decoration: none;">${advisor_email}</a>
                  ${advisor_phone ? `<br>📞 <a href="tel:${advisor_phone}" style="color: #10b981; text-decoration: none;">${advisor_phone}</a>` : ''}
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export function generate_speed_doc_request_email_text(data: SpeedDocRequestEmailData): string {
  const {
    client_name,
    company_name,
    proposed_loan_type,
    capital_requested,
    requested_documents,
    magic_link,
    login_url,
    advisor_name,
    advisor_email,
    advisor_phone,
  } = data;

  const access_url = magic_link || login_url;
  const amount = format_usd(capital_requested);

  return `
Application signed — let's get you funded!

Hi ${client_name},

Thank you for signing your funding application for ${company_name}. To move
your request to underwriting, we now need a few documents from you.

Your Funding Request:
${proposed_loan_type ? `- Proposed Loan Type: ${proposed_loan_type}` : ''}
${amount ? `- Funding Amount Requested: ${amount}` : ''}

Documents Needed:
${requested_documents.map(doc => `- ${doc}`).join('\n')}

Upload your documents securely here (no password needed):
${access_url}

Questions? Your advisor ${advisor_name} is here to help.
Email: ${advisor_email}
${advisor_phone ? `Phone: ${advisor_phone}` : ''}

© ${new Date().getFullYear()} Credit Banc. All rights reserved.
  `.trim();
}

/**
 * Sends the speed-form document request email (client TO, advisor + followers CC).
 */
export async function send_speed_doc_request_email(data: SpeedDocRequestEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: `Documents Needed for Your ${format_usd(data.capital_requested) || 'Funding'} Request`,
    text: generate_speed_doc_request_email_text(data),
    html: generate_speed_doc_request_email_html(data),
    attachments: [
      {
        filename: 'CBLOGOWHITE.png',
        path: path.join(process.cwd(), 'public', 'CBLOGOWHITE.png'),
        cid: 'cb_logo_white'
      }
    ]
  };

  const cc_list = build_cc_list(data.advisor_cc_email, data.advisor_cc_emails);
  if (cc_list.length > 0) {
    mail_options.cc = cc_list;
  }

  return transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * PASSWORD UPDATED CONFIRMATION (client)
 * ============================================================================
 * Sent after the client creates their password in onboarding Step 3.
 * Client-only (no advisor CC). The matching SMS is fired by GHL via the
 * `password-updated` tag added in /api/onboarding/notify-password-set.
 */

export function generate_password_updated_email_html(data: PasswordUpdatedNotificationData): string {
  data = escape_email_strings(data);
  const { client_name, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your password was updated</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background-color: #10b981; padding: 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 48px; width: auto; display: block; margin: 0 auto;">
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 24px; font-weight: 600;">Your password was updated ✅</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Hi <strong>${client_name}</strong>,
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                This is a confirmation that the password for your Credit Banc Vault account was just changed.
                You can now log in any time with your email and new password.
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <a href="${login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                  Go to Your Dashboard
                </a>
              </div>
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 12px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">
                  ⚠️ <strong>Didn't do this?</strong> If you didn't change your password, contact our support team right away at
                  <a href="mailto:support@creditbanc.io" style="color: #92400e;">support@creditbanc.io</a>.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px;">
              <p style="margin: 0 0 8px;">© ${new Date().getFullYear()} Credit Banc. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export function generate_password_updated_email_text(data: PasswordUpdatedNotificationData): string {
  const { client_name, login_url } = data;

  return `
Your password was updated

Hi ${client_name},

This is a confirmation that the password for your Credit Banc Vault account was
just changed. You can now log in any time with your email and new password.

Log in here: ${login_url}

Didn't do this? If you didn't change your password, contact our support team
right away at support@creditbanc.io.

© ${new Date().getFullYear()} Credit Banc. All rights reserved.
  `.trim();
}

/**
 * Sends the "your password was updated" confirmation to the client (no CC).
 */
export async function send_password_updated_notification(data: PasswordUpdatedNotificationData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: 'Your Credit Banc Vault password was updated',
    text: generate_password_updated_email_text(data),
    html: generate_password_updated_email_html(data),
    attachments: [
      {
        filename: 'CBLOGOWHITE.png',
        path: path.join(process.cwd(), 'public', 'CBLOGOWHITE.png'),
        cid: 'cb_logo_white'
      }
    ]
  };

  return transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * ADVISOR WELCOME EMAIL FUNCTIONS
 * ============================================================================
 */

/**
 * Generates HTML for advisor welcome email
 * Simple welcome message without password for security
 */
export function generate_advisor_welcome_email_html(data: AdvisorWelcomeEmailData): string {
  data = escape_email_strings(data);
  const {
    advisor_name,
    advisor_email,
    login_url,
  } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Credit Banc Vault</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Logo Section -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #10b981;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Credit Banc Vault</h1>
            </td>
          </tr>

          <!-- Welcome Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 24px; font-weight: 600;">Welcome to Credit Banc Vault! 🎉</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Hi <strong>${advisor_name}</strong>,
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Your advisor account has been successfully created! You now have access to the Credit Banc Vault platform 
                where you can manage client applications, track funding progress, and streamline your workflow.
              </p>
            </td>
          </tr>


          <!-- Welcome Info Box -->
          <tr>
            <td style="padding: 0 40px 20px;">
              <table role="presentation" style="width: 100%; background-color: #10b981; border-radius: 12px; padding: 24px;">
                <tr>
                  <td>
                    <h3 style="margin: 0 0 20px; color: #ffffff; font-size: 20px; font-weight: 600;">🚀 Get Started</h3>
                    
                    <p style="margin: 0 0 16px; color: #ffffff; font-size: 16px; line-height: 1.6;">
                      Your advisor account is ready! Use the email address you signed up with and the password you created to log in.
                    </p>

                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: #ffffff; font-size: 14px; font-weight: 600;">Login Email:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: #0ea271; padding: 12px; border-radius: 6px;">${advisor_email}</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Login Button -->
          <tr>
            <td style="padding: 20px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Log In to Your Account
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px;">
              <p style="margin: 0 0 8px;">© ${new Date().getFullYear()} Credit Banc. All rights reserved.</p>
              <p style="margin: 0;">
                <a href="https://creditbanc.io/privacy" style="color: #64748b; text-decoration: underline;">Privacy Policy</a>
                ·
                <a href="https://creditbanc.io/terms" style="color: #64748b; text-decoration: underline;">Terms of Service</a>
                ·
                <a href="https://creditbanc.io/support" style="color: #64748b; text-decoration: underline;">Support</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Generates plain text version of advisor welcome email
 * Fallback for email clients that don't support HTML
 */
export function generate_advisor_welcome_email_text(data: AdvisorWelcomeEmailData): string {
  const {
    advisor_name,
    advisor_email,
    login_url,
  } = data;

  return `
Welcome to Credit Banc Vault!

Hi ${advisor_name},

Your advisor account has been successfully created! You now have access to the Credit Banc Vault platform.

Get Started:
Use the email address you signed up with and the password you created to log in.

Login Email: ${advisor_email}

Login here: ${login_url}

© ${new Date().getFullYear()} Credit Banc. All rights reserved.
  `.trim();
}

/**
 * Sends welcome email to newly created advisor using SMTP
 * 
 * @param data - Advisor information
 * @returns Nodemailer send result
 */
export async function send_advisor_welcome_email(data: AdvisorWelcomeEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  const html_content = generate_advisor_welcome_email_html(data);
  const text_content = generate_advisor_welcome_email_text(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: 'Welcome to Credit Banc Vault - Advisor Account Created!',
    text: text_content,
    html: html_content,
  };

  const result = await transporter.sendMail(mail_options);

  return result;
}

/**
 * ============================================================================
 * PASSWORD RESET EMAIL FUNCTIONS
 * ============================================================================
 */

/**
 * Interface for password reset email data
 */
export interface PasswordResetEmailData {
  email: string;
  reset_link: string;
}

/**
 * Generates HTML for password reset email
 */
export function generate_password_reset_email_html(data: PasswordResetEmailData): string {
  data = escape_email_strings(data);
  const { email, reset_link } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Logo Section -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #10b981;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Credit Banc Vault</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 24px; font-weight: 600;">Reset Your Password 🔒</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Hello,
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                We received a request to reset the password for your Credit Banc Vault account associated with <strong>${email}</strong>.
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Click the button below to reset your password. This link will expire in 24 hours.
              </p>
            </td>
          </tr>

          <!-- Reset Button -->
          <tr>
            <td style="padding: 20px 40px;" align="center">
              <a href="${reset_link}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Reset Password
              </a>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="margin: 0; color: #64748b; font-size: 14px; line-height: 1.6; text-align: center;">
                If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px;">
              <p style="margin: 0 0 8px;">© ${new Date().getFullYear()} Credit Banc. All rights reserved.</p>
              <p style="margin: 0;">
                <a href="https://creditbanc.io/privacy" style="color: #64748b; text-decoration: underline;">Privacy Policy</a>
                ·
                <a href="https://creditbanc.io/terms" style="color: #64748b; text-decoration: underline;">Terms of Service</a>
                ·
                <a href="https://creditbanc.io/support" style="color: #64748b; text-decoration: underline;">Support</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Generates plain text version of password reset email
 */
export function generate_password_reset_email_text(data: PasswordResetEmailData): string {
  const { email, reset_link } = data;

  return `
Reset Your Password

Hello,

We received a request to reset the password for your Credit Banc Vault account associated with ${email}.

Click the link below to reset your password:
${reset_link}

If you didn't request a password reset, you can safely ignore this email.

© ${new Date().getFullYear()} Credit Banc. All rights reserved.
  `.trim();
}

/**
 * Sends password reset email
 */
export async function send_password_reset_email(data: PasswordResetEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  const html_content = generate_password_reset_email_html(data);
  const text_content = generate_password_reset_email_text(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.email,
    subject: 'Reset Your Credit Banc Vault Password',
    text: text_content,
    html: html_content,
  };

  const result = await transporter.sendMail(mail_options);

  return result;
}

/**
 * ============================================================================
 * UNDERWRITING WELCOME EMAIL FUNCTIONS
 * ============================================================================
 */

/**
 * Generates HTML for underwriting welcome email
 */
export function generate_underwriting_welcome_email_html(data: UnderwritingWelcomeEmailData): string {
  data = escape_email_strings(data);
  const { underwriter_name, underwriter_email, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Credit Banc Underwriting Team</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Logo Section -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #0f172a 0%, #334155 100%);">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Credit Banc Vault</h1>
              <p style="margin: 5px 0 0; color: #94a3b8; font-size: 14px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.1em;">Underwriting Portal</p>
            </td>
          </tr>

          <!-- Welcome Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 24px; font-weight: 600;">Welcome to the Team, ${underwriter_name}! 📋</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Your underwriting account has been successfully created. You now have access to the Credit Banc Vault 
                underwriting dashboard where you can review client submissions and manage funding requests.
              </p>
            </td>
          </tr>

          <!-- Welcome Info Box -->
          <tr>
            <td style="padding: 0 40px 20px;">
              <table role="presentation" style="width: 100%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                <tr>
                  <td>
                    <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 18px; font-weight: 600;">🔑 Access Information</h3>
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: #64748b; font-size: 14px;">Login Email:</p>
                      <p style="margin: 0; color: #1e293b; font-size: 16px; font-weight: 700;">${underwriter_email}</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Login Button -->
          <tr>
            <td style="padding: 20px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #1e293b; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Access Underwriting Portal
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0 0 8px;">© ${new Date().getFullYear()} Credit Banc. Confidential Internal Use Only.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends welcome email to new underwriter
 */
export async function send_underwriting_welcome_email(data: UnderwritingWelcomeEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_underwriting_welcome_email_html(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.underwriter_email,
    subject: 'Welcome to Credit Banc Vault - Underwriting Team Access',
    html: html_content,
  };

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * ADVISOR NOTIFICATION FUNCTIONS
 * ============================================================================
 */

/**
 * Generates HTML for advisor document notification email
 */
export function generate_advisor_document_notification_html(data: AdvisorDocumentNotificationData): string {
  data = escape_email_strings(data);
  const { advisor_name, client_name, missing_documents = [], additional_documents = [], login_url, custom_message } = data;

  const doc_list_html = (
    heading: string,
    docs: string[],
    theme: { bg: string; border: string; heading: string; text: string }
  ) => docs.length === 0 ? '' : `
              <div style="background-color: ${theme.bg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
                <h3 style="margin: 0 0 12px; color: ${theme.heading}; font-size: 16px; font-weight: 700;">${heading}</h3>
                <ul style="margin: 0; padding-left: 20px; color: ${theme.text}; font-size: 15px; line-height: 1.6;">
                  ${docs.map(doc => `<li style="margin-bottom: 8px;">${doc}</li>`).join('')}
                </ul>
              </div>`;

  // Missing required items are urgent (red); additional requests are informational (amber)
  const missing_theme = { bg: '#fef2f2', border: '#fee2e2', heading: '#991b1b', text: '#b91c1c' };
  const additional_theme = { bg: '#fffbeb', border: '#fef3c7', heading: '#92400e', text: '#b45309' };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Required: New Documents Needed</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #ef4444;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Action Required</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${advisor_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Our underwriting team has reviewed the file for <strong>${client_name}</strong> and requires additional documentation to proceed.
              </p>
              ${doc_list_html('Missing Required Items:', missing_documents, missing_theme)}
              ${doc_list_html('Additional Documents Requested:', additional_documents, additional_theme)}
              ${custom_message ? `
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #ef4444; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 16px; font-weight: 700;">Note from Underwriting:</h3>
                <p style="margin: 0; color: #475569; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${custom_message}</p>
              </div>
              ` : ''}
              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Please contact the client and request these documents through your advisor portal.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Go to Advisor Portal
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends notification email to advisor about missing documents
 */
export async function send_advisor_document_notification(data: AdvisorDocumentNotificationData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_advisor_document_notification_html(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `Action Required: New Documents Needed for ${data.client_name}`,
    html: html_content,
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  return await transporter.sendMail(mail_options);
}

/**
 * Generates HTML for advisor new document notification
 */
export function generate_new_document_uploaded_email_html(data: NewDocumentUploadedData): string {
  data = escape_email_strings(data);
  const { advisor_name, client_name, document_name, document_category, upload_date, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Document Uploaded: ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header Section -->
          <tr>
            <td style="background-color: #10b981; padding: 40px 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 44px; width: auto; display: block; margin: 0 auto; margin-bottom: 24px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; line-height: 1;">New Document Uploaded</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${advisor_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Great news! Your client <strong>${client_name}</strong> has just uploaded a new document to their vault.
              </p>
              
              <div style="background-color: #f0fdf4; border: 1px solid #dcfce7; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #166534; font-size: 14px;"><strong>Document Name:</strong> ${document_name}</p>
                <p style="margin: 0 0 8px; color: #166534; font-size: 14px;"><strong>Category:</strong> ${document_category}</p>
                <p style="margin: 0; color: #166534; font-size: 14px;"><strong>Upload Date:</strong> ${upload_date}</p>
              </div>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Please log in to your advisor portal to review the new documentation and keep the application moving forward.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Review in Portal
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends notification email to advisor about a new document upload
 */
export async function send_new_document_uploaded_notification(data: NewDocumentUploadedData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_new_document_uploaded_email_html(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `New Document Uploaded: ${data.client_name}`,
    html: html_content,
    attachments: [
      {
        filename: 'CBLOGOWHITE.png',
        path: path.join(process.cwd(), 'public', 'CBLOGOWHITE.png'),
        cid: 'cb_logo_white'
      }
    ]
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  return await transporter.sendMail(mail_options);
}

/**
 * Generates HTML for client vault submitted notification
 */
export function generate_client_vault_submitted_email_html(data: ClientVaultSubmittedData): string {
  data = escape_email_strings(data);
  const { client_name, advisor_name, company_name, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Submitted: ${company_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header Section -->
          <tr>
            <td style="background-color: #10b981; padding: 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 48px; width: auto; display: block; margin: 0 auto;">
            </td>
          </tr>
          <tr>
            <td style="background-color: #10b981; padding: 0 40px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">Good news! Your application is in review.</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${client_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Great news! Your advisor <strong>${advisor_name}</strong> has reviewed and approved your documents. 
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Your application for <strong>${company_name}</strong> has now been officially submitted to our underwriting department for final review.
              </p>
              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                We will notify you as soon as there is an update on your funding request. In the meantime, you can track the status of your application by logging into your portal.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Log In to Portal
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends notification email to client about their vault being submitted
 */
export async function send_client_vault_submitted_notification(data: ClientVaultSubmittedData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_client_vault_submitted_email_html(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: `Application Submitted to Underwriting - ${data.company_name}`,
    html: html_content,
    attachments: [
      {
        filename: 'CBLOGOWHITE.png',
        path: path.join(process.cwd(), 'public', 'CBLOGOWHITE.png'),
        cid: 'cb_logo_white'
      }
    ]
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * SUPPORT TICKET EMAIL FUNCTIONS
 * ============================================================================
 */

/**
 * Interface for support ticket email data
 */
export interface SupportTicketEmailData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/**
 * Generates HTML for support ticket email
 */
export function generate_support_ticket_email_html(data: SupportTicketEmailData): string {
  data = escape_email_strings(data);
  const { name, email, subject, message } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Support Ticket</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #10b981;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">New Support Ticket</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Support Request Details</h2>
              
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 12px; color: #475569; font-size: 16px;"><strong>From:</strong> ${name} (<a href="mailto:${email}" style="color: #10b981; text-decoration: none;">${email}</a>)</p>
                <p style="margin: 0 0 12px; color: #475569; font-size: 16px;"><strong>Subject:</strong> ${subject}</p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
                <p style="margin: 0; color: #1e293b; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${message}</p>
              </div>

              <p style="margin: 0; color: #64748b; font-size: 14px; text-align: center;">
                This message was sent from the Credit Banc Vault support form.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends support ticket email to the support team
 */
export async function send_support_ticket_email(data: SupportTicketEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault Support';
  const support_email = process.env.SUPPORT_EMAIL || 'support@creditbanc.io';

  const html_content = generate_support_ticket_email_html(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: support_email,
    replyTo: data.email,
    subject: `Support Ticket: ${data.subject}`,
    text: `New support ticket from ${data.name} (${data.email})\n\nSubject: ${data.subject}\n\nMessage:\n${data.message}`,
    html: html_content,
  };

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * VAULT SUBMISSION NOTIFICATION FUNCTIONS
 * ============================================================================
 */

/**
 * Generates HTML for advisor vault submission notification
 */
export function generate_advisor_vault_submission_html(data: AdvisorVaultSubmissionData): string {
  data = escape_email_strings(data);
  const { advisor_name, client_name, company_name, submission_date, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Vault Submission: ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #10b981;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">New Vault Submission</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${advisor_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Great news! Your client <strong>${client_name}</strong> (${company_name}) has just submitted their Credit Banc Vault for review.
              </p>
              
              <div style="background-color: #f0fdf4; border: 1px solid #dcfce7; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #166534; font-size: 14px;"><strong>Submission Date:</strong> ${submission_date}</p>
                <p style="margin: 0; color: #166534; font-size: 14px;"><strong>Client:</strong> ${client_name}</p>
                <p style="margin: 4px 0 0; color: #166534; font-size: 14px;"><strong>Company:</strong> ${company_name}</p>
              </div>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Please log in to your advisor portal to review the documents and complete the submission to underwriting.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Review Submission
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends notification email to advisor about vault submission
 */
export async function send_advisor_vault_submission_notification(data: AdvisorVaultSubmissionData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_advisor_vault_submission_html(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `New Vault Submission: ${data.client_name}`,
    html: html_content,
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  return await transporter.sendMail(mail_options);
}

/**
 * Generates HTML for underwriting vault ready notification
 */
export function generate_underwriting_vault_ready_html(data: UnderwritingVaultReadyData): string {
  data = escape_email_strings(data);
  const { client_name, company_name, advisor_name, capital_requested, client_profile_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vault Ready for Underwriting: ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #1e293b;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Vault Ready for Underwriting</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Action Required</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                The advisor <strong>${advisor_name}</strong> has reviewed and approved the vault for <strong>${client_name}</strong>. It is now ready for underwriting.
              </p>
              
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #334155; font-size: 14px;"><strong>Client:</strong> ${client_name}</p>
                <p style="margin: 0 0 8px; color: #334155; font-size: 14px;"><strong>Company:</strong> ${company_name}</p>
                <p style="margin: 0 0 8px; color: #334155; font-size: 14px;"><strong>Advisor:</strong> ${advisor_name}</p>
                <p style="margin: 0; color: #334155; font-size: 14px;"><strong>Capital Requested:</strong> ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(capital_requested)}</p>
              </div>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Click the button below to view the client profile on the underwriting dashboard.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${client_profile_url}" style="display: inline-block; background-color: #1e293b; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                View Client Profile
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. Confidential Internal Use Only.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends notification email to underwriting team
 */
export async function send_underwriting_vault_ready_notification(data: UnderwritingVaultReadyData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';
  const recipient_email = data.underwriter_email || process.env.UNDERWRITING_EMAIL || 'underwriting@creditbanc.io';

  const html_content = generate_underwriting_vault_ready_html(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: recipient_email,
    subject: `Vault Ready: ${data.client_name} - ${data.company_name}`,
    html: html_content,
  };

  console.log(`📧 Attempting to send underwriting email to: ${recipient_email}`);

  try {
    const result = await transporter.sendMail(mail_options);
    console.log(`✅ SMTP Result for ${data.client_name}:`, result.messageId);
    return result;
  } catch (error) {
    console.error(`❌ SMTP Error sending to ${recipient_email}:`, error);
    throw error;
  }
}

/**
 * HTML template for the "admin approved lenders" UW notification.
 */
export function generate_lender_review_approved_html(
  data: LenderReviewApprovedNotificationData
): string {
  data = escape_email_strings(data);
  const { client_name, company_name, admin_name, approved_lenders, notes_by_lender, client_profile_url } = data;

  const lender_rows = approved_lenders
    .map((name) => {
      const note = notes_by_lender?.[name];
      const note_html = note
        ? `<p style="margin: 4px 0 0; color: #64748b; font-size: 13px; font-style: italic;">Note: ${note}</p>`
        : '';
      return `
        <li style="margin: 0 0 10px; padding: 12px 16px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; list-style: none;">
          <p style="margin: 0; color: #065f46; font-size: 15px; font-weight: 600;">${name}</p>
          ${note_html}
        </li>`;
    })
    .join('');

  const count_label = `${approved_lenders.length} lender${approved_lenders.length === 1 ? '' : 's'}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lenders Approved for Outreach: ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #065f46;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Lenders Cleared for Submission</h1>
              <p style="margin: 8px 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500;">${count_label} ready to submit</p>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                <strong>${admin_name}</strong> has approved the following lender${approved_lenders.length === 1 ? '' : 's'} for outreach on <strong>${client_name}</strong> (${company_name}).
              </p>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #334155; font-size: 14px;"><strong>Client:</strong> ${client_name}</p>
                <p style="margin: 0; color: #334155; font-size: 14px;"><strong>Company:</strong> ${company_name}</p>
              </div>

              <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 15px; font-weight: 600;">Approved lenders</h3>
              <ul style="margin: 0 0 24px; padding: 0;">
                ${lender_rows}
              </ul>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Open the client file to start outreach and update each assignment's status as contact happens.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${client_profile_url}" style="display: inline-block; background-color: #065f46; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Open Client File
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. Confidential Internal Use Only.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends the "admin approved lenders" notification to a single underwriter.
 */
export async function send_lender_review_approved_notification(
  data: LenderReviewApprovedNotificationData
) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';
  const recipient_email =
    data.underwriter_email || process.env.UNDERWRITING_EMAIL || 'underwriting@creditbanc.io';

  const html_content = generate_lender_review_approved_html(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: recipient_email,
    subject: `Lenders cleared for submission: ${data.client_name} (${data.approved_lenders.length})`,
    html: html_content,
  };

  console.log(`📧 Attempting to send lender-review email to: ${recipient_email}`);

  try {
    const result = await transporter.sendMail(mail_options);
    console.log(`✅ SMTP Result for ${data.client_name} lender review:`, result.messageId);
    return result;
  } catch (error) {
    console.error(`❌ SMTP Error sending lender-review email to ${recipient_email}:`, error);
    throw error;
  }
}

/**
 * Interface for the "UW selected lenders" admin email.
 *
 * A RECORD OF THE RESULT. Admins commonly name the lender themselves and UW
 * selects and contacts it, so this is telling them what the match came out as —
 * not asking for anything. The copy states that and stops; wording that insists
 * no approval is needed keeps the idea of an approval in the reader's head.
 */
export interface LenderMatchReadyNotificationData {
  /** Every admin recipient. The email goes to all of them at once. */
  admin_emails: string[];
  client_name: string;
  company_name?: string;
  /** Selected lender display names (optionally "Name (specialty)"). */
  recommended_lenders: string[];
  /** Deep link to the admin client file (Lenders & Responses card). */
  client_profile_url: string;
}

/**
 * HTML for the "lender match result" admin notification.
 */
export function generate_lender_match_ready_html(data: LenderMatchReadyNotificationData): string {
  data = escape_email_strings(data);
  const { client_name, company_name, recommended_lenders, client_profile_url } = data;

  const count = recommended_lenders.length;
  const count_label = count === 0
    ? 'Selection cleared'
    : `${count} lender${count === 1 ? '' : 's'} selected`;

  const lender_rows = recommended_lenders
    .map((name) => `
        <li style="margin: 0 0 10px; padding: 12px 16px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; list-style: none;">
          <p style="margin: 0; color: #1e3a8a; font-size: 15px; font-weight: 600;">${name}</p>
        </li>`)
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lender Match Result: ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #1d4ed8;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Lender Match Result</h1>
              <p style="margin: 8px 0 0; color: #bfdbfe; font-size: 13px; font-weight: 500;">${count_label}</p>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                This is the lender match result for <strong>${client_name}</strong>${company_name ? ` (${company_name})` : ''}.
              </p>

              ${count > 0 ? `
              <h3 style="margin: 0 0 12px; color: #1e293b; font-size: 15px; font-weight: 600;">Selected</h3>
              <ul style="margin: 0 0 24px; padding: 0;">
                ${lender_rows}
              </ul>
              ` : `
              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Underwriting cleared the prior selections for this client.
              </p>
              `}

            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${client_profile_url}" style="display: inline-block; background-color: #1d4ed8; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Open Client File
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. Confidential Internal Use Only.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends the "lender match result" notification to all admins at once.
 * Mirrors send_lender_review_approved_notification: logs, rethrows on SMTP error
 * so the caller can record the failure instead of silently swallowing it.
 */
export async function send_lender_match_ready_notification(data: LenderMatchReadyNotificationData) {
  if (!data.admin_emails || data.admin_emails.length === 0) {
    console.warn('send_lender_match_ready_notification: no admin emails to send to');
    return null;
  }

  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';
  const to = data.admin_emails.join(', ');

  const html_content = generate_lender_match_ready_html(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to,
    subject: `Lender match result: ${data.client_name} (${data.recommended_lenders.length})`,
    html: html_content,
  };

  console.log(`📧 Attempting to send lender-match-ready email to: ${to}`);

  try {
    const result = await transporter.sendMail(mail_options);
    console.log(`✅ SMTP Result for ${data.client_name} lender-match-ready:`, result.messageId);
    return result;
  } catch (error) {
    console.error(`❌ SMTP Error sending lender-match-ready email to ${to}:`, error);
    throw error;
  }
}

/**
 * ============================================================================
 * LENDER PIPELINE EVENT NOTIFICATIONS (submitted / lender approved / declined)
 * ============================================================================
 *
 * One parametrized admin email covering the post-admin-review lifecycle of a
 * single lender assignment:
 *   • 'submitted'          — UW pushed the file out, awaiting the lender.
 *   • 'approved_by_lender' — the lender approved the submission.
 *   • 'declined_by_lender' — the lender declined the submission.
 * Sent to all admins so the admin portal's lender status stays in sync with
 * what UW records.
 */

export type LenderPipelineEvent = 'submitted' | 'approved_by_lender' | 'declined_by_lender';

export interface LenderPipelineNotificationData {
  /** Every admin recipient. The email goes to all of them at once. */
  admin_emails: string[];
  event: LenderPipelineEvent;
  client_name: string;
  company_name?: string;
  lender_name: string;
  specialty?: string | null;
  /** Deep link to the admin client file (Lender Match — Admin Review card). */
  client_profile_url: string;
}

const LENDER_PIPELINE_COPY: Record<
  LenderPipelineEvent,
  { header: string; accent: string; accent_soft: string; badge: string; subject: string; lead: (lender: string, client: string) => string }
> = {
  submitted: {
    header: 'File Submitted to Lender',
    accent: '#1d4ed8',
    accent_soft: '#bfdbfe',
    badge: 'Awaiting lender response',
    subject: 'submitted to lender',
    lead: (lender, client) =>
      `Underwriting has submitted <strong>${client}</strong>'s file to <strong>${lender}</strong>. The submission is now awaiting the lender's decision.`,
  },
  approved_by_lender: {
    header: 'Lender Approved the Submission',
    accent: '#065f46',
    accent_soft: '#a7f3d0',
    badge: 'Approved by lender',
    subject: 'approved by lender',
    lead: (lender, client) =>
      `<strong>${lender}</strong> has <strong>approved</strong> the submission for <strong>${client}</strong>.`,
  },
  declined_by_lender: {
    header: 'Lender Declined the Submission',
    accent: '#b91c1c',
    accent_soft: '#fecaca',
    badge: 'Declined by lender',
    subject: 'declined by lender',
    lead: (lender, client) =>
      `<strong>${lender}</strong> has <strong>declined</strong> the submission for <strong>${client}</strong>.`,
  },
};

export function generate_lender_pipeline_html(data: LenderPipelineNotificationData): string {
  data = escape_email_strings(data);
  const { event, client_name, company_name, lender_name, specialty, client_profile_url } = data;
  const copy = LENDER_PIPELINE_COPY[event];
  const lender_label = `${lender_name}${specialty ? ` (${specialty})` : ''}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.header}: ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: ${copy.accent};">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">${copy.header}</h1>
              <p style="margin: 8px 0 0; color: ${copy.accent_soft}; font-size: 13px; font-weight: 500;">${copy.badge}</p>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                ${copy.lead(lender_label, client_name)}
              </p>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #334155; font-size: 14px;"><strong>Client:</strong> ${client_name}</p>
                ${company_name ? `<p style="margin: 0 0 8px; color: #334155; font-size: 14px;"><strong>Company:</strong> ${company_name}</p>` : ''}
                <p style="margin: 0; color: #334155; font-size: 14px;"><strong>Lender:</strong> ${lender_label}</p>
              </div>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Open the client file and check the <strong>Lender Match — Admin Review</strong> card to see the latest lender status.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${client_profile_url}" style="display: inline-block; background-color: ${copy.accent}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Open Client File
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. Confidential Internal Use Only.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends a lender-pipeline event notification to all admins at once. Non-fatal
 * for the caller: logs and rethrows on SMTP error so the route can swallow it.
 */
export async function send_lender_pipeline_notification(data: LenderPipelineNotificationData) {
  if (!data.admin_emails || data.admin_emails.length === 0) {
    console.warn('send_lender_pipeline_notification: no admin emails to send to');
    return null;
  }

  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';
  const to = data.admin_emails.join(', ');

  const copy = LENDER_PIPELINE_COPY[data.event];
  const html_content = generate_lender_pipeline_html(data);

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to,
    subject: `${data.lender_name} ${copy.subject}: ${data.client_name}`,
    html: html_content,
  };

  console.log(`📧 Attempting to send lender-pipeline (${data.event}) email to: ${to}`);

  try {
    const result = await transporter.sendMail(mail_options);
    console.log(`✅ SMTP Result for ${data.client_name} lender-pipeline ${data.event}:`, result.messageId);
    return result;
  } catch (error) {
    console.error(`❌ SMTP Error sending lender-pipeline email to ${to}:`, error);
    throw error;
  }
}

/**
 * ============================================================================
 * LOAN FUNDED NOTIFICATION FUNCTIONS
 * ============================================================================
 */

export interface LoanFundedNotificationData {
  advisor_name: string;
  advisor_email: string;
  advisor_cc_emails?: string[]; // CC follower advisors
  client_name: string;
  total_amount: string;
  lender: string;
  funding_date: string;
  login_url: string;
}

export function generate_loan_funded_notification_html(data: LoanFundedNotificationData): string {
  data = escape_email_strings(data);
  const { advisor_name, client_name, total_amount, lender, funding_date, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Congratulations! Loan Funded for ${client_name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #10b981;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">🎉 Loan Funded!</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${advisor_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Great news! The loan for your client <strong>${client_name}</strong> has been successfully funded.
              </p>
              
              <div style="background-color: #f0fdf4; border: 1px solid #dcfce7; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #166534; font-size: 14px;"><strong>Funding Date:</strong> ${funding_date}</p>
                <p style="margin: 0 0 8px; color: #166534; font-size: 14px;"><strong>Lender:</strong> ${lender}</p>
                <p style="margin: 0; color: #166534; font-size: 14px;"><strong>Amount Funded:</strong> ${total_amount}</p>
              </div>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                You can review the full details and next steps in your advisor portal.
              </p>
            </td>
          </tr>

           <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Go to Advisor Portal
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export async function send_loan_funded_notification(data: LoanFundedNotificationData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_loan_funded_notification_html(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `🎉 Loan Funded for ${data.client_name}!`,
    html: html_content,
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * CLIENT FUNDED EMAIL
 * ============================================================================
 * The one funded email that goes to the CLIENT.
 *
 * `send_loan_funded_notification` above reads like the client's email and is
 * not — it is addressed to the advisor ("Congratulations {advisor_name}") and
 * CCs the follower advisors. Until this template existed, funding a deal
 * notified the advisor, tagged the GHL contact `Loan Funded`, stamped
 * FUNDING_DATE and wrote an internal note, and said nothing at all to the
 * person whose money it was.
 *
 * It carries NO figures — no amount, lender or term. That is deliberate: the
 * lender confirms the money and this is a thank-you with a review ask, so
 * restating the numbers only creates a second, staler record of them to be
 * contradicted later.
 *
 * It is signed by the client's own advisor, with their photo, because the whole
 * point of the send is that a person worked the file. Everything in the
 * signature comes off the `advisors` row the deal already carries.
 */
const CLIENT_FUNDED_HERO_CID = "client_funded_hero";
const CLIENT_FUNDED_HERO_FILE = "funded email.png";
/** cid for the advisor headshot, when it can be inlined. See resolve_advisor_photo. */
const CLIENT_FUNDED_ADVISOR_CID = "client_funded_advisor";

/**
 * Where "Leave A Review Here" points. Env so the link can be repointed without
 * a deploy; the fallback is the public site rather than a dead anchor, so a
 * missing env var costs a review rather than sending a broken button.
 */
function google_review_url(): string {
  return process.env.GOOGLE_REVIEW_URL || "https://www.creditbanc.io";
}

export interface ClientFundedEmailData {
  client_name: string;
  client_email: string;
  /** The advisor who worked the file — signs the email. */
  advisor_name?: string | null;
  /**
   * Job title for the signature line. `advisors` has no title column, so the
   * caller supplies it or it falls back to the generic role. Add a column and
   * this keeps working unchanged.
   */
  advisor_title?: string | null;
  /** advisors.phone, rendered as stored — the column holds no single format. */
  advisor_phone?: string | null;
  /** advisors.profile_pic_url. Resolved to a cid or a remote src by the sender. */
  advisor_photo_url?: string | null;
  /** Overrides GOOGLE_REVIEW_URL for a one-off send. */
  review_url?: string | null;
}

/** What the template actually renders the headshot from: a cid: reference when
 *  the image could be inlined, the original https URL when it could not, or
 *  nothing at all — in which case the signature simply has no photo. */
type ClientFundedRenderData = ClientFundedEmailData & { advisor_photo_src?: string | null };

export function generate_client_funded_email_html(data: ClientFundedRenderData): string {
  // MUST come first — client_name and the advisor fields are operator-entered
  // free text that reaches this template unescaped. See [[email_html_escaping]].
  data = escape_email_strings(data);
  const review = (data.review_url ?? "").trim() || google_review_url();
  const advisor = (data.advisor_name ?? "").trim();
  const title = (data.advisor_title ?? "").trim() || "Business Advisor";
  const phone = (data.advisor_phone ?? "").trim();
  const photo = (data.advisor_photo_src ?? "").trim();
  // First name only — "Hi Robert" reads like a person wrote it, "Hi Robert
  // Castellano-Diaz" reads like a mail merge.
  const first_name = (data.client_name ?? "").split(/\s+/)[0] || "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approved. Funded. Done.</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <!-- Preheader: inbox preview text, hidden in the body itself. -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    Thanks for working with us. Now go pop that champagne.
  </div>

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden;">

          <!-- Hero -->
          <tr>
            <td style="padding: 0; line-height: 0;">
              <img src="cid:${CLIENT_FUNDED_HERO_CID}" alt="Approved. Funded. Done." width="600" style="border: 0; display: block; width: 100%; max-width: 600px; height: auto;">
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding: 36px 40px 8px; text-align: center;">
              <h1 style="margin: 0; color: #1a1a1a; font-size: 24px; font-weight: 700; line-height: 1.3;">Approved. Funded. Done.</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 24px 40px 0;">
              <p style="margin: 0 0 18px; color: #333333; font-size: 16px; line-height: 1.6;">Hi ${first_name},</p>
              <p style="margin: 0 0 18px; color: #333333; font-size: 16px; line-height: 1.6;">
                Just wanted to send a quick note and say thanks for working with us on this.
              </p>
              <p style="margin: 0 0 18px; color: #333333; font-size: 16px; line-height: 1.6;">
                Whether this helps you clean things up, invest in growth, or take a little pressure off day-to-day operations, we&rsquo;re glad we could be part of the process.
              </p>
              <p style="margin: 0 0 24px; color: #333333; font-size: 16px; line-height: 1.6;">
                If you&rsquo;ve got a minute and want to share your experience, a quick Google review would be appreciated.
              </p>
            </td>
          </tr>

          <!-- Review CTA -->
          <tr>
            <td style="padding: 0 40px 28px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="background-color: #55cf9e; border-radius: 4px; text-align: center;">
                    <a href="${review}" style="display: block; padding: 15px 20px; color: #1a1a1a; font-size: 16px; font-weight: 700; text-decoration: none;">Leave A Review Here</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="margin: 0 0 18px; color: #333333; font-size: 16px; line-height: 1.6;">
                We&rsquo;ll stay in touch. And if you need us before then, you know where to find us.
              </p>
              <p style="margin: 0 0 18px; color: #333333; font-size: 16px; line-height: 1.6;">
                Now, pop that champagne and celebrate!
              </p>
              <p style="margin: 0 0 28px; color: #333333; font-size: 16px; line-height: 1.6; font-style: italic;">
                Speak soon,
              </p>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding: 0 40px 40px; text-align: center;">${
              photo
                ? `
              <img src="${photo}" alt="${advisor}" width="150" height="150" style="border: 0; display: block; width: 150px; height: 150px; border-radius: 75px; margin: 0 auto 18px;">`
                : ""
            }
              <p style="margin: 0 0 8px; color: #1a1a1a; font-size: 20px; font-weight: 700; line-height: 1.3;">${advisor}</p>
              <p style="margin: 0 0 2px; color: #1a1a1a; font-size: 13px; font-weight: 700; line-height: 1.5;">${title} | Credit Banc</p>${
                phone
                  ? `
              <p style="margin: 0 0 14px; color: #333333; font-size: 13px; line-height: 1.5;">TEL: ${phone}</p>`
                  : `
              <p style="margin: 0 0 14px;"></p>`
              }
              <p style="margin: 0; color: #333333; font-size: 13px; line-height: 1.5;">Learn more at <a href="https://www.creditbanc.io" style="color: #1a73e8; text-decoration: none;">creditbanc.io</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// NOTE: no escape_email_strings here — escaping belongs to the HTML template
// only. A client named "Tom O'Neill" must not read as "Tom O&#39;Neill" in the
// plain-text part.
export function generate_client_funded_email_text(data: ClientFundedEmailData): string {
  const review = (data.review_url ?? "").trim() || google_review_url();
  const advisor = (data.advisor_name ?? "").trim();
  const title = (data.advisor_title ?? "").trim() || "Business Advisor";
  const phone = (data.advisor_phone ?? "").trim();
  const first_name = (data.client_name ?? "").split(/\s+/)[0] || "";

  return [
    `APPROVED. FUNDED. DONE.`,
    ``,
    `Hi ${first_name},`,
    ``,
    `Just wanted to send a quick note and say thanks for working with us on`,
    `this.`,
    ``,
    `Whether this helps you clean things up, invest in growth, or take a little`,
    `pressure off day-to-day operations, we're glad we could be part of the`,
    `process.`,
    ``,
    `If you've got a minute and want to share your experience, a quick Google`,
    `review would be appreciated.`,
    ``,
    `Leave a review here: ${review}`,
    ``,
    `We'll stay in touch. And if you need us before then, you know where to`,
    `find us.`,
    ``,
    `Now, pop that champagne and celebrate!`,
    ``,
    `Speak soon,`,
    ``,
    advisor,
    `${title} | Credit Banc`,
    ...(phone ? [`TEL: ${phone}`] : []),
    ``,
    `Learn more at creditbanc.io`,
  ].join("\n");
}

/**
 * Turn `advisors.profile_pic_url` into something an email client will actually
 * render.
 *
 * The bucket serves EVERY headshot as `Content-Type: image/webp` regardless of
 * what was uploaded — the signup route hardcoded it (see actions/staff-profile.ts).
 * Luigi's file, for instance, is a real PNG announced as webp. Mail clients that
 * trust the header rather than sniffing the bytes then show a broken image, so
 * the bytes are fetched, normalised to PNG and inlined as an attachment.
 *
 * Falls back to the remote URL on any failure, and to no photo at all if there
 * is no URL. A headshot is never worth failing a send over.
 */
async function resolve_advisor_photo(
  url?: string | null
): Promise<{ src: string | null; attachment: any | null }> {
  const clean_url = (url ?? "").trim();
  if (!clean_url) return { src: null, attachment: null };

  try {
    const res = await fetch(clean_url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const input = Buffer.from(await res.arrayBuffer());
    // 300px covers the 150px display box on retina without shipping the 1080px
    // original, which is ~1.1MB and would dominate the message size.
    const sharp = (await import("sharp")).default;
    const png = await sharp(input).resize(300, 300, { fit: "cover" }).png().toBuffer();
    return {
      src: `cid:${CLIENT_FUNDED_ADVISOR_CID}`,
      attachment: {
        filename: "advisor.png",
        content: png,
        cid: CLIENT_FUNDED_ADVISOR_CID,
      },
    };
  } catch (err) {
    console.warn("[email] advisor photo could not be inlined, linking remotely:", err);
    return { src: clean_url, attachment: null };
  }
}

export async function send_client_funded_email(data: ClientFundedEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || "Credit Banc";

  const photo = await resolve_advisor_photo(data.advisor_photo_url);

  const attachments: any[] = [
    {
      filename: "approved-funded-done.png",
      path: path.join(process.cwd(), "public", CLIENT_FUNDED_HERO_FILE),
      cid: CLIENT_FUNDED_HERO_CID,
    },
  ];
  if (photo.attachment) attachments.push(photo.attachment);

  return await transporter.sendMail({
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: `Approved. Funded. Done.`,
    html: generate_client_funded_email_html({ ...data, advisor_photo_src: photo.src }),
    text: generate_client_funded_email_text(data),
    attachments,
  });
}

/**
 * ============================================================================
 * AFFILIATE PAYOUT NOTIFICATION
 * ============================================================================
 * Sent to an affiliate when one of their referrals gets funded and the fixed
 * reward is dispatched via Giftronaut.
 */
/**
 * From header for EVERY affiliate-facing email. The program has its own sending
 * identity (SMTP_FROM_AFFILIATE_EMAIL = affiliate@vault.creditbanc.net) so its
 * deliverability reputation, replies and unsubscribes stay separate from client
 * and advisor mail — those build very different sending histories.
 *
 * Falls back to the general sender so a missing env var degrades to "sent from
 * the wrong address" rather than "not sent at all". Any new affiliate email
 * should use this rather than reading the env vars again.
 * See [[affiliate_program]].
 */
function affiliate_from_header(): string {
  const from_email =
    process.env.SMTP_FROM_AFFILIATE_EMAIL || process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name =
    process.env.SMTP_FROM_AFFILIATE_NAME || process.env.SMTP_FROM_NAME || 'Credit Banc';
  return `${from_name} <${from_email}>`;
}

/**
 * Hero art, inlined as an attachment for the same reason as the welcome hero —
 * see AFFILIATE_WELCOME_HERO_CID below.
 */
const AFFILIATE_FUNDED_HERO_CID = "affiliate_funded_hero";
const AFFILIATE_FUNDED_HERO_FILE = "Your referral funded.png";

export interface AffiliatePayoutNotificationData {
  affiliate_name: string;
  affiliate_email: string;
  reward_amount: string; // pre-formatted, e.g. "$500"
  login_url: string;
  /**
   * Who funded — the CONTACT at the referred business ("Dana Whitfield"), not
   * the affiliate receiving this email. Optional because the copy has to still
   * read correctly for a payout whose vault row we could not resolve; see
   * referral_label() for the fallbacks.
   */
  referral_name?: string | null;
  /** The referred business itself ("Ridgeline Coffee Roasters"). */
  referral_company?: string | null;
  /**
   * Giftronaut reward-link claim URL. When present this email IS the gift card
   * delivery — the affiliate claims from here and Giftronaut sends them nothing.
   * When absent the copy falls back to "watch for an email from Giftronaut",
   * which is the older choice-card flow. Both shapes must keep reading right:
   * the two paths are switched by AFFILIATE_PAYOUT_MODE, not by the template.
   *
   * The URL is a bearer credential (reward links carry no recipient OTP), so it
   * belongs in the body of THIS email and nowhere else.
   */
  claim_url?: string | null;
}

/**
 * Greedy wrap for a plain-text line whose width depends on data. 78 cols is the
 * conventional ceiling for text/plain. A single word longer than the limit is
 * left over-long rather than broken mid-token — a URL or address split across
 * two lines stops being clickable.
 */
function wrap_plain_text(text: string, width = 78): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * Subject of the "X officially funded" sentence: "Dana Whitfield from Ridgeline
 * Coffee Roasters". Either half can be missing — a vault row carries whichever
 * of client_name / company_name was captured — and a blank/unknown referral must
 * never render as an empty gap, a dangling "from", or a literal "null". Every
 * branch below still scans as English.
 */
function referral_label(name?: string | null, company?: string | null): string {
  const person = (name ?? "").trim();
  const business = (company ?? "").trim();
  if (person && business) return `${person} from ${business}`;
  return person || business || "Your referral";
}

export function generate_affiliate_payout_notification_html(data: AffiliatePayoutNotificationData): string {
  data = escape_email_strings(data);
  const { affiliate_name, reward_amount, login_url } = data;
  const referral = referral_label(data.referral_name, data.referral_company);
  const claim_url = data.claim_url?.trim() || null;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cue the Confetti. Your Referral Funded!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #faf9f6;">
  <!-- Preheader: shown in the inbox preview, hidden in the body. -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    ${referral} funded through Credit Banc — your ${reward_amount} gift card is on the way.
  </div>

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #faf9f6;">
    <tr>
      <td align="center" style="padding: 32px 12px;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(32, 37, 54, 0.08);">

          <!-- Hero art -->
          <tr>
            <td style="padding: 0; line-height: 0; background-color: #ffffff;">
              <img src="cid:${AFFILIATE_FUNDED_HERO_CID}" alt="Your referral funded!" width="600" style="border: 0; display: block; width: 100%; max-width: 600px; height: auto;">
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 8px 40px 0;">
              <h1 style="margin: 0 0 16px; color: #202536; font-size: 22px; font-weight: 700; line-height: 1.35;">Hi ${affiliate_name},</h1>
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                Pop the champagne. Pour something expensive. Or just take a victory lap around the kitchen.
              </p>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                <strong style="color: #202536;">${referral}</strong> officially funded through Credit Banc, which means another small business got the help it needed thanks to you.
              </p>
            </td>
          </tr>

          <!-- The reward -->
          <tr>
            <td style="padding: 0 40px 28px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f2fbf7; border: 1px solid #cdeee0; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    ${
                      claim_url
                        ? `<p style="margin: 0 0 20px; color: #00553b; font-size: 18px; line-height: 1.6;">
                      It also means you've earned a <strong>${reward_amount} gift card</strong> — it's ready right now. Claim it below and pick whichever card you want.
                    </p>
                    <a href="${claim_url}" style="display: inline-block; padding: 16px 34px; background-color: #55cf9e; color: #202536; font-size: 16px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.02em;">CLAIM MY ${reward_amount} GIFT CARD</a>
                    <p style="margin: 18px 0 0; color: #00553b; font-size: 13px; line-height: 1.6;">
                      This link is your gift card — anyone who opens it can redeem it, so keep it to yourself. It expires 180 days from today.
                    </p>`
                        : `<p style="margin: 0; color: #00553b; font-size: 18px; line-height: 1.6;">
                      It also means you've earned a ${reward_amount} gift card. Keep an eye out for an email from <strong>Giftronaut</strong> within the next three business days so you can choose your reward.
                    </p>`
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Thanks -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                Thanks for making the introduction.
              </p>
              <p style="margin: 0 0 24px; color: #202536; font-size: 18px; font-weight: 700; line-height: 1.45;">
                Turns out, knowing someone really does pay.
              </p>
              <p style="margin: 0 0 28px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                Keep sharing your link. There may be another business owner in your contacts who could use a hand.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="${login_url}" style="display: inline-block; padding: 16px 34px; background-color: #202536; color: #a6f0ce; font-size: 16px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.02em;">OPEN MY AFFILIATE DASHBOARD</a>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding: 0 40px 40px;">
              <p style="margin: 0; color: #6b7280; font-size: 15px;">The Credit Banc Team</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 32px; background-color: #202536; text-align: center;">
              <p style="margin: 0; color: #8b90a0; font-size: 12px; line-height: 1.6;">© ${new Date().getFullYear()} Credit Banc</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// No escape_email_strings here — escaping belongs to the HTML templates only.
// Escaping the plain-text body surfaced literal "&amp;" / "&#39;" to any
// affiliate whose name contains & or an apostrophe.
export function generate_affiliate_payout_notification_text(data: AffiliatePayoutNotificationData): string {
  const referral = referral_label(data.referral_name, data.referral_company);
  return [
    `Hi ${data.affiliate_name},`,
    ``,
    `Pop the champagne. Pour something expensive. Or just take a victory lap`,
    `around the kitchen.`,
    ``,
    // Wrapped at runtime, unlike the hand-wrapped copy around it: `referral`
    // carries a name AND a company now, so where this sentence needs to break
    // depends on data ("Dana Whitfield from Ridgeline Coffee Roasters" alone is
    // 46 chars). A fixed break put the first line ~100 cols wide.
    wrap_plain_text(
      `${referral} officially funded through Credit Banc, which means another ` +
        `small business got the help it needed thanks to you.`
    ),
    ``,
    ...(data.claim_url?.trim()
      ? [
          `It also means you've earned a ${data.reward_amount} gift card, and it's ready`,
          `right now. Claim it here and pick whichever card you want:`,
          ``,
          data.claim_url.trim(),
          ``,
          wrap_plain_text(
            `This link IS your gift card — anyone who opens it can redeem it, so keep ` +
              `it to yourself. It expires 180 days from today.`
          ),
        ]
      : [
          `It also means you've earned a ${data.reward_amount} gift card. Keep an eye out for an email`,
          `from Giftronaut within the next three business days so you can choose your`,
          `reward.`,
        ]),
    ``,
    `Thanks for making the introduction.`,
    ``,
    `Turns out, knowing someone really does pay.`,
    ``,
    `Keep sharing your link. There may be another business owner in your contacts`,
    `who could use a hand.`,
    ``,
    `Open your affiliate dashboard: ${data.login_url}`,
    ``,
    `The Credit Banc Team`,
    ``,
    `© ${new Date().getFullYear()} Credit Banc`,
  ].join("\n");
}

export async function send_affiliate_payout_notification(data: AffiliatePayoutNotificationData) {
  const transporter = create_smtp_transporter();

  const mail_options: any = {
    from: affiliate_from_header(),
    to: data.affiliate_email,
    // When the email carries the claim link it IS the gift card, so the subject
    // has to say so — an unopened bearer link is the whole failure mode of the
    // reward-link flow. Without a link the second email (Giftronaut's) does that
    // job and this one stays pure celebration.
    subject: data.claim_url?.trim()
      ? `Cue the Confetti — your ${data.reward_amount} gift card is ready`
      : `Cue the Confetti. Your Referral Funded!`,
    html: generate_affiliate_payout_notification_html(data),
    text: generate_affiliate_payout_notification_text(data),
    attachments: [
      {
        filename: "your-referral-funded.png",
        path: path.join(process.cwd(), "public", AFFILIATE_FUNDED_HERO_FILE),
        cid: AFFILIATE_FUNDED_HERO_CID,
      },
    ],
  };

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * AFFILIATE WELCOME EMAIL
 * ============================================================================
 * Sent once, immediately after a public affiliate signup. Its whole job is to
 * hand over the one thing the affiliate actually needs — their personal
 * referral link — and set the expectation for how the reward works.
 *
 * Sent FROM the dedicated affiliate identity (SMTP_FROM_AFFILIATE_EMAIL) so
 * program mail is separable from client/advisor mail at the mailbox provider.
 * See [[affiliate_program]].
 *
 * VOICE: this one is deliberately not written like the transactional mail. The
 * "I Know Someone" Club copy is approved marketing copy — keep the jokes, keep
 * the line breaks. Palette follows the hero art (navy headlines, mint rule,
 * amber accent, cream page) rather than the emerald transactional shell, so
 * artwork and body read as one piece. See [[brand_design_system]].
 */

/**
 * Hero art, inlined as a nodemailer attachment rather than a remote <img>.
 * Gmail proxies/blocks remote images on first contact from a new sender, and
 * this is the FIRST mail an affiliate ever gets from the program identity —
 * exactly the moment a broken hero costs the most. Same pattern as
 * send_client_welcome_email.
 */
const AFFILIATE_WELCOME_HERO_CID = "affiliate_welcome_hero";
const AFFILIATE_WELCOME_HERO_FILE = "Welcome to the club.png";

export interface AffiliateWelcomeEmailData {
  affiliate_name: string;
  affiliate_email: string;
  /** The affiliate's personal link, e.g. https://vault.creditbanc.io/r/jane-doe-4f2a */
  referral_url: string;
  dashboard_url: string;
  /** Pre-formatted, e.g. "$500". */
  reward_amount: string;
  /** Public program page carrying the full terms. */
  terms_url: string;
}

export function generate_affiliate_welcome_email_html(data: AffiliateWelcomeEmailData): string {
  data = escape_email_strings(data);
  const { affiliate_name, referral_url, dashboard_url, reward_amount, terms_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're In. Go Know Someone.</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #faf9f6;">
  <!-- Preheader: shown in the inbox preview, hidden in the body. -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    Your affiliate dashboard is live and your personal referral link is ready. Now go know someone.
  </div>

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #faf9f6;">
    <tr>
      <td align="center" style="padding: 32px 12px;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(32, 37, 54, 0.08);">

          <!-- Hero art -->
          <tr>
            <td style="padding: 0; line-height: 0; background-color: #ffffff;">
              <img src="cid:${AFFILIATE_WELCOME_HERO_CID}" alt="Welcome to the club." width="600" style="border: 0; display: block; width: 100%; max-width: 600px; height: auto;">
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 8px 40px 0;">
              <h1 style="margin: 0 0 16px; color: #202536; font-size: 22px; font-weight: 700; line-height: 1.35;">Hi ${affiliate_name}, you're officially in!</h1>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                Thanks for joining Credit Banc&rsquo;s &ldquo;I Know Someone&rdquo; Club. Your affiliate dashboard is live, your personal referral link is ready, and somewhere in your contacts is a business owner who should probably hear from you.
              </p>
            </td>
          </tr>

          <!-- The link -->
          <tr>
            <td style="padding: 0 40px 8px;">
              <p style="margin: 0 0 12px; color: #202536; font-size: 16px; font-weight: 700;">Here's your personal referral link:</p>
              <div style="background-color: #fdf8e8; border: 1px solid #f0e6c8; border-radius: 12px; padding: 20px; text-align: center;">
                <p style="margin: 0; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 15px; word-break: break-all;">
                  <a href="${referral_url}" style="color: #00553b; text-decoration: none; font-weight: 600;">${referral_url}</a>
                </p>
              </div>
              <p style="margin: 12px 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
                Copy it. Save it. Send it to someone useful.
              </p>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                You can also visit your affiliate dashboard anytime to grab your link, share directly to social media, and track each referral as it moves through the process.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="${dashboard_url}" style="display: inline-block; padding: 16px 34px; background-color: #202536; color: #a6f0ce; font-size: 16px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.02em;">OPEN MY AFFILIATE DASHBOARD</a>
            </td>
          </tr>

          <!-- Where to start -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="border-top: 1px solid #e8e6e0;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 40px 0;">
              <h2 style="margin: 0 0 12px; color: #202536; font-size: 18px; font-weight: 700;">Not sure where to start?</h2>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                Text your link to a friend who owns a business. Email it to your cousin with three locations and no free time. Post it on Facebook or LinkedIn. Drop it in the group chat. Slide into a few DMs without making it weird.
              </p>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                When someone uses your link, we take it from there. Our team will learn what their business needs, walk them through the options, and see whether Credit Banc can help.
              </p>
            </td>
          </tr>

          <!-- The reward -->
          <tr>
            <td style="padding: 0 40px 28px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f2fbf7; border: 1px solid #cdeee0; border-radius: 12px;">
                <tr>
                  <td style="padding: 22px 24px; text-align: center;">
                    <p style="margin: 0; color: #00553b; font-size: 16px; line-height: 1.6;">
                      If their deal funds, you'll receive a <strong style="font-size: 18px;">${reward_amount} gift card</strong> of your choice through Giftronaut.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- No limit -->
          <tr>
            <td style="padding: 0 40px 8px;">
              <p style="margin: 0 0 10px; color: #202536; font-size: 16px; font-weight: 700;">And there's no referral limit.</p>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.8;">
                Know one business owner? Excellent.<br>
                Know ten? Even better.<br>
                Know half the town? Slightly concerning, but financially promising.
              </p>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding: 0 40px 40px;">
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                You make the intro. We make the calls.
              </p>
              <p style="margin: 0 0 4px; color: #202536; font-size: 20px; font-weight: 700;">Now go know someone.</p>
              <p style="margin: 0; color: #6b7280; font-size: 15px;">The Credit Banc Team</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 32px; background-color: #202536; text-align: center;">
              <p style="margin: 0 0 8px; color: #b9bdc9; font-size: 13px; line-height: 1.6;">
                Rewards are issued after a referred deal funds and closing conditions are complete.
                <a href="${terms_url}" style="color: #a6f0ce; text-decoration: underline;">Full program terms</a>.
              </p>
              <p style="margin: 0; color: #8b90a0; font-size: 12px;">© ${new Date().getFullYear()} Credit Banc</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// NOTE: no escape_email_strings here — escaping belongs to the HTML templates
// only, otherwise a name containing & or ' surfaces as a literal "&amp;".
export function generate_affiliate_welcome_email_text(data: AffiliateWelcomeEmailData): string {
  const { affiliate_name, referral_url, dashboard_url, reward_amount, terms_url } = data;
  return [
    `Hi ${affiliate_name}, you're officially in!`,
    ``,
    `Thanks for joining Credit Banc's "I Know Someone" Club. Your affiliate`,
    `dashboard is live, your personal referral link is ready, and somewhere in`,
    `your contacts is a business owner who should probably hear from you.`,
    ``,
    `Here's your personal referral link:`,
    `${referral_url}`,
    ``,
    `Copy it. Save it. Send it to someone useful.`,
    ``,
    `You can also visit your affiliate dashboard anytime to grab your link, share`,
    `directly to social media, and track each referral as it moves through the`,
    `process.`,
    ``,
    `OPEN MY AFFILIATE DASHBOARD: ${dashboard_url}`,
    ``,
    `Not sure where to start?`,
    `Text your link to a friend who owns a business. Email it to your cousin with`,
    `three locations and no free time. Post it on Facebook or LinkedIn. Drop it in`,
    `the group chat. Slide into a few DMs without making it weird.`,
    ``,
    `When someone uses your link, we take it from there. Our team will learn what`,
    `their business needs, walk them through the options, and see whether Credit`,
    `Banc can help.`,
    ``,
    `If their deal funds, you'll receive a ${reward_amount} gift card of your choice through`,
    `Giftronaut.`,
    ``,
    `And there's no referral limit.`,
    `Know one business owner? Excellent.`,
    `Know ten? Even better.`,
    `Know half the town? Slightly concerning, but financially promising.`,
    ``,
    `You make the intro. We make the calls.`,
    ``,
    `Now go know someone.`,
    `The Credit Banc Team`,
    ``,
    `Rewards are issued after a referred deal funds and closing conditions are`,
    `complete. Full program terms: ${terms_url}`,
    ``,
    `© ${new Date().getFullYear()} Credit Banc`,
  ].join("\n");
}

export async function send_affiliate_welcome_email(data: AffiliateWelcomeEmailData) {
  const transporter = create_smtp_transporter();

  const mail_options: any = {
    from: affiliate_from_header(),
    to: data.affiliate_email,
    subject: `You're In. Go Know Someone.`,
    html: generate_affiliate_welcome_email_html(data),
    text: generate_affiliate_welcome_email_text(data),
    attachments: [
      {
        filename: "welcome-to-the-club.png",
        path: path.join(process.cwd(), "public", AFFILIATE_WELCOME_HERO_FILE),
        cid: AFFILIATE_WELCOME_HERO_CID,
      },
    ],
  };

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * AFFILIATE LINK USED — SOMEONE BOOKED A CALL
 * ============================================================================
 *
 * The middle beat of the affiliate program. Welcome says "here's your link",
 * funded says "here's your $500"; between them an affiliate can share a link for
 * weeks with no signal that anything happened. This fires the first time one of
 * their referrals actually books a call, which is the earliest moment there is
 * something honest to report.
 *
 * DELIBERATELY DOES NOT PROMISE MONEY. A booked call is not a funded deal — most
 * of them won't be — so the copy names the gap ("too early to start shopping")
 * rather than implying the reward is close. An affiliate who reads this as "I've
 * earned $500" and then hears nothing for two months is a support ticket and a
 * lost advocate.
 *
 * Sent FROM the dedicated affiliate identity, like every other affiliate-facing
 * email. See [[affiliate_program]] and affiliate_from_header above.
 */

// Hero art. The file MUST be committed — nodemailer resolves it from disk at
// send time and every call site swallows the throw, so an uncommitted PNG is a
// silent no-send in production. See [[email_hero_images_must_be_committed]].
const AFFILIATE_LINK_USED_HERO_CID = "affiliate_link_used_hero";
const AFFILIATE_LINK_USED_HERO_FILE = "Your link just got some action.png";

export interface AffiliateLinkUsedEmailData {
  affiliate_name: string;
  affiliate_email: string;
  /** The person who used the link. Shown to the affiliate, who already sees
   *  their leads by name on the dashboard — this discloses nothing new. */
  referral_name: string;
  reward_amount: string;
  dashboard_url: string;
  terms_url: string;
}

export function generate_affiliate_link_used_email_html(data: AffiliateLinkUsedEmailData): string {
  data = escape_email_strings(data);
  const { affiliate_name, referral_name, reward_amount, dashboard_url, terms_url } = data;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Someone used your link</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #faf9f6;">
  <!-- Preheader: shown in the inbox preview, hidden in the body. -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    ${referral_name} just pre-qualified through your link. We&rsquo;ve got movement.
  </div>

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #faf9f6;">
    <tr>
      <td align="center" style="padding: 32px 12px;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(32, 37, 54, 0.08);">

          <!-- Hero art -->
          <tr>
            <td style="padding: 0; line-height: 0; background-color: #ffffff;">
              <img src="cid:${AFFILIATE_LINK_USED_HERO_CID}" alt="Your link just got some action." width="600" style="border: 0; display: block; width: 100%; max-width: 600px; height: auto;">
            </td>
          </tr>

          <!-- The news -->
          <tr>
            <td style="padding: 8px 40px 0;">
              <h1 style="margin: 0 0 16px; color: #202536; font-size: 22px; font-weight: 700; line-height: 1.35;">Hi ${affiliate_name},</h1>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                <strong style="color: #202536;">${referral_name}</strong> just used your affiliate link and pre-qualified with Credit Banc.
              </p>
            </td>
          </tr>

          <!-- Expectation setting. The point of the whole email is that this is
               movement, NOT money — the panel is deliberately neutral cream
               rather than the mint the funded email uses for a real payout. -->
          <tr>
            <td style="padding: 0 40px 28px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fdf8e8; border: 1px solid #f0e6c8; border-radius: 12px;">
                <tr>
                  <td style="padding: 22px 24px; text-align: center;">
                    <p style="margin: 0; color: #6b5b2e; font-size: 16px; line-height: 1.6;">
                      It&rsquo;s too early to start shopping with that <strong>${reward_amount} gift card</strong>, but hey&hellip; we&rsquo;ve got movement.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding: 0 40px 8px;">
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.65;">
                See? Not a bad little system. Keep sharing that link. We&rsquo;ll keep you updated.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="${dashboard_url}" style="display: inline-block; padding: 16px 34px; background-color: #202536; color: #a6f0ce; font-size: 16px; font-weight: 700; text-decoration: none; border-radius: 10px; letter-spacing: 0.02em;">OPEN MY AFFILIATE DASHBOARD</a>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 40px 40px;">
              <p style="margin: 0 0 4px; color: #202536; font-size: 16px; font-weight: 700;">The Credit Banc Team</p>
              <p style="margin: 0; color: #6b7280; font-size: 15px;">I Know Someone Club</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 32px; background-color: #202536; text-align: center;">
              <p style="margin: 0 0 8px; color: #b9bdc9; font-size: 13px; line-height: 1.6;">
                Rewards are issued after a referred deal funds and closing conditions are complete.
                <a href="${terms_url}" style="color: #a6f0ce; text-decoration: underline;">Full program terms</a>.
              </p>
              <p style="margin: 0; color: #8b90a0; font-size: 12px;">© ${new Date().getFullYear()} Credit Banc</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// NOTE: no escape_email_strings here — escaping belongs to the HTML templates
// only, otherwise a referral named "Tom O'Neill" reads as "Tom O&#39;Neill" in
// the plain-text part.
export function generate_affiliate_link_used_email_text(data: AffiliateLinkUsedEmailData): string {
  const { affiliate_name, referral_name, reward_amount, dashboard_url, terms_url } = data;
  return [
    `Hi ${affiliate_name},`,
    ``,
    `${referral_name} just used your affiliate link and pre-qualified with`,
    `Credit Banc.`,
    ``,
    `It's too early to start shopping with that ${reward_amount} gift card, but hey...`,
    `we've got movement.`,
    ``,
    `See? Not a bad little system. Keep sharing that link. We'll keep you updated.`,
    ``,
    `The Credit Banc Team`,
    `I Know Someone Club`,
    ``,
    `Open your affiliate dashboard: ${dashboard_url}`,
    ``,
    `Rewards are issued after a referred deal funds and closing conditions are`,
    `complete. Full program terms: ${terms_url}`,
    ``,
    `© ${new Date().getFullYear()} Credit Banc`,
  ].join("\n");
}

export async function send_affiliate_link_used_email(data: AffiliateLinkUsedEmailData) {
  const transporter = create_smtp_transporter();

  const mail_options: any = {
    from: affiliate_from_header(),
    to: data.affiliate_email,
    subject: `Well, well, well...someone used your link. 👀`,
    html: generate_affiliate_link_used_email_html(data),
    text: generate_affiliate_link_used_email_text(data),
    attachments: [
      {
        filename: "your-link-just-got-some-action.png",
        path: path.join(process.cwd(), "public", AFFILIATE_LINK_USED_HERO_FILE),
        cid: AFFILIATE_LINK_USED_HERO_CID,
      },
    ],
  };

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * DOCUMENT REJECTION NOTIFICATION FUNCTIONS
 * ============================================================================
 */

/**
 * Interface for document rejection notification data
 */
export interface DocumentRejectionEmailData {
  client_name: string;
  client_email: string;
  doc_label: string;
  rejection_reason: string;
  advisor_name: string;
  advisor_cc_emails?: string[]; // CC primary advisor + follower advisors
  login_url: string;
}

/**
 * Generates HTML for document rejection email
 */
export function generate_document_rejection_email_html(data: DocumentRejectionEmailData): string {
  data = escape_email_strings(data);
  const { client_name, doc_label, rejection_reason, advisor_name, login_url } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Required: Document Update Needed</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background-color: #ef4444;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Action Required</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 20px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${client_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                Your advisor <strong>${advisor_name}</strong> has reviewed your uploaded documents and found that one of them needs to be updated or replaced.
              </p>
              
              <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #b91c1c; font-size: 14px;"><strong>Document Category:</strong> ${doc_label}</p>
                <p style="margin: 0; color: #b91c1c; font-size: 14px;"><strong>Advisor Feedback:</strong> ${rejection_reason}</p>
              </div>

              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.6;">
                Please log in to your Credit Banc Vault to upload the correct file so we can move forward with your funding application.
              </p>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Update Document
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. If you have any questions, please contact your advisor.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends rejection notification email to client
 */
export async function send_document_rejection_email(data: DocumentRejectionEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const html_content = generate_document_rejection_email_html(data);

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: `Action Required: Please update your ${data.doc_label}`,
    html: html_content,
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  console.log(`📧 Sending document rejection email to ${data.client_email} for ${data.doc_label}`);

  try {
    const info = await transporter.sendMail(mail_options);
    console.log(`✅ Rejection email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send rejection email to ${data.client_email}:`, error);
    throw error;
  }
}

// ─── Outstanding Documents Reminder ────────────────────────────────────────────

/** Per-business grouping for the reminder email. When supplied, renders
 *  each entry as its own labeled section in the email body. */
export interface OutstandingDocsReminderGroup {
  business_name: string;
  is_primary?: boolean;
  missing_docs: string[];
}

export interface OutstandingDocsReminderData {
  client_email: string;
  client_name: string;
  business_name?: string | null;
  /** Flat de-duped list. Always required (drives the subject line + the
   *  legacy single-business rendering). For multi-business clients, also
   *  populate `groups` so the body renders per-business sections. */
  missing_docs: string[];
  /** Optional per-business breakdown. If two or more groups are present,
   *  the body renders one section per business with a heading; otherwise
   *  the email falls back to the flat `missing_docs` rendering used today. */
  groups?: OutstandingDocsReminderGroup[];
  advisor_name?: string | null;
  advisor_email?: string | null;
  advisor_phone?: string | null;
  advisor_cc_emails?: string[]; // CC primary advisor + follower advisors
  login_url: string;
  reminder_count: number;
}

// Credit Banc brand assets.
// The hero banner is inlined via nodemailer attachments (cid:vault_reminder_header) —
// matches the pattern in send_client_welcome_email and avoids gmail blocking remote images.
const CB_LOGO_URL = "https://storage.googleapis.com/msgsndr/a1rhIidWtsQzq0jXDNwM/media/0ec47074-3efb-43e4-8dda-c1fe7b805768.png";
const CB_HERO_BANNER_CID = "vault_reminder_header";
const CB_DOCS_ICON_URL = "https://storage.googleapis.com/msgsndr/a1rhIidWtsQzq0jXDNwM/media/716e272b-8fec-4449-abae-4e6445fd17a9.png";

export function generate_outstanding_docs_reminder_html(data: OutstandingDocsReminderData): string {
  const {
    client_name,
    missing_docs,
    advisor_name,
    advisor_email,
    login_url,
  } = data;

  const year = new Date().getFullYear();
  // Doc-list rendering: when a multi-business breakdown is provided, render
  // one labeled section per business so the client knows exactly which file
  // each doc belongs to. Single-business (or unprovided) callers fall back
  // to the flat list, identical to the pre-multi-business UX. Output stays
  // inline-only (<strong>/<br>) so it nests safely inside the template's
  // surrounding <p> wrapper without breaking email-client renderers.
  const groups = (data.groups ?? []).filter(g => g.missing_docs.length > 0);
  const useGrouped = groups.length >= 2;
  const docs_html = useGrouped
    ? groups.map(g => {
        const heading = `<strong style="font-size:15px;color:#103A2A;">${escape_html(g.business_name)}</strong>`;
        const items = g.missing_docs.map(d => escape_html(d)).join("<br>");
        return `${heading}<br>${items}`;
      }).join("<br><br>")
    : missing_docs.map(d => escape_html(d)).join("<br> ");
  const advisor_line = advisor_name
    ? `<p><span style="font-size: 16px">${escape_html(advisor_name)}</span>${advisor_email ? `<br><span style="font-size: 16px">${escape_html(advisor_email)}</span>` : ""}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <title></title>
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--<![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    #outlook a { padding:0; }
    body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
    table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
    img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
    p { display:block;margin:13px 0; }
  </style>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <!--[if lte mso 11]>
  <style type="text/css">.mj-outlook-group-fix { width:100% !important; }</style>
  <![endif]-->
  <!--[if !mso]><!-->
  <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
  <!--<![endif]-->
  <style type="text/css">
    @media only screen and (min-width:480px) {
      .mj-column-per-100 { width:100% !important; max-width: 100%; }
      .mj-column-per-25 { width:25% !important; max-width: 25%; }
      .mj-column-per-75 { width:75% !important; max-width: 75%; }
    }
    @media only screen and (max-width:480px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }
  </style>
</head>
<body style="word-spacing:normal;">
  <div class="email-content" style="background-color:#EAF0F6;">

    <!-- ─── Green header with logo ─── -->
    <div style="background:#55cf9e;background-color:#55cf9e;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#55cf9e;width:100%;">
        <tr>
          <td style="padding:10px 20px;text-align:center;">
            <img height="51" width="240" src="${CB_LOGO_URL}" alt="Credit Banc" style="border:0;display:inline-block;height:51px;width:240px;">
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── Hero banner ─── -->
    <div style="background:#ffffff;background-color:#ffffff;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;width:100%;">
        <tr>
          <td style="padding:0;">
            <img src="cid:${CB_HERO_BANNER_CID}" alt="" width="600" style="border:0;display:block;width:100%;max-width:600px;height:auto;">
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── Greeting ─── -->
    <div style="background:#f2f2f2;background-color:#f2f2f2;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f2f2f2;width:100%;">
        <tr>
          <td style="padding:30px 20px 10px 20px;font-family:arial, helvetica, sans-serif;font-size:16px;line-height:1.25;color:#000000;">
            <p><span style="font-size: 16px">Hi ${escape_html(client_name)},</span></p>
            <p><span style="font-size: 16px">Your application is in good shape. We just need the remaining documents before it can move to underwriting.</span></p>
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── "Here's what we're missing" with icon ─── -->
    <div style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;width:100%;">
        <tr>
          <td style="padding:20px 20px 0 20px;">
            <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top;width:140px;"><![endif]-->
            <div class="mj-column-per-25 mj-outlook-group-fix" style="display:inline-block;vertical-align:top;width:25%;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                <tr>
                  <td align="center" style="padding:10px 20px;">
                    <img height="100" width="100" src="${CB_DOCS_ICON_URL}" alt="" style="border:0;display:block;height:100px;width:100px;">
                  </td>
                </tr>
              </table>
            </div>
            <!--[if mso | IE]></td><td style="vertical-align:top;width:420px;"><![endif]-->
            <div class="mj-column-per-75 mj-outlook-group-fix" style="display:inline-block;vertical-align:top;width:75%;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                <tr>
                  <td align="left" style="padding:0 24px;font-family:arial, helvetica, sans-serif;color:#000000;">
                    <h2 style="margin:0;text-align:left;font-size:24px;font-family:arial, helvetica, sans-serif;color:#000000;">Here's what we're missing:</h2>
                  </td>
                </tr>
              </table>
            </div>
            <!--[if mso | IE]></td></tr></table><![endif]-->
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── Missing docs list ─── -->
    <div style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;width:100%;">
        <tr>
          <td align="left" style="padding:10px 24px 0 24px;font-family:arial, helvetica, sans-serif;font-size:16px;line-height:1.25;color:#000000;">
            <p style="line-height: 1.25;"><span style="font-size: 16px">${docs_html}</span></p>
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── CTA Button ─── -->
    <div style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;width:100%;">
        <tr>
          <td align="center" style="padding:10px 20px 20px 20px;">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;">
              <tr>
                <td align="center" bgcolor="#000000" role="presentation" style="border-radius:25px;background:#000000;" valign="middle">
                  <a href="${login_url}" target="_blank" style="display:inline-block;background:#000000;color:#FFFFFF;font-family:arial, helvetica, sans-serif;font-size:14px;font-weight:bold;line-height:1.25;text-decoration:none;padding:10px 25px;border-radius:25px;">Take Me to My Account</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── Closing / advisor block ─── -->
    <div style="background:#f2f2f2;background-color:#f2f2f2;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f2f2f2;width:100%;">
        <tr>
          <td align="left" style="padding:10px 20px;font-family:arial, helvetica, sans-serif;font-size:16px;line-height:1.25;color:#000000;">
            <p><span style="font-size: 16px">If you have any questions, trouble uploading documents, or accessing your Vault, please reach out to your advisor:</span></p>
            ${advisor_line}
            <p><span style="font-size: 16px"><em>Remember.. the faster these come in, the faster decisions get made!</em></span></p>
            <p style="text-align:left;"><span style="font-size: 20px">The Credit Banc Team</span></p>
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── Black footer (copyright) ─── -->
    <div style="background:#000000;background-color:#000000;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#000000;width:100%;">
        <tr>
          <td align="center" style="padding:20px 20px 10px 20px;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.5;color:#ffffff;">
            <em>Copyright © ${year}&nbsp; Credit Banc Podcast, All rights reserved.</em>
          </td>
        </tr>
      </table>
    </div>

    <!-- ─── Black footer logo ─── -->
    <div style="background:#000000;background-color:#000000;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#000000;width:100%;">
        <tr>
          <td align="center" style="padding:10px 10px 20px 10px;">
            <img height="auto" width="180" src="${CB_LOGO_URL}" alt="Credit Banc" style="border:0;display:inline-block;width:180px;height:auto;">
          </td>
        </tr>
      </table>
    </div>

  </div>
</body>
</html>`;
}

export function escape_html(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML-escapes every top-level string value (and string array element) on an
 * email-data object so user-controlled fields (client/company name, free text)
 * can't inject markup into the rendered HTML email. Numbers/booleans/nested
 * objects pass through untouched.
 *
 * Use ONLY for the HTML templates — never the plain-text ones (escaping would
 * surface literal "&amp;" etc.). App-generated URLs (magic links, reset links)
 * are safe to pass through: "&" → "&amp;" inside an href is decoded correctly
 * by every mail client.
 */
function escape_email_strings<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const out: any = Array.isArray(data) ? [...(data as any)] : { ...(data as any) };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === "string") {
      out[key] = escape_html(v);
    } else if (Array.isArray(v)) {
      out[key] = v.map((item) => (typeof item === "string" ? escape_html(item) : item));
    }
  }
  return out as T;
}

export function generate_outstanding_docs_reminder_text(data: OutstandingDocsReminderData): string {
  const { client_name, business_name, missing_docs, advisor_name, advisor_email, advisor_phone, login_url } = data;
  const subject_target = business_name ? business_name : "your application";
  const groups = (data.groups ?? []).filter(g => g.missing_docs.length > 0);
  const useGrouped = groups.length >= 2;
  const docs_text = useGrouped
    ? groups
        .map(g => `${g.business_name}:\n${g.missing_docs.map(d => `  - ${d}`).join("\n")}`)
        .join("\n\n")
    : missing_docs.map(d => `- ${d}`).join("\n");
  return `
Hi ${client_name},

We're still waiting on a few items to keep ${subject_target} moving forward.

Outstanding Documents:
${docs_text}

Upload them here: ${login_url}

${advisor_name ? `Your Advisor: ${advisor_name}${advisor_email ? `\nEmail: ${advisor_email}` : ""}${advisor_phone ? `\nPhone: ${advisor_phone}` : ""}` : ""}

© ${new Date().getFullYear()} Credit Banc Vault.
  `.trim();
}

export async function send_outstanding_docs_reminder_email(data: OutstandingDocsReminderData) {
  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || "Credit Banc Vault";

  const subject_target = data.business_name || "your application";
  const subject = `Document reminder: Here's what we're missing ${data.missing_docs.length} document${data.missing_docs.length === 1 ? "" : "s"} outstanding for ${subject_target}`;

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject,
    html: generate_outstanding_docs_reminder_html(data),
    text: generate_outstanding_docs_reminder_text(data),
    attachments: [
      {
        filename: "vault-reminder-header.png",
        path: path.join(process.cwd(), "public", "vault reminder header.png"),
        cid: CB_HERO_BANNER_CID,
      },
    ],
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  try {
    const info = await transporter.sendMail(mail_options);
    console.log(`✅ Reminder email sent to ${data.client_email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send reminder email to ${data.client_email}:`, error);
    throw error;
  }
}

// ─── MyScoreIQ Setup Email ─────────────────────────────────────────────────────

const MYSCOREIQ_SIGNUP_URL = "https://www.myscoreiq.com/business-credit-max.aspx?offercode=432139I0";

export interface MyScoreIQSetupEmailData {
  client_email: string;
  client_name: string;
  advisor_name?: string | null;
  advisor_email?: string | null;
  advisor_cc_emails?: string[]; // CC primary advisor + follower advisors
}

export function generate_myscoreiq_setup_email_html(data: MyScoreIQSetupEmailData): string {
  const { client_name, advisor_name, advisor_email } = data;
  const year = new Date().getFullYear();
  const advisor_line = advisor_name
    ? `<p><span style="font-size: 16px">${escape_html(advisor_name)}</span>${advisor_email ? `<br><span style="font-size: 16px">${escape_html(advisor_email)}</span>` : ""}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <title></title>
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--<![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
    table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
    img { border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
    p { display:block;margin:13px 0; }
  </style>
  <!--[if !mso]><!-->
  <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
  <!--<![endif]-->
</head>
<body style="word-spacing:normal;">
  <div style="background-color:#EAF0F6;">

    <!-- Green header with logo -->
    <div style="background:#55cf9e;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#55cf9e;width:100%;">
        <tr>
          <td style="padding:10px 20px;text-align:center;">
            <img height="51" width="240" src="${CB_LOGO_URL}" alt="Credit Banc" style="border:0;display:inline-block;height:51px;width:240px;">
          </td>
        </tr>
      </table>
    </div>

    <!-- Greeting + body -->
    <div style="background:#f2f2f2;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f2f2f2;width:100%;">
        <tr>
          <td style="padding:30px 20px 10px 20px;font-family:arial, helvetica, sans-serif;font-size:16px;line-height:1.5;color:#000000;">
            <p><span style="font-size: 16px">Hello ${escape_html(client_name)},</span></p>
            <p><span style="font-size: 16px">Here's the link for you to create and share your credit reports with us:</span></p>
          </td>
        </tr>
      </table>
    </div>

    <!-- CTA -->
    <div style="background:#FFFFFF;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;width:100%;">
        <tr>
          <td align="center" style="padding:24px 20px;">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;">
              <tr>
                <td align="center" bgcolor="#000000" role="presentation" style="border-radius:25px;background:#000000;" valign="middle">
                  <a href="${MYSCOREIQ_SIGNUP_URL}" target="_blank" style="display:inline-block;background:#000000;color:#FFFFFF;font-family:arial, helvetica, sans-serif;font-size:14px;font-weight:bold;line-height:1.25;text-decoration:none;padding:10px 25px;border-radius:25px;">Set Up MyScoreIQ</a>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;font-family:arial, helvetica, sans-serif;font-size:12px;color:#666666;word-break:break-all;">
              Or paste this link in your browser:<br>
              <a href="${MYSCOREIQ_SIGNUP_URL}" style="color:#666666;text-decoration:underline;">${MYSCOREIQ_SIGNUP_URL}</a>
            </p>
          </td>
        </tr>
      </table>
    </div>

    <!-- Important note -->
    <div style="background:#FFFFFF;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;width:100%;">
        <tr>
          <td align="left" style="padding:0 24px 20px 24px;font-family:arial, helvetica, sans-serif;font-size:16px;line-height:1.5;color:#000000;">
            <p><strong>Important:</strong> Please don't forget to check the box allowing you to share the report with <strong>"Credit Banc"</strong>. This way we'll receive the report as soon as you complete the process.</p>
          </td>
        </tr>
      </table>
    </div>

    <!-- Closing / advisor block -->
    <div style="background:#f2f2f2;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#f2f2f2;width:100%;">
        <tr>
          <td align="left" style="padding:10px 20px;font-family:arial, helvetica, sans-serif;font-size:16px;line-height:1.25;color:#000000;">
            <p><span style="font-size: 16px">If you have any questions, please reach out to your advisor:</span></p>
            ${advisor_line}
            <p style="text-align:left;"><span style="font-size: 20px">The Credit Banc Team</span></p>
          </td>
        </tr>
      </table>
    </div>

    <!-- Black footer copyright -->
    <div style="background:#000000;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#000000;width:100%;">
        <tr>
          <td align="center" style="padding:20px 20px 10px 20px;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.5;color:#ffffff;">
            <em>Copyright © ${year}&nbsp; Credit Banc Podcast, All rights reserved.</em>
          </td>
        </tr>
      </table>
    </div>

    <!-- Black footer logo -->
    <div style="background:#000000;margin:0px auto;max-width:600px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#000000;width:100%;">
        <tr>
          <td align="center" style="padding:10px 10px 20px 10px;">
            <img height="auto" width="180" src="${CB_LOGO_URL}" alt="Credit Banc" style="border:0;display:inline-block;width:180px;height:auto;">
          </td>
        </tr>
      </table>
    </div>

  </div>
</body>
</html>`;
}

export function generate_myscoreiq_setup_email_text(data: MyScoreIQSetupEmailData): string {
  const { client_name, advisor_name, advisor_email } = data;
  return `
Hello ${client_name},

Here's the link for you to create and share your credit reports:
${MYSCOREIQ_SIGNUP_URL}

IMPORTANT: Please don't forget to check the box allowing you to share the report with "Credit Banc". This way we'll receive the report as soon as you complete the process.

${advisor_name ? `Your Advisor: ${advisor_name}${advisor_email ? `\nEmail: ${advisor_email}` : ""}` : ""}

The Credit Banc Team
© ${new Date().getFullYear()} Credit Banc.
  `.trim();
}

export async function send_myscoreiq_setup_email(data: MyScoreIQSetupEmailData) {
  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || "Credit Banc";

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: "Set up your MyScoreIQ credit report",
    html: generate_myscoreiq_setup_email_html(data),
    text: generate_myscoreiq_setup_email_text(data),
  };

  const cc_list = build_cc_list(data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  try {
    const info = await transporter.sendMail(mail_options);
    console.log(`✅ MyScoreIQ setup email sent to ${data.client_email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send MyScoreIQ setup email to ${data.client_email}:`, error);
    throw error;
  }
}

/**
 * ============================================================================
 * NEW BUSINESS ADDED NOTIFICATION
 * Sent when an advisor creates a second (or Nth) business under an existing
 * client. Goes To the client with the advisor + followers CC'd so everyone
 * sees the new doc requests + funding ask.
 * ============================================================================
 */

export interface NewBusinessAddedEmailData {
  client_name: string;
  client_email: string;
  advisor_name: string;
  advisor_email: string;
  advisor_phone?: string;
  advisor_cc_emails?: string[];
  business: {
    company_name: string;
    legal_entity_type?: string | null;
    industry?: string | null;
    company_city?: string | null;
    company_state?: string | null;
    business_start_date?: string | null;
    employees_count?: number | null;
  };
  funding?: {
    capital_requested?: number | null;
    proposed_loan_type?: string | null;
    loan_purpose?: string | null;
    funding_eta?: string | null;
  };
  requested_documents: string[]; // Human-readable labels
  login_url: string;
}

function format_currency_or_dash(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n));
}

export function generate_new_business_added_email_html(data: NewBusinessAddedEmailData): string {
  data = escape_email_strings(data);
  const { client_name, advisor_name, advisor_email, advisor_phone, business, funding, requested_documents, login_url } = data;

  const business_rows: [string, string][] = [
    ['Company', business.company_name],
    ['Entity Type', business.legal_entity_type || '—'],
    ['Industry', business.industry || '—'],
    ['Location', [business.company_city, business.company_state].filter(Boolean).join(', ') || '—'],
    ['Business Start Date', business.business_start_date || '—'],
    ['Employees', business.employees_count != null ? String(business.employees_count) : '—'],
  ];

  const funding_rows: [string, string][] = funding ? [
    ['Capital Requested', format_currency_or_dash(funding.capital_requested)],
    ['Loan Type', funding.proposed_loan_type || '—'],
    ['Loan Purpose', funding.loan_purpose || '—'],
    ['Funding ETA', funding.funding_eta || '—'],
  ] : [];

  const row_html = (rows: [string, string][]) => rows.map(([k, v]) => `
    <tr>
      <td style="padding: 8px 12px; color: #64748b; font-size: 14px; border-bottom: 1px solid #f1f5f9; width: 40%;">${k}</td>
      <td style="padding: 8px 12px; color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${v}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Business Added to Your Vault</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 620px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.08);">

          <tr>
            <td style="padding: 32px 40px; background-color: #065f46; text-align: left;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">New business added to your vault</h1>
              <p style="margin: 8px 0 0; color: #a7f3d0; font-size: 14px;">${business.company_name}</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 32px 40px 8px;">
              <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px; font-weight: 600;">Hi ${client_name},</h2>
              <p style="margin: 0 0 16px; color: #334155; font-size: 15px; line-height: 1.6;">
                Your advisor <strong>${advisor_name}</strong> has set up a new business under your Credit Banc Vault account. Below are the details and the documents we'll need from you to move this one forward.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 8px 40px;">
              <h3 style="margin: 0 0 12px; color: #0f172a; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Business details</h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                ${row_html(business_rows)}
              </table>
            </td>
          </tr>

          ${funding_rows.length > 0 ? `
          <tr>
            <td style="padding: 20px 40px 8px;">
              <h3 style="margin: 0 0 12px; color: #0f172a; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Funding ask</h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                ${row_html(funding_rows)}
              </table>
            </td>
          </tr>
          ` : ''}

          <tr>
            <td style="padding: 20px 40px 8px;">
              <h3 style="margin: 0 0 12px; color: #0f172a; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Documents we need (${requested_documents.length})</h3>
              ${requested_documents.length === 0 ? `
                <p style="margin: 0; color: #64748b; font-size: 14px;">No documents are requested at this time. We'll reach out as we need them.</p>
              ` : `
                <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px 20px;">
                  <ul style="margin: 0; padding-left: 20px; color: #166534; font-size: 14px; line-height: 1.8;">
                    ${requested_documents.map(d => `<li>${d}</li>`).join('')}
                  </ul>
                </div>
              `}
            </td>
          </tr>

          <tr>
            <td style="padding: 28px 40px 8px;" align="center">
              <a href="${login_url}" style="display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
                Open my vault
              </a>
              <p style="margin: 12px 0 0; color: #94a3b8; font-size: 13px;">
                Sign in with your existing credentials. The new business appears as its own tab.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 32px 40px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px; color: #64748b; font-size: 13px; line-height: 1.6;">
                <strong style="color: #334155;">Questions?</strong> Reach out to ${advisor_name}.
              </p>
              <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                ${advisor_email}${advisor_phone ? ` · ${advisor_phone}` : ''}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px; text-align: center; color: #94a3b8; font-size: 12px;">
              © ${new Date().getFullYear()} Credit Banc Vault.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export async function send_new_business_added_notification(data: NewBusinessAddedEmailData) {
  const transporter = create_smtp_transporter();

  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const mail_options: any = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: `New business added to your vault: ${data.business.company_name}`,
    html: generate_new_business_added_email_html(data),
  };

  // Always CC the advisor; include follower advisors when provided.
  const cc_list = build_cc_list(data.advisor_email, data.advisor_cc_emails);
  if (cc_list.length > 0) mail_options.cc = cc_list;

  try {
    const info = await transporter.sendMail(mail_options);
    console.log(`✅ New-business email sent to ${data.client_email} (cc: ${cc_list.join(', ') || 'none'}): ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send new-business email to ${data.client_email}:`, error);
    throw error;
  }
}

/**
 * ============================================================================
 * LENDER GUIDELINE REVIEW REMINDER
 * ============================================================================
 * Nudges the underwriting team that one or more lenders' guidelines haven't been
 * reviewed in over six months and should be re-checked for changes.
 */
export interface LenderReviewReminderData {
  to_emails: string[];
  stale_lenders: { name: string; last_reviewed: string | null }[];
  guidelines_url: string;
}

export function generate_lender_review_reminder_html(data: LenderReviewReminderData): string {
  data = escape_email_strings(data);
  const { stale_lenders, guidelines_url } = data;

  const rows = stale_lenders
    .map(
      (l) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #0f172a;">${l.name}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">${l.last_reviewed || 'Never'}</td>
      </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Lender guidelines due for review</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr><td align="center" style="padding: 40px 0;">
      <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <tr><td style="background-color: #f59e0b; padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: #ffffff; font-size: 18px; letter-spacing: 0.04em;">Lender Guidelines Due for Review</h1>
        </td></tr>
        <tr><td style="padding: 28px;">
          <p style="margin: 0 0 16px; color: #334155; font-size: 14px; line-height: 1.6;">
            The following ${stale_lenders.length} lender${stale_lenders.length === 1 ? '' : 's'} ${stale_lenders.length === 1 ? 'has' : 'have'} not had ${stale_lenders.length === 1 ? 'its' : 'their'} guidelines reviewed in over six months. Please re-check them for any changes and mark them reviewed.
          </p>
          <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <th align="left" style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8;">Lender</th>
              <th align="left" style="padding: 8px 12px; border-bottom: 2px solid #cbd5e1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8;">Last reviewed</th>
            </tr>
            ${rows}
          </table>
          <a href="${guidelines_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">Review lender database</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function send_lender_review_reminder_email(data: LenderReviewReminderData) {
  const recipients = (data.to_emails ?? []).filter((e) => !!e && e.includes('@'));
  if (recipients.length === 0) return null;

  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc Vault';

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: recipients,
    subject: `${data.stale_lenders.length} lender${data.stale_lenders.length === 1 ? '' : 's'} due for guideline review`,
    html: generate_lender_review_reminder_html(data),
  };

  return await transporter.sendMail(mail_options);
}

/**
 * Interface for the "client reassigned to you" notification.
 *
 * Sent to the catch-all advisor when files are handed to them — either
 * automatically by the reassign-stale-files cron (7-day no-activity) or
 * manually via the admin "Inactive" button. The email itself is framed as a
 * reassignment + reach-out-ASAP nudge, not as "inactive".
 */
export interface FileReassignmentNotificationData {
  /** New owner (recipient). */
  advisor_name: string;
  advisor_email: string;
  /** Files newly assigned to the recipient. */
  files: Array<{
    client_name: string;
    company_name: string;
    capital_requested?: number | null;
    previous_advisor_name?: string | null;
    inactivity_days: number;
    detail_url: string;
  }>;
  login_url: string;
}

/**
 * Generates HTML for the stale-file reassignment notification.
 *
 * Nested `files` rows are escaped per-field here because escape_email_strings
 * only walks top-level string values, not arrays of objects.
 */
export function generate_file_reassignment_email_html(data: FileReassignmentNotificationData): string {
  const advisor_name = escape_html(data.advisor_name || "there");
  const count = data.files.length;

  const rows = data.files.map((f) => {
    const client_name = escape_html(f.client_name || "Unnamed client");
    const company_name = escape_html(f.company_name || "");
    const previous = f.previous_advisor_name ? escape_html(f.previous_advisor_name) : "Unassigned";
    const amount = typeof f.capital_requested === "number" && f.capital_requested > 0
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(f.capital_requested)
      : "—";
    const days = f.inactivity_days;
    // Last meaningful contact, framed as plain context (no "inactive" wording).
    const last_activity_label = days > 0 ? `${days} day${days === 1 ? "" : "s"} ago` : "—";
    return `
      <tr>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #1e293b;">
          <strong>${client_name}</strong><br>
          <span style="color: #64748b; font-size: 13px;">${company_name}</span>
        </td>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #475569; white-space: nowrap;">${amount}</td>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b;">${previous}</td>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b; white-space: nowrap;">${last_activity_label}</td>
      </tr>`;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${count === 1 ? "A Client Has" : "Clients Have"} Been Reassigned to You</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 640px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #10b981; padding: 40px 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 44px; width: auto; display: block; margin: 0 auto; margin-bottom: 24px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; line-height: 1;">${count === 1 ? "Client" : "Clients"} Reassigned to You</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 8px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${advisor_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                ${count === 1 ? "A client has" : `${count} clients have`} been reassigned to you. Please <strong>reach out to ${count === 1 ? "them" : "them all"} as soon as possible</strong> to keep their deal moving.
              </p>
              <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px;">
                <p style="margin: 0; color: #92400e; font-size: 14px; font-weight: 600;">⏱ Time-sensitive — please make contact today.</p>
              </div>
            </td>
          </tr>

          <!-- Files table -->
          <tr>
            <td style="padding: 8px 40px 8px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #f1f5f9; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc;">
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Client</th>
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Requested</th>
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Previously</th>
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 24px 40px 40px;" align="center">
              <a href="${data.login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                ${count === 1 ? "View Client" : "View Clients"}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends the stale-file reassignment summary to the new owner.
 */
export async function send_file_reassignment_notification(data: FileReassignmentNotificationData) {
  if (!data.files.length) return null;

  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || "Credit Banc Vault";

  const count = data.files.length;
  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: count === 1
      ? "A client has been reassigned to you — please reach out ASAP"
      : `${count} clients reassigned to you — please reach out ASAP`,
    html: generate_file_reassignment_email_html(data),
    attachments: [
      {
        filename: "CBLOGOWHITE.png",
        path: path.join(process.cwd(), "public", "CBLOGOWHITE.png"),
        cid: "cb_logo_white",
      },
    ],
  };

  return await transporter.sendMail(mail_options);
}

export interface ClientCheckInNotificationData {
  /** File owner (recipient). */
  advisor_name: string;
  advisor_email: string;
  /** Funded rounds that are due a check-in call. */
  clients: Array<{
    client_name: string;
    company_name: string;
    /** What the round that just came due actually funded at. */
    funded_amount?: number | null;
    lender_funded?: string | null;
    funded_term?: string | null;
    /** ISO timestamp the round funded. */
    funded_at: string;
    /** Which round it was — "Round 2" reads better than a uuid. */
    round_number: number;
    detail_url: string;
  }>;
  login_url: string;
}

/**
 * Generates HTML for the funded-client check-in nudge.
 *
 * Deliberately NOT written as "your client is ready to borrow again" — the
 * timing is a fixed interval, not a signal about the client's actual appetite.
 * Some come back in three months, some in over a year. The email asks the
 * advisor to make contact and find out; more capital is one possible outcome,
 * not the premise.
 *
 * Nested `clients` rows are escaped per-field here because escape_email_strings
 * only walks top-level string values, not arrays of objects.
 */
export function generate_client_check_in_email_html(
  data: ClientCheckInNotificationData
): string {
  const advisor_name = escape_html(data.advisor_name || "there");
  const count = data.clients.length;

  const rows = data.clients.map((c) => {
    const client_name = escape_html(c.client_name || "Unnamed client");
    const company_name = escape_html(c.company_name || "");
    const lender = c.lender_funded ? escape_html(c.lender_funded) : "—";
    const term = c.funded_term ? escape_html(c.funded_term) : "";
    const amount =
      typeof c.funded_amount === "number" && c.funded_amount > 0
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(c.funded_amount)
        : "—";
    const d = new Date(c.funded_at);
    const funded_on = Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `
      <tr>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #1e293b;">
          <strong>${client_name}</strong><br>
          <span style="color: #64748b; font-size: 13px;">${company_name}</span>
        </td>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #475569; white-space: nowrap;">
          ${amount}${term ? `<br><span style="color: #94a3b8; font-size: 12px;">${term}</span>` : ""}
        </td>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b;">${lender}</td>
        <td style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b; white-space: nowrap;">${funded_on}<br><span style="color: #94a3b8; font-size: 12px;">Round ${c.round_number}</span></td>
      </tr>`;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Check In With ${count === 1 ? "a Funded Client" : "Your Funded Clients"}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f6f9fc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 640px; max-width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #10b981; padding: 40px 20px; text-align: center;">
              <img src="cid:cb_logo_white" alt="Credit Banc" style="height: 44px; width: auto; display: block; margin: 0 auto; margin-bottom: 24px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; line-height: 1;">Time to Check In</h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding: 40px 40px 8px;">
              <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px; font-weight: 600;">Hi ${advisor_name},</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                ${count === 1
                  ? "It's been a while since you funded the client below. Worth a call to see how the business is doing and whether there's anything they need."
                  : `It's been a while since you funded the ${count} clients below. Worth a call to each — see how the business is doing and whether there's anything they need.`}
              </p>
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.6;">
                This isn't a signal that ${count === 1 ? "they're" : "they're"} looking for money — some clients come back within months, others after more than a year. It's a prompt to stay in touch. What ${count === 1 ? "they" : "they"} funded is below so you can open the conversation with the details in hand.
              </p>
              <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px;">
                <p style="margin: 0; color: #065f46; font-size: 14px; font-weight: 600;">💬 If more capital does come up, use <strong>Start New Funding Round</strong> on the client's page to open the next round.</p>
              </div>
            </td>
          </tr>

          <!-- Clients table -->
          <tr>
            <td style="padding: 8px 40px 8px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #f1f5f9; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc;">
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Client</th>
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Funded</th>
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Lender</th>
                    <th align="left" style="padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8;">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 24px 40px 40px;" align="center">
              <a href="${data.login_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                ${count === 1 ? "View Client" : "View Clients"}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 40px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">© ${new Date().getFullYear()} Credit Banc Vault. This is an automated notification.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Sends the funded-client check-in summary to the file's current owner.
 */
export async function send_client_check_in_notification(
  data: ClientCheckInNotificationData
) {
  if (!data.clients.length) return null;

  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || "Credit Banc Vault";

  const count = data.clients.length;
  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject:
      count === 1
        ? "Check in with a client you funded"
        : `Check in with ${count} clients you funded`,
    html: generate_client_check_in_email_html(data),
    attachments: [
      {
        filename: "CBLOGOWHITE.png",
        path: path.join(process.cwd(), "public", "CBLOGOWHITE.png"),
        cid: "cb_logo_white",
      },
    ],
  };

  return await transporter.sendMail(mail_options);
}

/**
 * ============================================================================
 * REFERRAL PARTNER PORTAL INVITE
 * ============================================================================
 * Sent when an admin grants a Level-2 referral partner (CPA, banker,
 * professional) access to /partner/dashboard.
 *
 * No hero image on purpose: emails that inline a PNG throw at send time if the
 * file isn't committed, and every call site swallows the error
 * ([[email_hero_images_must_be_committed]]). This one has to arrive.
 *
 * Uses the general sending identity rather than the affiliate one — referral
 * partners are a different program with a different audience, and folding them
 * into affiliate@ would mix two very different sending reputations.
 */
export interface ReferralPartnerInviteData {
  partner_name: string;
  partner_email: string;
  /**
   * Passwordless entry link, landing on /partner/welcome (falls back to the
   * login page). The partner sets a password there and is forwarded to the
   * dashboard; on later clicks it forwards straight through, so the same link
   * doubles as a re-send.
   */
  portal_url: string;
  /** Their creditbanc.io referral link, if a slug has been issued. */
  referral_url?: string | null;
}

export function generate_referral_partner_invite_html(
  data: ReferralPartnerInviteData
): string {
  data = escape_email_strings(data);
  const { partner_name, portal_url } = data;
  const referral_url = data.referral_url || "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Credit Banc partner portal is ready</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #faf9f6;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    Track every client you refer to Credit Banc — where each file sits, in one place.
  </div>

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #faf9f6;">
    <tr>
      <td align="center" style="padding: 32px 12px;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(32, 37, 54, 0.08);">

          <tr>
            <td style="padding: 40px 40px 8px;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #10b981;">Referral Partner Program</p>
              <h1 style="margin: 0; font-size: 26px; line-height: 1.25; font-weight: 800; color: #202536;">Your partner portal is ready</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 16px 40px 0; font-size: 15px; line-height: 1.7; color: #475569;">
              <p style="margin: 0 0 16px;">Hi ${partner_name},</p>
              <p style="margin: 0 0 16px;">
                You now have a dashboard for every client you send to Credit Banc.
                Click below to set a password &mdash; then you'll see who you've
                referred and exactly where each file sits, from first contact
                through funding.
              </p>
              <p style="margin: 0 0 8px;">
                You keep doing what you already do. We handle the paperwork, the
                lenders and the follow-up.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 28px 40px 8px;" align="center">
              <a href="${portal_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 34px; border-radius: 10px; font-size: 16px; font-weight: 700;">
                Set my password
              </a>
              <p style="margin: 12px 0 0; font-size: 12px; color: #94a3b8;">
                This link signs you in automatically &mdash; you'll just choose a password, and after that you can log in any time.
              </p>
            </td>
          </tr>

          ${referral_url ? `
          <tr>
            <td style="padding: 24px 40px 0;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc; border-radius: 12px;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <p style="margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #64748b;">Your referral link</p>
                    <p style="margin: 0 0 4px; font-size: 14px; word-break: break-all;">
                      <a href="${referral_url}" style="color: #10b981; font-weight: 600; text-decoration: none;">${referral_url}</a>
                    </p>
                    <p style="margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                      Anyone who applies through this link is tracked to you automatically and shows up on your dashboard.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ``}

          <tr>
            <td style="padding: 28px 40px 40px; font-size: 14px; line-height: 1.7; color: #475569;">
              <p style="margin: 0;">
                Questions about a file? Reply here or reach us at
                <a href="mailto:support@creditbanc.io" style="color: #10b981;">support@creditbanc.io</a>.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px 32px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} Credit Banc. You're receiving this because you're a Credit Banc referral partner.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/** Sends the partner-portal invite. Throws on SMTP failure so the caller can report it. */
export async function send_referral_partner_invite(data: ReferralPartnerInviteData) {
  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  return await transporter.sendMail({
    from: `${from_name} <${from_email}>`,
    to: data.partner_email,
    subject: 'Set up your Credit Banc partner dashboard',
    html: generate_referral_partner_invite_html(data),
  });
}

/**
 * ============================================================================
 * STAFF INVITATION
 * ============================================================================
 * Sent when an admin invites a teammate from /admin/team. The link inside is a
 * CREDENTIAL — single-use, expiring, bound to this address and this role — so
 * the copy has to say so plainly enough that nobody forwards it.
 *
 * No hero image on purpose: an email that inlines a PNG throws at send time if
 * the file isn't committed, and this one has to arrive or the person can't
 * onboard at all ([[email_hero_images_must_be_committed]]).
 */
export interface StaffInviteData {
  /** Best available name for the greeting; falls back to the address. */
  invitee_name: string;
  invitee_email: string;
  /** Human-readable role, e.g. "Advisor" — not the raw role string. */
  role_label: string;
  /** /auth/join?token=… — forwards to the right onboarding form. */
  invite_url: string;
  /** Rendered expiry, e.g. "August 17, 2026". */
  expires_label: string;
  /** Who sent it, so the invitee knows this is expected. */
  invited_by?: string | null;
}

export function generate_staff_invite_html(data: StaffInviteData): string {
  data = escape_email_strings(data);
  const { invitee_name, role_label, invite_url, expires_label } = data;
  const invited_by = data.invited_by || '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Credit Banc team invitation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #faf9f6;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    Set up your ${role_label} account on the Credit Banc vault.
  </div>

  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #faf9f6;">
    <tr>
      <td align="center" style="padding: 32px 12px;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(32, 37, 54, 0.08);">

          <tr>
            <td style="padding: 40px 40px 8px;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #10b981;">Credit Banc Team</p>
              <h1 style="margin: 0; font-size: 26px; line-height: 1.25; font-weight: 800; color: #202536;">You've been invited as ${role_label}</h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 16px 40px 0; font-size: 15px; line-height: 1.7; color: #475569;">
              <p style="margin: 0 0 16px;">Hi ${invitee_name},</p>
              <p style="margin: 0 0 16px;">
                ${invited_by
                  ? `${invited_by} has invited you`
                  : `You've been invited`} to join the Credit Banc vault as
                <strong style="color: #202536;">${role_label}</strong>.
                Click below to create your account &mdash; it takes about a minute.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px 8px;" align="center">
              <a href="${invite_url}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 34px; border-radius: 10px; font-size: 16px; font-weight: 700;">
                Set up my account
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 40px 0;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc; border-radius: 12px;">
                <tr>
                  <td style="padding: 18px 20px; font-size: 13px; line-height: 1.7; color: #64748b;">
                    <p style="margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #64748b;">Please don't forward this</p>
                    <p style="margin: 0;">
                      This link works <strong>once</strong>, only for
                      <strong style="color: #202536;">${data.invitee_email}</strong>, and
                      expires on <strong style="color: #202536;">${expires_label}</strong>.
                      If it's expired by the time you get to it, ask whoever invited you to resend it.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px 40px; font-size: 14px; line-height: 1.7; color: #475569;">
              <p style="margin: 0 0 12px;">
                Weren't expecting this? You can ignore this email &mdash; nothing happens until the link is used.
              </p>
              <p style="margin: 0; font-size: 12px; color: #94a3b8; word-break: break-all;">
                Button not working? Paste this into your browser:<br>${invite_url}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px 32px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} Credit Banc.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/** Sends a staff invitation. Throws on SMTP failure so the caller can report it
 *  — an invitation that silently didn't send looks identical to one that did. */
export async function send_staff_invite(data: StaffInviteData) {
  const transporter = create_smtp_transporter();
  const from_email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const from_name = process.env.SMTP_FROM_NAME || 'Credit Banc';

  return await transporter.sendMail({
    from: `${from_name} <${from_email}>`,
    to: data.invitee_email,
    subject: `You're invited to Credit Banc as ${data.role_label}`,
    html: generate_staff_invite_html(data),
  });
}
