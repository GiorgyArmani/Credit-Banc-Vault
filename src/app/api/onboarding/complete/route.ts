import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log(`✅ Completing onboarding for user: ${user.id}`);

        // Update user metadata to mark onboarding as complete
        const { error } = await supabase.auth.updateUser({
            data: { onboarding_complete: true }
        });

        if (error) {
            console.error('❌ Error updating user metadata:', error);
            return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
        }

        // Update Loan Pipeline status
        try {
            const { data: vault } = await supabase
                .from('client_data_vault')
                .select('id')
                .eq('user_id', user.id)
                .single();

            if (vault) {
                const { updateLoanStatus } = await import('@/app/actions/pipeline');
                await updateLoanStatus(vault.id, 'onboarding', 'Client completed onboarding (Profile & Contract)');
                console.log('✅ Pipeline status updated to "onboarding" (complete)');
            }
        } catch (pipeline_error) {
            console.error('⚠️ Error updating pipeline status (non-fatal):', pipeline_error);
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('❌ Complete onboarding error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
