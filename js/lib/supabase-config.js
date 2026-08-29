/* ============================================================
   js/lib/supabase-config.js
   The project's Supabase connection details, in ONE place, plus the
   factory both client files use to build a client from them.

   Loaded on every page AFTER the supabase-js UMD bundle (the CDN
   <script> just above this one) and BEFORE whichever client file the
   page needs:

     public pages  ->  supabase-config.js + supabase-public.js
     admin pages   ->  supabase-config.js + supabase-client.js

   This file creates NO client of its own. That is deliberate: a page
   only ever gets the one client it is entitled to, so the public site
   cannot reach for an authenticated client by accident.

   SECURITY: the publishable key below is SAFE to ship in frontend
   code — it only grants the anon / authenticated roles, and Row
   Level Security in the database is what actually authorises every
   read and write. NEVER put the secret (sb_secret_...) key here.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://qapczpyehtyybwyqbfov.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8ILhe4rkSEoIgP5fpbIb2Q_7zoMytpH';

  // Build a client with the given auth behaviour. Returns null (and logs)
  // if the CDN bundle is missing, so the caller can bail cleanly instead
  // of throwing on `undefined.createClient`.
  window.createSupabaseClient = function (authOptions) {
    if (!window.supabase || !window.supabase.createClient) {
      console.error('[supabase-config] supabase-js did not load. ' +
        'Check that the CDN <script> tag is present and ordered before this file.');
      return null;
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: authOptions
    });
  };
})();
