/* ============================================================
   js/lib/matcher-core.js
   The one sponsor-matching module, shared by the admin Vet & Upload
   page and the public checker. Pure: it takes the data it needs as
   arguments (no MOCK_DATA / Caps / Bans globals), so both surfaces
   feed it live Supabase data.

   Exposes window.Matcher = { normalise, checkOne, checkBatch }.
     normalise(name)                      -> the canonical lookup key
     checkOne(name, industry?, ctx)       -> single result
     checkBatch(rows, ctx)                -> array of results (sync)
   where ctx = {
     sponsors: [{ id, name, normalised, category, industry, contract_ends,
                   annex, annexName }],   // annex fields via attachAnnex()
     capState: function (sponsorId) -> { count, cap, inCooldown, cooldownEndsAt, approaching, ... },
     today:    'YYYY-MM-DD'
   }

   STATUS values: clear | cooldown | alumni | prohibited | restricted |
                  closed | unverified | duplicate.

   Annex A companies report "prohibited" (remove them from the list); Annex B
   report "restricted" (KEEP them on the list, BIZCOM decides). The annex comes
   from sponsors.annex_category_id, resolved onto each sponsor by attachAnnex().
   ============================================================ */
(function () {
  'use strict';

  // ---- normalise: the single source of truth for the lookup key ----
  // Legal-entity / boilerplate suffixes only. "Singapore" is deliberately NOT
  // here (it's part of real names like "Singapore Pools"); parenthesised locales
  // like "(Singapore)" are removed by the paren pass below.
  var SUFFIXES = [
    'pte ltd', 'pte. ltd.', 'private limited', 'pte ltd.', 'pl',
    'llp', 'l.l.p.', 'inc', 'corp', 'corporation', 'ltd', 'limited',
    'co', 'co.'
  ];

  function normalise(name) {
    if (!name) return '';
    var n = String(name).toLowerCase();
    n = n.replace(/\([^)]*\)/g, ' ');
    n = n.replace(/&/g, ' and ');
    n = n.replace(/[^\w\s]/g, ' ');
    SUFFIXES.forEach(function (s) {
      var re = new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      n = n.replace(re, ' ');
    });
    n = n.replace(/\s+/g, ' ').trim();
    return n;
  }

  // ---- tier-2 industry keyword classifier ----
  var KEYWORDS = {
    food_beverage: ['tea', 'coffee', 'cafe', 'café', 'bistro', 'kitchen', 'bakery', 'restaurant', 'food', 'noodle', 'ramen', 'sushi', 'eats', 'mart'],
    apparel_accessories: ['apparel', 'fashion', 'wear', 'clothing', 'shoe', 'bag'],
    beauty_personal_care: ['beauty', 'cosmetic', 'skincare', 'salon', 'spa'],
    health_wellness: ['gym', 'fitness', 'yoga', 'pilates', 'clinic', 'wellness'],
    education_services: ['studio', 'academy', 'tuition', 'learn', 'tutor', 'school'],
    tech_electronics: ['electronics', 'tech', 'digital', 'computer', 'gaming'],
    activities_experiences: ['climb', 'bouldering', 'escape', 'axe', 'paint', 'art jam'],
    entertainment_leisure: ['cinema', 'theatre', 'ktv', 'karaoke', 'bowling', 'arcade'],
    transport_mobility: ['ride', 'taxi', 'bike', 'rental', 'mobility', 'transport']
  };
  function classifyByKeyword(name) {
    var n = name.toLowerCase();
    for (var code in KEYWORDS) {
      var stems = KEYWORDS[code];
      for (var i = 0; i < stems.length; i++) {
        if (n.indexOf(stems[i]) !== -1) return code;
      }
    }
    return null;
  }

  // ---- trigram similarity (Jaccard), approximates pg_trgm ----
  function trigrams(s) {
    s = '  ' + s + ' ';
    var set = new Set();
    for (var i = 0; i < s.length - 2; i++) set.add(s.substr(i, 3));
    return set;
  }
  function similarity(a, b) {
    if (!a || !b) return 0;
    var ta = trigrams(a), tb = trigrams(b), intersect = 0;
    ta.forEach(function (g) { if (tb.has(g)) intersect++; });
    var union = ta.size + tb.size - intersect;
    return union === 0 ? 0 : intersect / union;
  }

  // Resolve each sponsor's annex_category_id against the annex_categories
  // rows, stamping `annex` ('A'|'B') and `annexName` onto the sponsor. Callers
  // run this once after loading, alongside the normalise() pass, so the matcher
  // never has to carry a lookup map around. Safe to call twice.
  function attachAnnex(sponsors, categories) {
    var byId = {};
    (categories || []).forEach(function (c) { byId[c.id] = c; });
    (sponsors || []).forEach(function (s) {
      var c = s.annex_category_id ? byId[s.annex_category_id] : null;
      s.annex = c ? c.annex : null;
      s.annexName = c ? c.name : null;
    });
    return sponsors;
  }

  // Is a time-boxed Annex B contract still running? Annex A is permanent and
  // never consults contract_ends, so only Annex B can lapse.
  // ISO date strings (YYYY-MM-DD) compare correctly lexicographically.
  function isLiveContract(s, today) {
    if (!s || !s.contract_ends) return true;
    return String(s.contract_ends) >= today;
  }

  // Plain-word standing of a sponsor, for the near-miss note below. A lapsed
  // Annex B partner reads as approachable, so the note never overstates it.
  function describeCategory(s, today) {
    switch (s.category) {
      case 'prohibited':
        if (s.annex === 'B') return isLiveContract(s, today) ? 'restricted' : 'partnership ended';
        return 'prohibited';
      case 'closed':     return 'closed';
      case 'alumni':     return 'alumni-affiliated';
      default:           return 'previously approved';
    }
  }

  // Used by approved companies and by Annex B partners whose contract has
  // lapsed, which are indistinguishable from the club's point of view.
  var CLEAR_REASON = 'Previously approved by BIZCOM';

  function formatDate(d) {
    if (!d) return '';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function checkOne(inputName, providedIndustry, ctx) {
    var normalisedInput = normalise(inputName);
    var sponsors = ctx.sponsors;

    // 1. Exact match on the shared normalise key.
    var matched = sponsors.find(function (s) { return s.normalised === normalisedInput; });

    // 2. Fuzzy fallback; keep the best candidate + score for a "possible match".
    var fuzzy = null, best = { score: 0, sponsor: null };
    if (!matched && normalisedInput.length >= 3) {
      sponsors.forEach(function (s) {
        var score = similarity(normalisedInput, s.normalised);
        if (score > best.score) best = { score: score, sponsor: s };
      });
      if (best.score >= 0.55) fuzzy = best.sponsor;
    }

    // 3. Industry.
    var industry = providedIndustry || null, classificationSource = null;
    if (industry) classificationSource = 'provided';
    else if (matched) { industry = matched.industry; classificationSource = 'inherited'; }
    else if (fuzzy) { industry = fuzzy.industry; classificationSource = 'inherited'; }
    else {
      var kw = classifyByKeyword(inputName);
      if (kw) { industry = kw; classificationSource = 'keyword'; }
      else { industry = 'other'; classificationSource = 'fallback'; }
    }

    // 4. Status.
    var effectiveMatch = matched || fuzzy;
    var matchType = matched ? 'exact' : (fuzzy ? 'fuzzy' : null);
    var capSt = effectiveMatch ? ctx.capState(effectiveMatch.id) : null;
    var outreachCount = capSt ? capSt.count : 0;

    var suggestion = null;
    if (!effectiveMatch && best.sponsor && best.score >= 0.4) {
      suggestion = {
        id: best.sponsor.id, name: best.sponsor.name,
        category: best.sponsor.category,
        annex: best.sponsor.annex || null,   // so a near-miss can be labelled Restricted, not Prohibited
        score: Math.round(best.score * 100)
      };
    }

    var status, reason;
    if (effectiveMatch) {
      switch (effectiveMatch.category) {
        case 'prohibited':
          // The umbrella category. The annex letter is what the club acts on.
          if (effectiveMatch.annex === 'B') {
            if (!isLiveContract(effectiveMatch, ctx.today)) {
              // A BIZCOM partnership that has run out. Nothing restricts the
              // company any more, so it reads exactly like any other clear row:
              // the club does not need to know a partnership ever existed.
              status = 'clear';
              reason = CLEAR_REASON;
            } else {
              status = 'restricted';
              reason = 'Annex B, ' + (effectiveMatch.annexName || 'restricted') +
                       (effectiveMatch.contract_ends
                         ? ' until ' + formatDate(new Date(effectiveMatch.contract_ends))
                         : '');
            }
          } else {
            status = 'prohibited';
            reason = 'Annex A, ' + (effectiveMatch.annexName || 'prohibited');
          }
          break;
        case 'closed':
          status = 'closed';
          reason = 'Company has closed';
          break;
        case 'alumni':
          status = 'alumni';
          reason = 'Alumni-affiliated, requires OAR clearance';
          break;
        case 'approved':
          if (capSt.inCooldown) {
            status = 'cooldown';
            reason = 'Outreach cap reached (' + capSt.count + ' of ' + capSt.cap +
                     '). In cooldown until ' + formatDate(capSt.cooldownEndsAt) + '.';
          } else {
            // Nearing the cap used to report 'caution'. Dropped deliberately:
            // the company is still contactable, so the club's next move is the
            // same as 'clear'. Cap management is BIZCOM's job, not the club's.
            // (capState.approaching is still used by the admin vetting screen.)
            status = 'clear';
            reason = CLEAR_REASON;
          }
          break;
        default:
          status = 'clear';
          reason = 'Match found, no restrictions';
      }
    } else if (suggestion) {
      // Close, but under the match threshold. Deliberately NOT given a status of
      // its own: inheriting the lookalike's status would risk calling a company
      // prohibited on a 45% guess, and a seventh status would need its own pill,
      // filter chip, stat tile and legend entry for a rare case. It stays
      // unverified (BIZCOM vets it either way) and the near-miss is named in the
      // reason, which the results table and the CSV export both show.
      status = 'unverified';
      reason = 'Close to "' + best.sponsor.name + '" (' +
               describeCategory(best.sponsor, ctx.today) + ', ' + suggestion.score + '% similar)';
    } else {
      status = 'unverified';
      reason = 'Not found in database. BIZCOM will need to vet this company.';
    }

    return {
      input: inputName,
      status: status,
      matched: matched ? matched.name : (fuzzy ? fuzzy.name + ' (similar)' : null),
      matchedId: effectiveMatch ? effectiveMatch.id : null,
      matchedName: effectiveMatch ? effectiveMatch.name : null,
      matchedCategory: effectiveMatch ? effectiveMatch.category : null,
      matchedAnnex: effectiveMatch ? (effectiveMatch.annex || null) : null,
      matchType: matchType,
      matchScore: matched ? 100 : (fuzzy ? Math.round(best.score * 100) : null),
      suggestion: suggestion,
      industry: industry,
      classificationSource: classificationSource,
      reason: reason,
      outreachCount: outreachCount
    };
  }

  // Synchronous. Marks duplicates against earlier rows in the same list.
  function checkBatch(rows, ctx) {
    var seenAt = new Map(), dupesOfCanonical = new Map(), results = [];

    rows.forEach(function (row, i) {
      var norm = normalise(row.name), oneIdx = i + 1;
      if (seenAt.has(norm)) {
        var firstIdx = seenAt.get(norm);
        results.push({
          input: row.name, status: 'duplicate', matched: null, industry: null,
          classificationSource: null, reason: 'Duplicate of row ' + firstIdx + ' (' + row.name + ')'
        });
        if (!dupesOfCanonical.has(firstIdx)) dupesOfCanonical.set(firstIdx, []);
        dupesOfCanonical.get(firstIdx).push(oneIdx);
        return;
      }
      seenAt.set(norm, oneIdx);
      results.push(checkOne(row.name, row.industry, ctx));
    });

    dupesOfCanonical.forEach(function (dupIndexes, canonicalIdx) {
      var cr = results[canonicalIdx - 1];
      if (!cr) return;
      var extra = 'Also appears on row' + (dupIndexes.length > 1 ? 's ' : ' ') + dupIndexes.join(', ');
      // Appending turns a one-phrase reason into two sentences, so it gains
      // both the separator and a terminating stop. Reasons that already ran to
      // two sentences have theirs stripped first, so it is never doubled.
      var base = (cr.reason || '').replace(/\.$/, '');
      cr.reason = base + '. ' + extra + '.';
    });

    return results;
  }

  window.Matcher = {
    normalise: normalise,
    attachAnnex: attachAnnex,
    checkOne: checkOne,
    checkBatch: checkBatch
  };
})();
