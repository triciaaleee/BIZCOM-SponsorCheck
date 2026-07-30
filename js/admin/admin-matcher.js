/* ============================================================
   js/admin/admin-matcher.js
   Matcher for the admin Vet & Upload page. Unlike the shared
   js/lib/matcher.js (which reads window.MOCK_DATA / Caps / Bans),
   this one is a PURE function of the data passed to it, so the
   admin page can match against LIVE Supabase data with no
   MOCK_DATA globals.

   It REUSES window.Matcher.normalise as the single source of truth
   for the lookup key (so a saved key can never drift from the
   lookup and let a banned company read as "unverified"). The
   fuzzy(trigram) + keyword + status logic is ported from
   matcher.js; keep the two in step if that algorithm changes.

   Usage:
     AdminMatcher.checkBatch(rows, {
       sponsors: [{ id, name, normalised, category, industry, ban_reason, contract_ends }],
       capState: function (sponsorId) -> { count, cap, inCooldown, cooldownEndsAt, approaching, ... },
       today: 'YYYY-MM-DD'
     })
   Returns the same result shape the page already consumes.
   ============================================================ */
(function () {
  'use strict';

  function normalise(name) { return window.Matcher.normalise(name); }

  // Keyword classifier for tier-2 industry auto-classification (ported).
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

  // Trigram similarity (Jaccard on trigram sets), approximates pg_trgm.
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

  // Currently-banned rule: banned AND (permanent OR contract not yet lapsed).
  // Date strings are ISO (YYYY-MM-DD), so a lexicographic compare is correct.
  function isActiveBan(s, today) {
    if (!s || s.category !== 'banned') return false;
    if (!s.contract_ends) return true;
    return String(s.contract_ends) >= today;
  }

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
      suggestion = { id: best.sponsor.id, name: best.sponsor.name, category: best.sponsor.category, score: Math.round(best.score * 100) };
    }

    var status, reason;
    if (effectiveMatch) {
      switch (effectiveMatch.category) {
        case 'banned':
          if (!isActiveBan(effectiveMatch, ctx.today)) {
            status = 'unverified';
            reason = 'BIZCOM contract has ended — no longer restricted. Vet before approaching.';
          } else {
            status = 'blocked';
            reason = effectiveMatch.ban_reason || 'On the banned list';
          }
          break;
        case 'closed':
          status = 'blocked';
          reason = 'Company is closed or defunct';
          break;
        case 'alumni':
          status = 'alumni';
          reason = 'Alumni-affiliated, requires OAR clearance';
          break;
        case 'master':
          if (capSt.inCooldown) {
            status = 'cooldown';
            reason = 'Outreach cap reached (' + capSt.cap + ' of ' + capSt.cap +
                     '). In cooldown until ' + formatDate(capSt.cooldownEndsAt) + '.';
          } else if (capSt.approaching) {
            status = 'caution';
            reason = 'Approaching the outreach cap (' + capSt.count + ' of ' + capSt.cap + ').';
          } else {
            status = 'clear';
            reason = 'Previously approved by BIZCOM.';
          }
          break;
        default:
          status = 'clear';
          reason = 'Match found, no restrictions.';
      }
    } else {
      status = 'unverified';
      reason = 'Not in any list. BIZCOM will need to vet this company.';
    }

    return {
      input: inputName,
      status: status,
      matched: matched ? matched.name : (fuzzy ? fuzzy.name + ' (similar)' : null),
      matchedId: effectiveMatch ? effectiveMatch.id : null,
      matchedName: effectiveMatch ? effectiveMatch.name : null,
      matchedCategory: effectiveMatch ? effectiveMatch.category : null,
      matchType: matchType,
      matchScore: matched ? 100 : (fuzzy ? Math.round(best.score * 100) : null),
      suggestion: suggestion,
      industry: industry,
      classificationSource: classificationSource,
      reason: reason,
      outreachCount: outreachCount
    };
  }

  // Synchronous (no artificial delay; the page shows its own loading state while
  // the live data loads). Marks duplicates against earlier rows, same as matcher.js.
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
      cr.reason = (cr.reason || '') + ' ' + extra;
    });

    return results;
  }

  window.AdminMatcher = { checkOne: checkOne, checkBatch: checkBatch };
})();
