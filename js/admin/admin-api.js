/* ============================================================
   js/admin/admin-api.js
   The admin console's data layer — every Supabase read/write the
   admin pages make goes through here (Option B: a dedicated async
   API, no MOCK_DATA on admin pages).

   Each method returns a Promise and throws on error (the calling
   page catches and shows a toast). Row shapes match the tables in
   supabase/migrations/0001_init.sql. This module grows one section
   at a time as each admin page is wired.

   Depends on window.sb (js/lib/supabase-client.js), the authenticated client.
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

  // Sponsor names for a list of ids, as { id: name }.
  //
  // Chunked because PostgREST filters travel in the query string: a single
  // in.(...) holding a few hundred uuids builds a URL long enough for the
  // server to reject the request outright, which fails the whole read rather
  // than merely slowing it. 100 ids is roughly 3.7KB of URL, comfortably
  // inside the usual 8KB ceiling with the rest of the query alongside it.
  function namesByIds(ids) {
    var CHUNK = 100;
    var batches = [];
    for (var i = 0; i < ids.length; i += CHUNK) batches.push(ids.slice(i, i + CHUNK));
    return Promise.all(batches.map(function (batch) {
      return Promise.resolve(
        sb().from('sponsors').select('id, name').in('id', batch)
      ).then(unwrap);
    })).then(function (results) {
      var byId = {};
      results.forEach(function (rows) {
        (rows || []).forEach(function (s) { byId[s.id] = s.name; });
      });
      return byId;
    });
  }

  var AdminAPI = {
    isUniqueViolation: isUniqueViolation,

    // ---------- reference data ----------
    // Annex A (prohibited) + Annex B (restricted) categories, for the sponsor
    // form's picker and the Sponsors-page annex panels.
    listAnnexCategories: function () {
      return Promise.resolve(
        sb().from('annex_categories').select('id, annex, name, note, sort_order').order('annex').order('sort_order')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

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
    // params: { search, status:[], annexIds:[], industry:[], page, pageSize }
    // returns: { rows, total, page, totalPages, start }
    querySponsors: function (params) {
      params = params || {};
      var q = (params.search || '').trim();
      var statuses = params.status || [];
      var annexIds = params.annexIds || [];
      var industries = params.industry || [];
      var pageSize = params.pageSize || 50;
      var today = todayISODate();

      // Apply the shared filters (search + status/annex + industry + exclude
      // lapsed Annex B partners) to either a count query or a data query.
      function applyFilters(query) {
        query = query.or('contract_ends.is.null,contract_ends.gte.' + today);
        if (q) query = query.ilike('name', '%' + escapeLike(q) + '%');
        // Status is one row of pills on the page but two columns here: Annex A
        // and Annex B rows share category 'prohibited', so the annex pills
        // arrive as annex_categories ids and match on annex_category_id. The
        // two are OR-ed so "Approved + Annex B" returns both, not neither.
        var clauses = [];
        if (statuses.length) clauses.push('category.in.(' + statuses.join(',') + ')');
        if (annexIds.length) clauses.push('annex_category_id.in.(' + annexIds.join(',') + ')');
        if (clauses.length) query = query.or(clauses.join(','));
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

    // One sponsor by its normalised lookup key, or null. Used by the Annex B
    // "Add" panel to tell "this company is new" from "this company is already
    // on the database under another status", so the second case can offer to
    // convert the existing row instead of dead-ending on a unique violation.
    findByNormalised: function (normalised) {
      return Promise.resolve(
        sb().from('sponsors').select('*').eq('normalised', normalised).maybeSingle()
      ).then(unwrap);
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
        sb().from('sponsors').select('id, name, normalised, category, industry, annex_category_id, contract_ends').order('name')
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // Bulk insert new sponsors, skipping any whose normalised name already exists
    // (ON CONFLICT DO NOTHING). Returns the rows actually inserted (with ids).
    bulkAddSponsors: function (payloads) {
      return Promise.resolve(
        sb().from('sponsors').upsert(payloads, { onConflict: 'normalised', ignoreDuplicates: true }).select()
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // ---------- outreach: every company currently in cooldown ----------
    // Reads the sponsor_outreach view for in-cooldown rows and derives each
    // cooldown's end date (started_at + cooldown_days), soonest first.
    //
    // The view's `in_cooldown` is the only test applied, and it is evaluated
    // server-side against the database clock. Nothing here compares calendar
    // months, so the browser's timezone cannot disagree with Postgres about
    // which cooldowns count. returns: [{ id, name, ends:Date }]
    activeCooldowns: function () {
      var self = this;
      return self.getSettings().then(function (settings) {
        var cooldownDays = settings.cooldown_days || 30;
        return Promise.resolve(
          sb().from('sponsor_outreach')
            .select('sponsor_id, cooldown_started_at, in_cooldown')
            .eq('in_cooldown', true)
        ).then(unwrap).then(function (rows) {
          var DAY = 86400000;

          var active = (rows || []).map(function (r) {
            return {
              id: r.sponsor_id,
              ends: new Date(new Date(r.cooldown_started_at).getTime() + cooldownDays * DAY)
            };
          }).sort(function (a, b) { return a.ends - b.ends; });

          if (!active.length) return [];

          // Every in-cooldown company needs a name now that none are filtered
          // out, so the chunking in namesByIds is doing real work here: this
          // list is bounded only by how many companies are in cooldown at once.
          return namesByIds(active.map(function (x) { return x.id; })).then(function (nameById) {
            return active.map(function (x) {
              return { id: x.id, name: nameById[x.id] || '(unknown)', ends: x.ends };
            });
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
    // place the cap/cooldown logic lives).
    //
    // Pass submissionId to scope the contact to a club submission: the RPC then
    // stamps the submission_sponsors line item so the same company cannot be
    // contacted twice for the same event, and records which event it was for.
    //
    // Returns 'logged' | 'capped' | 'skipped'
    //       | 'duplicate'    (already logged for this submission)
    //       | 'not_recorded' (company is not on this submission yet).
    logOutreach: function (sponsorId, note, submissionId) {
      return Promise.resolve(
        sb().rpc('log_outreach', {
          p_sponsor_id: sponsorId,
          p_note: note || null,
          p_submission_id: submissionId || null
        })
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

    // Every company filed under one annex category, alphabetically. Backs the
    // Sponsors page's Annex A card, which names the Board of Trustees companies
    // rather than listing a type. Only the categories that name their members
    // are read this way, so the result set stays small.
    listByAnnexCategory: function (annexCategoryId) {
      return Promise.resolve(
        sb().from('sponsors').select('id, name, industry, contract_ends')
          .eq('annex_category_id', annexCategoryId)
          .order('name')
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

    getSubmission: function (id) {
      return Promise.resolve(
        sb().from('submissions').select('*').eq('id', id).maybeSingle()
      ).then(unwrap);
    },

    // Permanent: submissions carry no soft-delete flag, so the row is gone.
    // RLS (submissions_all) already allows this for any signed-in admin.
    // The submission_sponsors line items go with it (FK on delete cascade).
    deleteSubmission: function (id) {
      return Promise.resolve(
        sb().from('submissions').delete().eq('id', id)
      ).then(function (res) { if (res.error) throw res.error; });
    },

    // Statuses that consume an event's sponsor cap. The server's
    // counts_toward_cap() (migration 0013) is the authority; this mirrors it so
    // the page can show the same numbers before it commits anything. Keep the
    // two in step.
    countsTowardCap: function (status) {
      return status === 'approved' || status === 'alumni';
    },

    // ---------- submission line items (the vetting link) ----------
    // Every company recorded against a submission, oldest wave first. Drives
    // the "already counted" set on Vet & Upload so a re-uploaded company is not
    // double-counted, the per-company outreach lock, and the wave history on Home.
    listSubmissionSponsors: function (submissionId) {
      return Promise.resolve(
        sb().from('submission_sponsors')
          .select('id, wave, company_name, normalised, sponsor_id, status, ' +
                  'recorded_by, recorded_at, outreach_logged_at, outreach_logged_by')
          .eq('submission_id', submissionId)
          .order('wave', { ascending: true })
          .order('company_name', { ascending: true })
      ).then(unwrap).then(function (rows) { return rows || []; });
    },

    // Drop one company from a submission. The only write the client makes to
    // submission_sponsors directly: 0012 withholds insert and update so every
    // addition goes through record_submission_wave, but grants delete outright
    // "so an admin can drop a company recorded against the wrong submission".
    //
    // The trigger on the table re-derives sponsor_count / listed_count /
    // wave_count, so the caller only has to re-read the submission afterwards.
    // Deleting a row whose outreach is already logged would leave the
    // outreach_log entry behind with nothing on the event pointing at it, so
    // the page refuses that case rather than the database: the log is history,
    // and history is not edited from here.
    deleteSubmissionSponsor: function (id) {
      return Promise.resolve(
        sb().from('submission_sponsors').delete().eq('id', id)
      ).then(function (res) { if (res.error) throw res.error; });
    },

    // Record one wave of a club's list against a submission. The event cap lives
    // server-side in record_submission_wave (see 0012), which de-dupes the
    // payload, skips companies already on the submission, and rejects the whole
    // wave if it would push the total past the cap for the event size.
    // Only approved and alumni companies consume the cap; prohibited, closed,
    // cooldown and not-yet-vetted ones are stored for the record but not counted.
    // entries: [{ company_name, normalised, sponsor_id, status }]
    // returns: { wave, added, refreshed, skipped, counted, listed, cap, event_size }
    recordSubmissionWave: function (submissionId, entries) {
      return Promise.resolve(
        sb().rpc('record_submission_wave', {
          p_submission_id: submissionId,
          p_entries: entries || []
        })
      ).then(unwrap);
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
