/* ============================================================
   js/pages/sponsor-check-template.js
   Generates an Excel (.xlsx) template students can fill in,
   then export as CSV from Excel before uploading.

   Uses SheetJS (xlsx) loaded via CDN in sponsor-check.html.
   ============================================================ */

(function () {
  'use strict';

  function buildWorkbook() {
    if (typeof XLSX === 'undefined') {
      console.error('SheetJS not loaded');
      return null;
    }

    const wb = XLSX.utils.book_new();

    // ---- Sheet 1: sponsors-to-fill ----
    const sponsorsAoa = [
      ['company_name', 'industry_code'],
      ['KOI Thé', 'food_beverage'],
      ['Uniqlo', 'apparel_accessories'],
      ['Logitech', 'tech_electronics'],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['', '']
    ];
    const sponsorsWs = XLSX.utils.aoa_to_sheet(sponsorsAoa);
    sponsorsWs['!cols'] = [{ wch: 36 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, sponsorsWs, 'sponsors');

    // ---- Sheet 2: industry_codes reference ----
    const codes = [
      ['code',                       'display_name',              'examples'],
      ['food_beverage',              'Food & Beverage',           'KOI Thé, LiHO, Starbucks, Subway'],
      ['apparel_accessories',        'Apparel & Accessories',     'Uniqlo, Charles & Keith, Adidas'],
      ['beauty_personal_care',       'Beauty & Personal Care',    'Watsons, Sephora, The Body Shop'],
      ['entertainment_leisure',      'Entertainment & Leisure',   'Cathay Cineplexes, Timezone'],
      ['activities_experiences',     'Activities & Experiences',  'Climb Central, BoulderPlus, Escape Hunt'],
      ['tech_electronics',           'Tech & Electronics',        'Razer, Logitech, Challenger'],
      ['education_services',         'Education & Services',      'tuition centres, learning studios'],
      ['health_wellness',            'Health & Wellness',         'Anytime Fitness, ClassPass, yoga studios'],
      ['transport_mobility',         'Transport & Mobility',      'Grab, GetGo, SG Bike'],
      ['home_lifestyle',             'Home & Lifestyle',          'MUJI, IKEA, Daiso'],
      ['professional_services',      'Professional Services',     'consulting, legal, accounting'],
      ['media_publishing',           'Media & Publishing',        'magazines, podcasts, content houses'],
      ['non_profit_government',      'Non-profit & Government',   'NGOs, statutory boards (route via OAR)'],
      ['retail_general',             'Retail (General)',          'department stores, general retail'],
      ['other',                      'Other / Uncategorised',     'anything else, BIZCOM will reclassify']
    ];
    const codesWs = XLSX.utils.aoa_to_sheet(codes);
    codesWs['!cols'] = [{ wch: 26 }, { wch: 28 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, codesWs, 'industry_codes');

    // ---- Sheet 3: instructions ----
    const instructions = [
      ['SponsorCheck file template'],
      [''],
      ['1. Open the "sponsors" sheet.'],
      ['2. Replace the example rows with your own sponsor list.'],
      ['3. Put the company name in column A and the industry code in column B.'],
      ['4. The "industry_codes" sheet lists all valid codes. Leave column B blank if unsure.'],
      ['5. Do not add headers, totals, notes, or merged cells.'],
      ['6. Save as CSV before uploading:'],
      ['   File > Save As > CSV UTF-8 (Comma delimited) (.csv)'],
      ['7. Upload the saved .csv to the SponsorCheck website.'],
      [''],
      ['Need help? Email biz.secretary@sa.smu.edu.sg']
    ];
    const instWs = XLSX.utils.aoa_to_sheet(instructions);
    instWs['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, instWs, 'read_me_first');

    return wb;
  }

  function downloadXlsxTemplate() {
    const wb = buildWorkbook();
    if (!wb) {
      alert('Excel template generator failed to load. Please use the CSV template instead.');
      return;
    }
    XLSX.writeFile(wb, 'sponsor-check-template.xlsx');
  }

  // Wire up the button
  function init() {
    const btn = document.getElementById('download-xlsx-template');
    if (!btn) return;
    btn.addEventListener('click', downloadXlsxTemplate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.SponsorCheckTemplate = { download: downloadXlsxTemplate };
})();
