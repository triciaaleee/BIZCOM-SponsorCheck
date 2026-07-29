/* ============================================================
   js/lib/matcher.js
   Frontend placeholder for the sponsor-matching algorithm.
   Mirrors PRD section 10. When Supabase Edge Functions are
   wired up, this whole module is swapped for a fetch() call.

   STATUS DEFINITIONS (finalised v2):
     clear      : on the Master List, previously approved by BIZCOM,
                  running outreach count is comfortably below the cap.
     caution    : on the Master List but approaching the outreach cap
                  (within 2 of the cap, e.g. 8 or 9 of 10).
     alumni     : alumni-affiliated, needs OAR clearance.
     blocked    : on the banned list (Annex A or B) or closed.
     cooldown   : outreach cap reached; company is in its cooldown window
                  and must wait until it ends (count resets afterwards).
     unverified : not in any list. New company, BIZCOM has not
                  vetted this one yet.
     duplicate  : duplicate row within the same submission.
   ============================================================ */

(function () {
  'use strict';

  // Legal-entity / boilerplate suffixes only. "Singapore" is deliberately NOT
  // here: it's a place name that appears inside real company names (e.g.
  // "Singapore Pools"), so stripping it would drop the identity and risk
  // collisions. Parenthesised locales like "(Singapore)" are already removed by
  // the paren pass in normalise().
  const SUFFIXES = [
    'pte ltd', 'pte. ltd.', 'private limited', 'pte ltd.', 'pl',
    'llp', 'l.l.p.', 'inc', 'corp', 'corporation', 'ltd', 'limited',
    'co', 'co.'
  ];

  function normalise(name) {
    if (!name) return '';
    let n = String(name).toLowerCase();
    n = n.replace(/\([^)]*\)/g, ' ');
    n = n.replace(/&/g, ' and ');
    n = n.replace(/[^\w\s]/g, ' ');
    SUFFIXES.forEach(function (s) {
      const re = new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      n = n.replace(re, ' ');
    });
    n = n.replace(/\s+/g, ' ').trim();
    return n;
  }

  // Keyword classifier for tier-2 industry auto-classification
  const KEYWORDS = {
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
    const n = name.toLowerCase();
    for (const code in KEYWORDS) {
      const stems = KEYWORDS[code];
      for (let i = 0; i < stems.length; i++) {
        if (n.indexOf(stems[i]) !== -1) return code;
      }
    }
    return null;
  }

  // Trigram similarity (Jaccard on trigram sets), approximates pg_trgm
  function trigrams(s) {
    s = '  ' + s + ' ';
    const set = new Set();
    for (let i = 0; i < s.length - 2; i++) {
      set.add(s.substr(i, 3));
    }
    return set;
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    const ta = trigrams(a);
    const tb = trigrams(b);
    let intersect = 0;
    ta.forEach(function (g) { if (tb.has(g)) intersect++; });
    const union = ta.size + tb.size - intersect;
    return union === 0 ? 0 : intersect / union;
  }

  /**
   * Check a single input name against the sponsor database.
   * Returns: { input, status, matched, industry, classificationSource, reason, outreachCount }
   */
  function checkOne(inputName, providedIndustry) {
    const normalisedInput = normalise(inputName);
    const sponsors = window.MOCK_DATA.sponsors;

    // 1. Exact match
    let matched = sponsors.find(function (s) { return s.normalised === normalisedInput; });

    // 2. Fuzzy fallback. Keep the best candidate + score even when it falls
    //    short of the accept threshold, so callers can surface it as a
    //    "possible match" for a human to confirm (see `suggestion` below).
    let fuzzy = null;
    let best = { score: 0, sponsor: null };
    if (!matched && normalisedInput.length >= 3) {
      sponsors.forEach(function (s) {
        const score = similarity(normalisedInput, s.normalised);
        if (score > best.score) best = { score: score, sponsor: s };
      });
      if (best.score >= 0.55) fuzzy = best.sponsor;
    }

    // 3. Determine industry
    let industry = providedIndustry || null;
    let classificationSource = null;
    if (industry) {
      classificationSource = 'provided';
    } else if (matched) {
      industry = matched.industry;
      classificationSource = 'inherited';
    } else if (fuzzy) {
      industry = fuzzy.industry;
      classificationSource = 'inherited';
    } else {
      const kw = classifyByKeyword(inputName);
      if (kw) {
        industry = kw;
        classificationSource = 'keyword';
      } else {
        industry = 'other';
        classificationSource = 'fallback';
      }
    }

    // 4. Determine status
    const effectiveMatch = matched || fuzzy;
    const matchType = matched ? 'exact' : (fuzzy ? 'fuzzy' : null);
    const capState = effectiveMatch ? window.Caps.state(effectiveMatch.id) : null;
    const outreachCount = capState ? capState.count : 0;

    // Near-miss: the closest record that did NOT clear the accept threshold.
    // Surfaced so a company that's really on record (under a different name)
    // isn't mistaken for new. null when nothing is close enough to bother.
    let suggestion = null;
    if (!effectiveMatch && best.sponsor && best.score >= 0.4) {
      suggestion = {
        id: best.sponsor.id,
        name: best.sponsor.name,
        category: best.sponsor.category,
        score: Math.round(best.score * 100)
      };
    }

    let status, reason;
    if (effectiveMatch) {
      switch (effectiveMatch.category) {
        case 'banned':
          status = 'blocked';
          reason = effectiveMatch.ban_reason || 'On the banned list';
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
          if (capState.inCooldown) {
            status = 'cooldown';
            reason = 'Outreach cap reached (' + capState.cap + ' of ' + capState.cap +
                     '). In cooldown until ' + window.Caps.formatDate(capState.cooldownEndsAt) + '.';
          } else if (capState.approaching) {
            status = 'caution';
            reason = 'Approaching the outreach cap (' + capState.count + ' of ' + capState.cap + ').';
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
      // Underlying DB record of the match, if any. Lets callers bucket by the
      // real category (master/banned/closed/alumni) instead of inferring it
      // from `status` (which collapses banned + closed into 'blocked').
      // null when nothing matched. Extra fields; safe for existing callers.
      matchedId: effectiveMatch ? effectiveMatch.id : null,
      matchedName: effectiveMatch ? effectiveMatch.name : null,
      matchedCategory: effectiveMatch ? effectiveMatch.category : null,
      matchType: matchType,                                   // 'exact' | 'fuzzy' | null
      matchScore: matched ? 100 : (fuzzy ? Math.round(best.score * 100) : null),
      suggestion: suggestion,                                 // near-miss for unverified rows
      industry: industry,
      classificationSource: classificationSource,
      reason: reason,
      outreachCount: outreachCount
    };
  }

  /**
   * Run the check on a list. Simulates a 1-2s network delay so the
   * loading state actually shows up in dev.
   */
  function checkBatch(rows, opts) {
    const delay = (opts && typeof opts.delay === 'number') ? opts.delay : (800 + Math.random() * 1200);
    return new Promise(function (resolve) {
      setTimeout(function () {
        // First pass: vet each row, mark duplicates against earlier occurrences.
        // seenAt is a Map<normalisedName, 1-indexed firstRowPosition>.
        // dupesOfCanonical groups duplicate row positions under their canonical row index.
        const seenAt = new Map();
        const dupesOfCanonical = new Map();
        const results = [];

        rows.forEach(function (row, i) {
          const norm = normalise(row.name);
          const oneIdx = i + 1;
          if (seenAt.has(norm)) {
            const firstIdx = seenAt.get(norm);
            results.push({
              input: row.name,
              status: 'duplicate',
              matched: null,
              industry: null,
              classificationSource: null,
              reason: 'Duplicate of row ' + firstIdx + ' (' + row.name + ')'
            });
            if (!dupesOfCanonical.has(firstIdx)) dupesOfCanonical.set(firstIdx, []);
            dupesOfCanonical.get(firstIdx).push(oneIdx);
            return;
          }
          seenAt.set(norm, oneIdx);
          results.push(checkOne(row.name, row.industry));
        });

        // Second pass: annotate each canonical row's reason with where it also appears.
        dupesOfCanonical.forEach(function (dupIndexes, canonicalIdx) {
          const canonicalResult = results[canonicalIdx - 1];
          if (!canonicalResult) return;
          const extra = 'Also appears on row' + (dupIndexes.length > 1 ? 's ' : ' ') + dupIndexes.join(', ');
          canonicalResult.reason = (canonicalResult.reason || '') + ' ' + extra;
        });

        resolve(results);
      }, delay);
    });
  }

  // Derive each sponsor's `normalised` key from the same normalise() the
  // matcher queries with, so a hand-authored key can never drift from the
  // lookup and silently drop a match (e.g. a banned company reading as
  // "unverified"). In production this key is written by the app on save; here
  // we regenerate it once at load for the mock list.
  if (window.MOCK_DATA && Array.isArray(window.MOCK_DATA.sponsors)) {
    window.MOCK_DATA.sponsors.forEach(function (s) {
      s.normalised = normalise(s.name);
    });
  }

  window.Matcher = {
    normalise: normalise,
    checkOne: checkOne,
    checkBatch: checkBatch
  };
})();
