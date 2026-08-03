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
                const { recordPipelineTransition } = await import('@/lib/pipeline-core');
                // Onboarding is now finished — advance the pipeline past the
                // onboarding stage into documents_requested. The dashboard's
                // auto-transition becomes a no-op once this runs.
                //
                // Recorded server-side: clients have no pipeline write access.
                // The vault was resolved by `user_id = user.id` just above, and
                // the status is fixed here rather than supplied by the caller.
                await recordPipelineTransition({
                    clientVaultId: vault.id,
                    newStatus: 'documents_requested',
                    note: 'Client completed onboarding (Profile & Contract)',
                    actorUserId: user.id,
                    actorRole: 'client',
                });
                console.log('✅ Pipeline status advanced past onboarding → documents_requested');
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
