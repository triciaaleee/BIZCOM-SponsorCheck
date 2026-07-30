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
     sponsors: [{ id, name, normalised, category, industry, ban_reason, contract_ends }],
     capState: function (sponsorId) -> { count, cap, inCooldown, cooldownEndsAt, approaching, ... },
     today:    'YYYY-MM-DD'
   }

   STATUS values: clear | caution | cooldown | alumni | blocked | unverified | duplicate.
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

  // Currently-banned rule: banned AND (permanent OR contract not yet lapsed).
  // ISO date strings (YYYY-MM-DD) compare correctly lexicographically.
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
        case 'approved':
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
      cr.reason = (cr.reason || '') + ' ' + extra;
    });

    return results;
  }

  window.Matcher = { normalise: normalise, checkOne: checkOne, checkBatch: checkBatch };
})();
