import { NextRequest, NextResponse } from 'next/server';
import { send_support_ticket_email, SupportTicketEmailData } from '@/lib/email';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
    try {
        const data: SupportTicketEmailData = await req.json();

        if (!data.name || !data.email || !data.subject || !data.message) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const { allowed } = await checkRateLimit(req, RATE_LIMITS.supportTicket);
        if (!allowed) {
            return NextResponse.json(
                { error: 'Too many support requests. Please try again later.' },
                { status: 429 }
            );
        }

        await send_support_ticket_email(data);

        return NextResponse.json(
            { message: 'Support ticket sent successfully' },
            { status: 200 }
        );
    } catch (error: any) {
        console.error('Error sending support ticket:', error);
        return NextResponse.json(
            { error: 'Failed to send support ticket' },
            { status: 500 }
        );
    }
}
