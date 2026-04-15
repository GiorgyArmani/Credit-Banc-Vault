// src/lib/email.ts
import nodemailer from 'nodemailer';
import path from 'path';

/**
 * Interface for client welcome email data
 */
interface ClientWelcomeEmailData {
  client_name: string;
  client_email: string;
  client_password: string;
  advisor_name: string;
  advisor_email: string;
  advisor_phone?: string;
  advisor_cc_email?: string; // Optional: CC the advisor on the client welcome email
  requested_documents: string[];
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
  client_name: string;
  requested_documents: string[];
  login_url: string;
}

/**
 * Interface for advisor vault submission notification data
 */
export interface AdvisorVaultSubmissionData {
  advisor_name: string;
  advisor_email: string;
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
 * Interface for client vault submitted notification data
 */
export interface ClientVaultSubmittedData {
  client_name: string;
  client_email: string;
  advisor_name: string;
  company_name: string;
  login_url: string;
}

/**
 * Creates Nodemailer transporter with SMTP credentials
 * Uses Mailgun SMTP through LeadConnector
 */
function create_smtp_transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailgun.org',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Generates HTML for client welcome email
 * Beautiful, responsive email template with all necessary information
 */
export function generate_client_welcome_email_html(data: ClientWelcomeEmailData): string {
  const {
    client_name,
    client_email,
    client_password,
    advisor_name,
    advisor_email,
    advisor_phone,
    requested_documents,
    login_url,
  } = data;

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

          <!-- Credentials Box -->
          <tr>
            <td style="padding: 0 40px 20px;">
              <table role="presentation" style="width: 100%; background-color: #10b981; border-radius: 12px; padding: 24px;">
                <tr>
                  <td>
                    <h3 style="margin: 0 0 20px; color: #ffffff; font-size: 20px; font-weight: 600;">🔐 Your Login Credentials</h3>
                    
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: #ffffff; font-size: 14px; font-weight: 600;">Email:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: #0ea271; padding: 12px; border-radius: 6px;">${client_email}</p>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: #ffffff; font-size: 14px; font-weight: 600;">Temporary Password:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: #0ea271; padding: 12px; border-radius: 6px;">${client_password}</p>
                    </div>

                    <div style="background-color: #fef3c7; border-radius: 8px; padding: 12px; margin-top: 16px;">
                      <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">
                        ⚠️ <strong>Important:</strong> This is a temporary password. Please change it after logging in for the first time.
                      </p>
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
                <li style="margin-bottom: 12px;"><strong>Log in</strong> to your account using the credentials above</li>
                <li style="margin-bottom: 12px;"><strong>Change your password</strong> from Settings for security</li>
                <li style="margin-bottom: 12px;"><strong>Complete your profile</strong> with any remaining business information</li>
                <li style="margin-bottom: 12px;"><strong>Upload documents</strong> listed above</li>
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
    client_email,
    client_password,
    advisor_name,
    advisor_email,
    advisor_phone,
    requested_documents,
    login_url,
  } = data;

  return `
Welcome to Credit Banc Vault!

Hi ${client_name},

Your advisor ${advisor_name} has created your Credit Banc Vault account.

Your Login Credentials:
Email: ${client_email}
Temporary Password: ${client_password}

IMPORTANT: This is a temporary password. Please change it after logging in.

Login here: ${login_url}

${requested_documents.length > 0 ? `
Documents Needed:
${requested_documents.map(doc => `- ${doc}`).join('\n')}

You can upload these documents securely through your portal after logging in.
` : ''}

Next Steps:
1. Log in to your account
2. Change your password from Settings
3. Complete your profile
4. Upload required documents
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

  // CC the advisor on the welcome email if requested
  if (data.advisor_cc_email) {
    mail_options.cc = data.advisor_cc_email;
  }

  const result = await transporter.sendMail(mail_options);

  return result;
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
  const { advisor_name, client_name, requested_documents, login_url } = data;

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
              <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <h3 style="margin: 0 0 12px; color: #991b1b; font-size: 16px; font-weight: 700;">Requested Documents:</h3>
                <ul style="margin: 0; padding-left: 20px; color: #b91c1c; font-size: 15px; line-height: 1.6;">
                  ${requested_documents.map(doc => `<li style="margin-bottom: 8px;">${doc}</li>`).join('')}
                </ul>
              </div>
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

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `Action Required: New Documents Needed for ${data.client_name}`,
    html: html_content,
  };

  return await transporter.sendMail(mail_options);
}

/**
 * Generates HTML for advisor new document notification
 */
export function generate_new_document_uploaded_email_html(data: NewDocumentUploadedData): string {
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

  const mail_options = {
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

  return await transporter.sendMail(mail_options);
}

/**
 * Generates HTML for client vault submitted notification
 */
export function generate_client_vault_submitted_email_html(data: ClientVaultSubmittedData): string {
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

  const mail_options = {
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

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `New Vault Submission: ${data.client_name}`,
    html: html_content,
  };

  return await transporter.sendMail(mail_options);
}

/**
 * Generates HTML for underwriting vault ready notification
 */
export function generate_underwriting_vault_ready_html(data: UnderwritingVaultReadyData): string {
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
 * ============================================================================
 * LOAN FUNDED NOTIFICATION FUNCTIONS
 * ============================================================================
 */

export interface LoanFundedNotificationData {
  advisor_name: string;
  advisor_email: string;
  client_name: string;
  total_amount: string;
  lender: string;
  funding_date: string;
  login_url: string;
}

export function generate_loan_funded_notification_html(data: LoanFundedNotificationData): string {
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

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.advisor_email,
    subject: `🎉 Loan Funded for ${data.client_name}!`,
    html: html_content,
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
  login_url: string;
}

/**
 * Generates HTML for document rejection email
 */
export function generate_document_rejection_email_html(data: DocumentRejectionEmailData): string {
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

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: `Action Required: Please update your ${data.doc_label}`,
    html: html_content,
  };

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
