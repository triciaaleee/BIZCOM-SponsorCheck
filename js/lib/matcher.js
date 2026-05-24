/* ============================================================
   js/lib/matcher.js
   Frontend placeholder for the sponsor-matching algorithm.
   Mirrors PRD section 10. When Supabase Edge Functions are
   wired up, this whole module is swapped for a fetch() call.

   STATUS DEFINITIONS (finalised v2):
     clear      : on the Master List, previously approved by BIZCOM,
                  outreach count is comfortably below the cap.
     caution    : on the Master List but approaching the 30-day
                  outreach cap (8 or 9 of 10 contacts).
     alumni     : alumni-affiliated, needs OAR clearance.
     blocked    : on the banned list (Annex A or B) or closed.
     cooldown   : 30-day outreach cap already hit, must wait.
     unverified : not in any list. New company, BIZCOM has not
                  vetted this one yet.
     duplicate  : duplicate row within the same submission.
   ============================================================ */

(function () {
  'use strict';

  const SUFFIXES = [
    'pte ltd', 'pte. ltd.', 'private limited', 'pte ltd.', 'pl',
    'llp', 'l.l.p.', 'inc', 'corp', 'corporation', 'ltd', 'limited',
    'co', 'co.', 'sg', '(singapore)', 'singapore'
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
    const settings = window.MOCK_DATA.settings;
    const outreach = window.MOCK_DATA.outreachCounts;

    // 1. Exact match
    let matched = sponsors.find(function (s) { return s.normalised === normalisedInput; });

    // 2. Fuzzy fallback
    let fuzzy = null;
    if (!matched && normalisedInput.length >= 3) {
      let best = { score: 0, sponsor: null };
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
    const outreachCount = effectiveMatch ? (outreach[effectiveMatch.id] || 0) : 0;
    const cap = settings.outreach_cap_per_30d;

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
          if (outreachCount >= cap) {
            status = 'cooldown';
            reason = '30-day outreach cap reached (' + outreachCount + ' of ' + cap + '). Wait for next cycle.';
          } else if (outreachCount >= cap - 2) {
            status = 'caution';
            reason = 'Approaching 30-day outreach cap.';
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
        const seen = new Set();
        const results = [];
        rows.forEach(function (row) {
          const norm = normalise(row.name);
          if (seen.has(norm)) {
            results.push({
              input: row.name,
              status: 'duplicate',
              matched: null,
              industry: null,
              classificationSource: null,
              reason: 'Duplicate within this submission'
            });
            return;
          }
          seen.add(norm);
          results.push(checkOne(row.name, row.industry));
        });
        resolve(results);
      }, delay);
    });
  }

  window.Matcher = {
    normalise: normalise,
    checkOne: checkOne,
    checkBatch: checkBatch
  };
})();
