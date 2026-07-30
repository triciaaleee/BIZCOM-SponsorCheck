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

    // ---------- Annex A / Annex B reference ----------
    // Annex B partners = banned sponsors carrying a contract_ends date (active
    // AND lapsed — the panel shows lapsed ones with a Remove button).
    listContractPartners: function () {
      return Promise.resolve(
        sb().from('sponsors').select('*')
          .eq('category', 'banned')
          .not('contract_ends', 'is', null)
          .order('contract_ends', { ascending: true })
      ).then(unwrap).then(function (rows) { return rows || []; });
    }
  };

  window.AdminAPI = AdminAPI;
})();
