// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseFetch = (input: any, init: any = {}) => {
  if (init?.body && !init.duplex) init.duplex = 'half';
  return fetch(input, init);
};

// En server, si puedes, usa SERVICE_ROLE para Storage+DB.
// Si no, mantén ANON pero ajusta RLS y policies.
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: supabaseFetch },
});
