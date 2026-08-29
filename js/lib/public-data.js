/* ============================================================
   js/lib/public-data.js
   Read-only data layer for the PUBLIC pages (directory + checker).
   Every table it reads is anon-readable under RLS, so the publishable
   key is all it needs — there is no login on the public site.

   Exposes window.PublicData. Each method returns a Promise and throws
   on error (the page catches and shows a friendly state).
   Depends on window.sbPublic (js/lib/supabase-public.js), the
   anonymous client. Deliberately NOT window.sb: the public pages
   must never send an admin's JWT.
   ============================================================ */
(function () {
  'use strict';

  function sb() {
    if (!window.sbPublic) throw new Error('Supabase client not ready.');
    return window.sbPublic;
  }
  function unwrap(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }

  var PublicData = {
    listIndustries: function () {
      return Promise.resolve(
        sb().from('industries').select('code, display_name, sort_order').order('sort_order')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // Every sponsor (incl. lapsed Annex B partners); the caller filters/matches.
    // normalised is recomputed from the shared matcher on load so it can't drift.
    allSponsors: function () {
      return Promise.resolve(
        sb().from('sponsors').select('id, name, normalised, category, industry, ban_reason, notes, contract_ends').order('name')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    getSettings: function () {
      return Promise.resolve(
        sb().from('settings').select('*').maybeSingle()
      ).then(unwrap).then(function (row) { return row || {}; });
    },

    // Outreach snapshot keyed by sponsor id — { count, cooldown_started_at,
    // in_cooldown } — so the checker can derive live cap state.
    outreachSnapshot: function () {
      return Promise.resolve(
        sb().from('sponsor_outreach').select('sponsor_id, contact_count, cooldown_started_at, in_cooldown')
      ).then(unwrap).then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) {
          map[r.sponsor_id] = {
            count: r.contact_count || 0,
            cooldown_started_at: r.cooldown_started_at,
            in_cooldown: !!r.in_cooldown
          };
        });
        return map;
      });
    }
  };

  window.PublicData = PublicData;
})();
