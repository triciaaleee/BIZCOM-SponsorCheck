/* ============================================================
   js/admin/supabase-client.js
   Creates the shared Supabase client for the admin console.

   Loaded on every admin page AFTER the supabase-js UMD bundle
   (the CDN <script> immediately above this one in each admin HTML).
   That bundle exposes a global `supabase` with createClient(); we
   build the project client from it and expose it as window.sb.

   SECURITY: the publishable key below is SAFE to ship in frontend
   code — it only grants the anon / authenticated roles, and Row
   Level Security in the database is what actually authorises every
   read and write. NEVER put the secret (sb_secret_...) key here.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://qapczpyehtyybwyqbfov.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8ILhe4rkSEoIgP5fpbIb2Q_7zoMytpH';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[supabase-client] supabase-js did not load. ' +
      'Check that the CDN <script> tag is present and ordered before this file.');
    return;
  }

  // window.sb is the one client every admin page shares. The auth session is
  // persisted (localStorage) so it survives navigation between admin pages.
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'sponsorcheck_supabase_auth'
    }
  });
})();
