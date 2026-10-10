/* ============================================================
   js/pages/standing-order.js
   The public Standing Order page:
     1. Fills the live outreach and event caps ([data-stat] spans)
        from the settings row.
     2. Shows the Standing Order PDF that admins upload from
        Settings (Storage bucket `standing-order`, see 0023) in an
        in-page reader built on PDF.js.

   WHY PDF.js AND NOT AN <iframe>
   Browsers' own PDF viewers are unreliable inside a page on phones:
   Android Chrome offers a download instead, and iOS Safari shows only
   the first page. PDF.js draws each page onto a canvas, so the reader
   looks the same everywhere. A transparent text layer over each page
   keeps the text selectable and findable with the browser's own Find.

   Canvases are drawn only for pages near the viewport and released
   again once they are far away, so a long document stays light on a
   phone. Text layers are cheap DOM and are built for every page up
   front, so Find reaches pages that have not been scrolled to yet.

   PDF.js is only fetched once there is a PDF to show.
   ============================================================ */
(function () {
  'use strict';

  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  // cdnjs's published hash for pdf.min.js 3.11.174.
  var PDFJS_SRI = 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==';
  var GAZETTE_URL = 'https://www.smusa.sg/smusa-gazette';
  var DOWNLOAD_NAME = 'SMUSA-Sponsorship-Standing-Order.pdf';
  // Sharp enough on a retina screen; 3x phones would triple the memory for
  // no visible gain on body text.
  var MAX_DPR = 2;
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var viewer = document.getElementById('so-viewer');
  var metaEl = document.getElementById('so-doc-meta');
  var actionsEl = document.getElementById('so-doc-actions');
  var openLink = document.getElementById('so-open');
  var downloadLink = document.getElementById('so-download');

  // ---------- live figures ----------
  // Every figure on this page comes from the settings row. The markup ships
  // placeholders rather than numbers so this page can never drift from the
  // Settings screen or the checker.
  function fillStats(settings) {
    document.querySelectorAll('[data-stat]').forEach(function (el) {
      var value = settings && settings[el.getAttribute('data-stat')];
      el.textContent = (value != null) ? Number(value).toLocaleString() : 'unavailable';
    });
  }

  function loadLiveStats() {
    if (!window.PublicData || !window.PublicData.getSettings) { fillStats(null); return; }
    window.PublicData.getSettings().then(fillStats).catch(function (e) {
      console.error('[standing-order] could not load the live figures', e);
      fillStats(null);
    });
  }

  // ---------- states ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
  }

  function showLoading() {
    viewer.innerHTML =
      '<div class="so-viewer__status" role="status">' +
        '<span class="so-spinner" aria-hidden="true"></span>' +
        '<span>Loading the Standing Order…</span>' +
      '</div>';
  }

  // icon, title, description, then one button: [label, href, icon].
  function showState(icon, title, description, button) {
    viewer.innerHTML =
      '<div class="empty-state">' +
        '<i class="bi ' + icon + ' empty-state__icon"></i>' +
        '<h3 class="empty-state__title">' + escapeHtml(title) + '</h3>' +
        '<p class="empty-state__description">' + escapeHtml(description) + '</p>' +
        '<a class="btn btn--primary btn--sm" href="' + escapeHtml(button[1]) + '" target="_blank" rel="noopener">' +
          '<i class="bi ' + button[2] + '"></i> ' + escapeHtml(button[0]) +
        '</a>' +
      '</div>';
  }

  function showEmpty() {
    metaEl.textContent = 'Not yet uploaded.';
    showState('bi-file-earmark-text', 'Standing Order PDF not yet available',
      'BIZCOM has not uploaded the document yet. In the meantime, the binding text is on the SMUSA Gazette.',
      ['Open the SMUSA Gazette', GAZETTE_URL, 'bi-box-arrow-up-right']);
  }

  function showUnavailable() {
    metaEl.textContent = 'Could not be loaded.';
    showState('bi-cloud-slash', 'Could not load the Standing Order',
      'Please refresh to try again. The binding text is also on the SMUSA Gazette.',
      ['Open the SMUSA Gazette', GAZETTE_URL, 'bi-box-arrow-up-right']);
  }

  // The file exists but the reader could not draw it (PDF.js blocked, an
  // unusual PDF). The browser can usually still open it on its own.
  function showRenderFailed(doc) {
    showState('bi-file-earmark-pdf', 'The PDF could not be displayed here',
      'Open it in a new tab to read it in your browser’s own PDF viewer.',
      ['Open the PDF', doc.url, 'bi-box-arrow-up-right']);
  }

  // ---------- PDF.js ----------
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_BASE + 'pdf.min.js';
      s.integrity = PDFJS_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('PDF.js did not initialise.')); return; }
        // Cross-origin worker: PDF.js wraps it in a same-origin blob itself.
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('PDF.js could not be loaded.')); };
      document.head.appendChild(s);
    });
  }

  function openDocument(doc) {
    var uploaded = formatDate(doc.uploadedAt);
    metaEl.textContent = uploaded ? 'Uploaded ' + uploaded : '';
    openLink.href = doc.url;
    // Supabase serves the file as an attachment with this name when asked.
    downloadLink.href = doc.url + '?download=' + encodeURIComponent(DOWNLOAD_NAME);
    actionsEl.hidden = false;

    var pdfjsLib;
    return loadPdfJs().then(function (lib) {
      pdfjsLib = lib;
      return pdfjsLib.getDocument({ url: doc.url }).promise;
    }).then(function (pdf) {
      metaEl.textContent = [uploaded && 'Uploaded ' + uploaded,
        pdf.numPages + (pdf.numPages === 1 ? ' page' : ' pages')].filter(Boolean).join(' · ');
      var pending = [];
      for (var i = 1; i <= pdf.numPages; i++) pending.push(pdf.getPage(i));
      return Promise.all(pending);
    }).then(function (pages) {
      buildReader(pdfjsLib, pages);
    }).catch(function (e) {
      console.error('[standing-order] could not display the PDF', e);
      showRenderFailed(doc);
    });
  }

  function buildReader(pdfjsLib, pages) {
    var list = document.createElement('div');
    list.className = 'so-pages';
    viewer.innerHTML = '';
    viewer.appendChild(list);

    var entries = pages.map(function (page, i) {
      var base = page.getViewport({ scale: 1 });
      var el = document.createElement('div');
      el.className = 'so-page';
      el.style.aspectRatio = base.width + ' / ' + base.height;
      el.setAttribute('aria-label', 'Page ' + (i + 1) + ' of ' + pages.length);
      el.setAttribute('role', 'region');

      var canvas = document.createElement('canvas');
      canvas.className = 'so-page__canvas';
      canvas.setAttribute('aria-hidden', 'true');
      var text = document.createElement('div');
      text.className = 'textLayer';
      el.appendChild(canvas);
      el.appendChild(text);
      list.appendChild(el);

      var entry = { page: page, base: base, el: el, canvas: canvas, drawnWidth: 0, task: null, near: false, failed: false };
      // Built at the page's current scale (PDF.js insists the two match);
      // after that, --scale-factor alone resizes it with the page.
      var scale = setScale(entry);
      pdfjsLib.renderTextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport: page.getViewport({ scale: scale }),
        textDivs: []
      }).promise.catch(function (e) {
        console.error('[standing-order] text layer, page ' + (i + 1), e);
      });
      return entry;
    });

    if (!('IntersectionObserver' in window)) {
      entries.forEach(function (entry) { entry.near = true; draw(entry); });
    } else {
      var byEl = new Map(entries.map(function (entry) { return [entry.el, entry]; }));
      var io = new IntersectionObserver(function (changes) {
        changes.forEach(function (c) {
          var entry = byEl.get(c.target);
          entry.near = c.isIntersecting;
          if (entry.near) draw(entry); else release(entry);
        });
      }, { rootMargin: '150% 0px' });
      entries.forEach(function (entry) { io.observe(entry.el); });
    }

    // The text layer follows the page width through --scale-factor, and a
    // canvas simply scales down. Only a WIDER page needs redrawing, so it
    // stays sharp.
    if ('ResizeObserver' in window) {
      var timer = null;
      new ResizeObserver(function () {
        entries.forEach(setScale);
        clearTimeout(timer);
        timer = setTimeout(function () {
          entries.forEach(function (entry) { if (entry.near) draw(entry); });
        }, 150);
      }).observe(list);
    }
  }

  // Returns the scale applied. A page with no width yet (still hidden) keeps
  // its previous scale, or 1, until the ResizeObserver corrects it.
  function setScale(entry) {
    var width = entry.el.clientWidth;
    var scale = width ? width / entry.base.width
      : (parseFloat(entry.el.style.getPropertyValue('--scale-factor')) || 1);
    entry.el.style.setProperty('--scale-factor', scale);
    return scale;
  }

  // Draws into a fresh canvas and swaps it in when done, so a redraw at a new
  // size never flashes a blank page.
  function draw(entry) {
    var cssWidth = entry.el.clientWidth;
    if (!cssWidth || entry.task || entry.failed || entry.drawnWidth >= cssWidth) return;

    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var viewport = entry.page.getViewport({ scale: (cssWidth / entry.base.width) * dpr });
    var canvas = document.createElement('canvas');
    canvas.className = 'so-page__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    var task = entry.page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });
    entry.task = task;
    task.promise.then(function () {
      entry.el.replaceChild(canvas, entry.canvas);
      freeCanvas(entry.canvas);
      entry.canvas = canvas;
      entry.drawnWidth = cssWidth;
    }, function (e) {
      freeCanvas(canvas);
      if (!e || e.name !== 'RenderingCancelledException') {
        // Left blank rather than retried: the same page fails the same way.
        entry.failed = true;
        console.error('[standing-order] could not draw a page', e);
      }
    }).then(function () {
      if (entry.task !== task) return;
      entry.task = null;
      // Widened again while drawing.
      if (entry.near && entry.drawnWidth < entry.el.clientWidth) draw(entry);
    });
  }

  function release(entry) {
    if (entry.task) { entry.task.cancel(); entry.task = null; }
    if (!entry.drawnWidth) return;
    freeCanvas(entry.canvas);
    entry.drawnWidth = 0;
  }

  // A zero-size canvas hands its pixel buffer back straight away; waiting for
  // garbage collection is what runs a phone out of memory on long documents.
  function freeCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }

  // ---------- boot ----------
  // Deferred like the data scripts before it, so those have already run.
  loadLiveStats();

  if (!window.PublicData || !window.PublicData.getStandingOrder) {
    showUnavailable();
    return;
  }
  showLoading();
  window.PublicData.getStandingOrder().then(function (doc) {
    if (!doc) { showEmpty(); return; }
    return openDocument(doc);
  }).catch(function (e) {
    console.error('[standing-order] could not look up the PDF', e);
    showUnavailable();
  });
})();
