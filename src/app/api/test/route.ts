// src/app/api/test/route.ts
import { NextResponse } from 'next/server';
import { send_client_welcome_email } from '@/lib/email';

export async function GET(request: Request) {
  try {
    // Debug info
    console.log('🔍 SMTP Configuration:');
    console.log('  - Host:', process.env.SMTP_HOST);
    console.log('  - Port:', process.env.SMTP_PORT);
    console.log('  - User:', process.env.SMTP_USER);
    console.log('  - Pass exists:', !!process.env.SMTP_PASS);
    console.log('  - From:', process.env.SMTP_FROM_EMAIL);

    const result = await send_client_welcome_email({
      client_name: 'Test Client',
      client_email: 'jorgem@creditbanc.io',
      client_password: 'CBvault2025!',
      advisor_name: 'Jane Smith',
      advisor_email: 'jane@creditbanc.io',
      advisor_phone: '(555) 123-4567',
      requested_documents: [
        'Driver\'s License',
        'Business Bank Statements',
        'Tax Returns'
      ],
      login_url: 'https://credit-banc-vault.vercel.app/auth/login',
    });

    return NextResponse.json({
      success: true,
      message: '✅ Email sent successfully!',
      result: result,
    });
  } catch (error: any) {
    console.error('❌ Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      details: error.stack,
      config: {
        has_host: !!process.env.SMTP_HOST,
        has_user: !!process.env.SMTP_USER,
        has_pass: !!process.env.SMTP_PASS,
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.SMTP_USER,
      }
    }, { status: 500 });
  }
}