/* ============================================================
   js/admin/admin-api.js
   The admin console's data layer — every Supabase read/write the
   admin pages make goes through here (Option B: a dedicated async
   API, no MOCK_DATA on admin pages).

   Each method returns a Promise and throws on error (the calling
   page catches and shows a toast). Row shapes match the tables in
   supabase/migrations/0001_init.sql. This module grows one section
   at a time as each admin page is wired.

   Depends on window.sb (js/admin/supabase-client.js).
   ============================================================ */
(function () {
  'use strict';

  function sb() {
    if (!window.sb) throw new Error('Supabase client not ready.');
    return window.sb;
  }

  // Unwrap a supabase-js { data, error } response — throw on error.
  function unwrap(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }

  // Local calendar date as YYYY-MM-DD, for date-only column comparisons.
  function todayISODate() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // Escape LIKE/ILIKE wildcards so a user's search is treated literally.
  function escapeLike(s) {
    return String(s).replace(/([\\%_])/g, '\\$1');
  }

  // True for a Postgres unique-constraint violation (duplicate normalised name).
  function isUniqueViolation(e) {
    return !!(e && (e.code === '23505' || /duplicate key|already exists/i.test(e.message || '')));
  }

  var AdminAPI = {
    isUniqueViolation: isUniqueViolation,

    // ---------- reference data ----------
    listIndustries: function () {
      return Promise.resolve(
        sb().from('industries').select('code, display_name, sort_order').order('sort_order')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    getSettings: function () {
      return Promise.resolve(
        sb().from('settings').select('*').maybeSingle()
      ).then(unwrap).then(function (row) { return row || {}; });
    },

    // ---------- sponsors: paged list ----------
    // Mirrors the old in-memory querySponsors: name search, status + industry
    // multi-select filters, alphabetical, 50/page — but server-side, so the
    // page only ever holds one slice. Lapsed Annex B partners (contract_ends in
    // the past) are excluded here; they live only in the Annex B panel.
    // params: { search, status:[], industry:[], page, pageSize }
    // returns: { rows, total, page, totalPages, start }
    querySponsors: function (params) {
      params = params || {};
      var q = (params.search || '').trim();
      var statuses = params.status || [];
      var industries = params.industry || [];
      var pageSize = params.pageSize || 50;
      var today = todayISODate();

      // Apply the shared filters (search + status + industry + exclude lapsed
      // Annex B partners) to either a count query or a data query.
      function applyFilters(query) {
        query = query.or('contract_ends.is.null,contract_ends.gte.' + today);
        if (q) query = query.ilike('name', '%' + escapeLike(q) + '%');
        if (statuses.length) query = query.in('category', statuses);
        if (industries.length) query = query.in('industry', industries);
        return query;
      }

      // 1. Count first (HEAD request, no rows) so the page can be clamped before
      //    asking for a range — PostgREST returns a 416 for a range past the end,
      //    so we must know the total up front rather than catch-and-refetch.
      return Promise.resolve(
        applyFilters(sb().from('sponsors').select('id', { count: 'exact', head: true }))
      ).then(function (countRes) {
        if (countRes.error) throw countRes.error;
        var total = countRes.count || 0;
        var totalPages = Math.max(1, Math.ceil(total / pageSize));
        var page = Math.min(Math.max(1, params.page || 1), totalPages);
        var start = (page - 1) * pageSize;

        if (total === 0) {
          return { rows: [], total: 0, page: 1, totalPages: 1, start: 0 };
        }

        // 2. Fetch just this page's slice.
        return Promise.resolve(
          applyFilters(sb().from('sponsors').select('*'))
            .order('name', { ascending: true })
            .range(start, start + pageSize - 1)
        ).then(function (dataRes) {
          if (dataRes.error) throw dataRes.error;
          return { rows: dataRes.data || [], total: total, page: page, totalPages: totalPages, start: start };
        });
      });
    },

    // ---------- sponsors: writes ----------
    addSponsor: function (payload) {
      return Promise.resolve(
        sb().from('sponsors').insert(payload).select().maybeSingle()
      ).then(unwrap);
    },

    deleteSponsor: function (id) {
      return Promise.resolve(
        sb().from('sponsors').delete().eq('id', id)
      ).then(function (res) { if (res.error) throw res.error; });
    },

    getSponsor: function (id) {
      return Promise.resolve(
        sb().from('sponsors').select('*').eq('id', id).maybeSingle()
      ).then(unwrap);
    },

    updateSponsor: function (id, patch) {
      return Promise.resolve(
        sb().from('sponsors').update(patch).eq('id', id).select().maybeSingle()
      ).then(unwrap);
    },

    // All sponsors (incl. lapsed Annex B partners) for client-side matching on
    // the Vet & Upload page. The caller recomputes `normalised` from the shared
    // matcher on load so the lookup key can't drift.
    allSponsors: function () {
      return Promise.resolve(
        sb().from('sponsors').select('id, name, normalised, category, industry, ban_reason, contract_ends').order('name')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // Bulk insert new sponsors, skipping any whose normalised name already exists
    // (ON CONFLICT DO NOTHING). Returns the rows actually inserted (with ids).
    bulkAddSponsors: function (payloads) {
      return Promise.resolve(
        sb().from('sponsors').upsert(payloads, { onConflict: 'normalised', ignoreDuplicates: true }).select()
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // ---------- outreach: cooldowns ending this calendar month ----------
    // Reads the sponsor_outreach view for in-cooldown rows, derives each
    // cooldown's end date (started_at + cooldown_days) and keeps only those
    // ending in the current month. returns: [{ id, name, ends:Date }]
    cooldownsEndingThisMonth: function () {
      var self = this;
      return self.getSettings().then(function (settings) {
        var cooldownDays = settings.cooldown_days || 30;
        return Promise.resolve(
          sb().from('sponsor_outreach')
            .select('sponsor_id, cooldown_started_at, in_cooldown')
            .eq('in_cooldown', true)
        ).then(unwrap).then(function (rows) {
          rows = rows || [];
          if (!rows.length) return [];
          var ids = rows.map(function (r) { return r.sponsor_id; });
          return Promise.resolve(
            sb().from('sponsors').select('id, name').in('id', ids)
          ).then(unwrap).then(function (sponsors) {
            var nameById = {};
            (sponsors || []).forEach(function (s) { nameById[s.id] = s.name; });
            var now = new Date();
            var DAY = 86400000;
            return rows.map(function (r) {
              var ends = new Date(new Date(r.cooldown_started_at).getTime() + cooldownDays * DAY);
              return { id: r.sponsor_id, name: nameById[r.sponsor_id] || '(unknown)', ends: ends };
            }).filter(function (x) {
              return x.ends.getFullYear() === now.getFullYear() && x.ends.getMonth() === now.getMonth();
            }).sort(function (a, b) { return a.ends - b.ends; });
          });
        });
      });
    },

    // Live cap/cooldown state for one sponsor, mirroring the old window.Caps.state
    // shape. contact_count + in_cooldown come straight from the sponsor_outreach
    // view (which already resets the count to 0 once a cooldown has elapsed).
    getOutreachState: function (sponsorId) {
      return this.getSettings().then(function (settings) {
        var cap = settings.outreach_cap || 10;
        var cooldownDays = settings.cooldown_days || 30;
        return Promise.resolve(
          sb().from('sponsor_outreach')
            .select('contact_count, cooldown_started_at, in_cooldown')
            .eq('sponsor_id', sponsorId).maybeSingle()
        ).then(unwrap).then(function (row) {
          var count = row ? (row.contact_count || 0) : 0;
          var inCooldown = row ? !!row.in_cooldown : false;
          var cooldownEndsAt = null;
          if (row && row.cooldown_started_at && inCooldown) {
            cooldownEndsAt = new Date(new Date(row.cooldown_started_at).getTime() + cooldownDays * 86400000);
          }
          var atCap = count >= cap;
          return {
            count: count, cap: cap, cooldownDays: cooldownDays,
            inCooldown: inCooldown, cooldownEndsAt: cooldownEndsAt,
            atCap: atCap, approaching: !inCooldown && !atCap && count >= cap - 2
          };
        });
      });
    },

    // Outreach snapshot for every sponsor, keyed by id —
    // { count, cooldown_started_at, in_cooldown } — used to derive live cap state
    // on the Vet & Upload page.
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
    },

    // Record one outreach against a sponsor via the server-side rule (the single
    // place the cap/cooldown logic lives). Returns 'logged' | 'capped' | 'skipped'.
    logOutreach: function (sponsorId, note) {
      return Promise.resolve(
        sb().rpc('log_outreach', { p_sponsor_id: sponsorId, p_note: note || null })
      ).then(unwrap);
    },

    // ---------- Annex A / Annex B reference ----------
    // Annex B partners = prohibited sponsors carrying a contract_ends date (active
    // AND lapsed — the panel shows lapsed ones with a Remove button).
    listContractPartners: function () {
      return Promise.resolve(
        sb().from('sponsors').select('*')
          .eq('category', 'prohibited')
          .not('contract_ends', 'is', null)
          .order('contract_ends', { ascending: true })
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // ---------- submissions (admin Home calendar) ----------
    // Admin-only under RLS (the public checker emails BIZCOM; it doesn't insert).
    listSubmissions: function () {
      return Promise.resolve(
        sb().from('submissions').select('*').order('submitted_at', { ascending: false })
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    createSubmission: function (payload) {
      return Promise.resolve(
        sb().from('submissions').insert(payload).select().maybeSingle()
      ).then(unwrap);
    },

    updateSubmission: function (id, patch) {
      return Promise.resolve(
        sb().from('submissions').update(patch).eq('id', id).select().maybeSingle()
      ).then(unwrap);
    },

    // Permanent: submissions carry no soft-delete flag, so the row is gone.
    // RLS (submissions_all) already allows this for any signed-in admin.
    deleteSubmission: function (id) {
      return Promise.resolve(
        sb().from('submissions').delete().eq('id', id)
      ).then(function (res) { if (res.error) throw res.error; });
    },

    // ---------- admins (team) — read: any admin; write: super-admin (RLS) ----------
    listAdmins: function () {
      return Promise.resolve(
        // user_id is NULL until the admin's first sign-in links their auth
        // account (see link_admin_user in 0008), which drives "No login yet".
        sb().from('admins').select('email, name, role, user_id').order('email')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    inviteAdmin: function (payload) {
      return Promise.resolve(
        sb().from('admins').insert(payload).select().maybeSingle()
      ).then(unwrap);
    },

    updateAdminName: function (email, name) {
      return Promise.resolve(
        sb().from('admins').update({ name: name }).eq('email', email).select().maybeSingle()
      ).then(unwrap);
    },

    // Server-side RPC, not a plain delete: it removes the `admins` row AND the
    // person's Supabase Auth login, which the publishable key cannot touch on
    // its own. Also enforces the "not the super-admin, not yourself" rules.
    // See 0010_remove_admin_deletes_login.sql.
    removeAdmin: function (email) {
      return Promise.resolve(
        sb().rpc('remove_admin', { p_email: email })
      ).then(function (res) { if (res.error) throw res.error; });
    },

    // Atomically moves the single super-admin seat (server-side RPC — demotes the
    // current holder first, so the one-super-admin index is never violated).
    transferSuperAdmin: function (targetEmail) {
      return Promise.resolve(
        sb().rpc('transfer_super_admin', { p_target_email: targetEmail })
      ).then(function (res) { if (res.error) throw res.error; });
    },

    // ---------- settings — read: public; update: super-admin (RLS) ----------
    updateSettings: function (patch) {
      return Promise.resolve(
        sb().from('settings').update(patch).eq('id', true).select().maybeSingle()
      ).then(unwrap);
    }
  };

  window.AdminAPI = AdminAPI;
})();
