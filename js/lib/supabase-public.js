/* ============================================================
   js/lib/supabase-public.js
   The ANONYMOUS Supabase client (window.sbPublic) for the PUBLIC
   pages: the sponsor directory and the sponsor checker.

   Loaded AFTER supabase-config.js. Public pages must NOT load
   supabase-client.js, and must never touch window.sb.

   WHY THIS IS SEPARATE FROM THE ADMIN CLIENT
   The public site has no login and needs none: every table it reads
   is anon-readable under RLS. This client therefore stores nothing
   and reads nothing from storage, so its requests always carry the
   publishable key.

   That matters because localStorage is scoped per ORIGIN, not per
   folder. Admin and public are served from the same origin, so a
   session-persisting client on a public page would pick up a signed-in
   admin's session and send THAT admin's JWT instead of the publishable
   key. The public pages would then silently stop being anonymous, and
   would break outright the moment the stored token could no longer be
   verified (an expired session, or a rotated JWT signing key), with
   PGRST301 "No suitable key or wrong key type".

   Keep persistSession, autoRefreshToken and detectSessionInUrl all
   false. They are the whole point of this file.
   ============================================================ */
(function () {
  'use strict';

  if (typeof window.createSupabaseClient !== 'function') {
    console.error('[supabase-public] supabase-config.js did not load. ' +
      'It must be ordered before this file.');
    return;
  }

  window.sbPublic = window.createSupabaseClient({
    persistSession: false,      // never read or write a session
    autoRefreshToken: false,    // nothing to refresh
    detectSessionInUrl: false   // never claim tokens from the URL fragment
  });
})();
