/* ============================================================
   js/lib/supabase-client.js
   The AUTHENTICATED Supabase client (window.sb) for the ADMIN console
   only.

   Loaded AFTER supabase-config.js, and ONLY by pages under admin/.
   The public pages load supabase-public.js instead — see the note in
   that file for why the two must not be shared.

   The auth session is persisted (localStorage) so an admin login
   survives navigation between admin pages.
   ============================================================ */
(function () {
  'use strict';

  if (typeof window.createSupabaseClient !== 'function') {
    console.error('[supabase-client] supabase-config.js did not load. ' +
      'It must be ordered before this file.');
    return;
  }

  window.sb = window.createSupabaseClient({
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'sponsorcheck_supabase_auth'
  });
})();
