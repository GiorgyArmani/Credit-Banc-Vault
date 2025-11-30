// src/lib/email.ts
import nodemailer from 'nodemailer';

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
  requested_documents: string[];
  login_url: string;
}

/**
 * Interface for advisor welcome email data
 */
export interface AdvisorWelcomeEmailData {
  advisor_name: string;
  advisor_email: string;
  advisor_password: string;
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
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Credit Banc Vault</h1>
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
              <table role="presentation" style="width: 100%; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; padding: 24px;">
                <tr>
                  <td>
                    <h3 style="margin: 0 0 20px; color: #ffffff; font-size: 20px; font-weight: 600;">🔐 Your Login Credentials</h3>
                    
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: rgba(255, 255, 255, 0.9); font-size: 14px; font-weight: 600;">Email:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 6px;">${client_email}</p>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: rgba(255, 255, 255, 0.9); font-size: 14px; font-weight: 600;">Temporary Password:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 6px;">${client_password}</p>
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

  const mail_options = {
    from: `${from_name} <${from_email}>`,
    to: data.client_email,
    subject: 'Welcome to Credit Banc Vault - Your Account is Ready!',
    text: text_content,
    html: html_content,
  };

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
 * Simpler version of client email - just welcome message, credentials, and login link
 */
export function generate_advisor_welcome_email_html(data: AdvisorWelcomeEmailData): string {
  const {
    advisor_name,
    advisor_email,
    advisor_password,
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
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
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

          <!-- Credentials Box -->
          <tr>
            <td style="padding: 0 40px 20px;">
              <table role="presentation" style="width: 100%; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; padding: 24px;">
                <tr>
                  <td>
                    <h3 style="margin: 0 0 20px; color: #ffffff; font-size: 20px; font-weight: 600;">🔐 Your Login Credentials</h3>
                    
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: rgba(255, 255, 255, 0.9); font-size: 14px; font-weight: 600;">Email:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 6px;">${advisor_email}</p>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                      <p style="margin: 0 0 4px; color: rgba(255, 255, 255, 0.9); font-size: 14px; font-weight: 600;">Password:</p>
                      <p style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; font-family: monospace; background-color: rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 6px;">${advisor_password}</p>
                    </div>

                    <div style="background-color: #fef3c7; border-radius: 8px; padding: 12px; margin-top: 16px;">
                      <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">
                        ⚠️ <strong>Important:</strong> Please change your password after logging in for security.
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
    advisor_password,
    login_url,
  } = data;

  return `
Welcome to Credit Banc Vault!

Hi ${advisor_name},

Your advisor account has been successfully created! You now have access to the Credit Banc Vault platform.

Your Login Credentials:
Email: ${advisor_email}
Password: ${advisor_password}

IMPORTANT: Please change your password after logging in for security.

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
