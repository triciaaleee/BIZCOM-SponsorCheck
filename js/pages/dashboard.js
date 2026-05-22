/* ============================================================
   js/pages/dashboard.js
   Public dashboard: KPI tile counts + Chart.js charts.
   ============================================================ */

(function () {
  'use strict';

  // Brand palette for charts
  const C = {
    navy:   '#2E529D',
    navyL:  '#5A8CD2',
    gold:   '#D6B238',
    goldL:  '#F5D84C',
    orange: '#CA581C',
    orangeD:'#D33A03',
    green:  '#2A9463',
    greenL: '#79C076',
    muted:  '#8A94A6'
  };

  // Common Chart.js defaults
  function applyDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = "Poppins, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#4A5568';
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.animation.duration = 800;
    Chart.defaults.animation.easing = 'easeOutQuart';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Chart.defaults.animation.duration = 0;
    }
  }

  function init() {
    if (!window.Chart) return;
    applyDefaults();
    renderIndustryBar();
    renderWeeklyLine();
    renderCategoryDonut();
    renderHeatmap();
  }

  // ---------- 1. Outreach by industry (top 10, last 30 days) ----------
  function renderIndustryBar() {
    const el = document.getElementById('chart-industry');
    if (!el) return;
    const data = [
      { label: 'Food & Beverage',         value: 312 },
      { label: 'Apparel & Accessories',   value: 187 },
      { label: 'Tech & Electronics',      value: 142 },
      { label: 'Beauty & Personal Care',  value: 108 },
      { label: 'Activities',              value: 94 },
      { label: 'Entertainment',           value: 82 },
      { label: 'Health & Wellness',       value: 67 },
      { label: 'Education',               value: 55 },
      { label: 'Home & Lifestyle',        value: 41 },
      { label: 'Professional Services',   value: 28 }
    ];
    new Chart(el, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: C.navy,
          hoverBackgroundColor: C.navyL,
          borderRadius: 6,
          maxBarThickness: 28
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: '#F0F0F0' }, ticks: { color: C.muted } },
          y: { grid: { display: false }, ticks: { color: '#4A5568', font: { size: 11 } } }
        }
      }
    });
  }

  // ---------- 2. Weekly submission volume (last 12 weeks) ----------
  function renderWeeklyLine() {
    const el = document.getElementById('chart-weekly');
    if (!el) return;
    const labels = [];
    const values = [22, 18, 31, 28, 26, 35, 42, 39, 48, 51, 45, 56];
    for (let i = 11; i >= 0; i--) labels.push('W-' + i);
    new Chart(el, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: C.navy,
          backgroundColor: 'rgba(46, 82, 157, 0.08)',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: C.navy,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted } },
          y: { grid: { color: '#F0F0F0' }, ticks: { color: C.muted }, beginAtZero: true }
        }
      }
    });
  }

  // ---------- 3. Category donut ----------
  function renderCategoryDonut() {
    const el = document.getElementById('chart-categories');
    if (!el) return;
    const data = {
      labels: ['Master', 'Banned', 'Alumni', 'Unverified'],
      values: [8821, 218, 47, 3317],
      colors: [C.green, C.orange, C.navy, C.muted]
    };
    new Chart(el, {
      type: 'doughnut',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
          backgroundColor: data.colors,
          borderColor: '#FFFFFF',
          borderWidth: 3,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%'
      }
    });
    // Populate legend
    const legend = document.getElementById('chart-categories-legend');
    if (legend) {
      legend.innerHTML = data.labels.map((lbl, i) => `
        <span class="chart-legend__item">
          <span class="chart-legend__dot" style="background-color:${data.colors[i]}"></span>
          ${lbl} <strong style="color:#0B103F;margin-left:4px">${data.values[i].toLocaleString()}</strong>
        </span>
      `).join('');
    }
  }

  // ---------- 4. Industry × category heatmap (rendered as stacked bar) ----------
  function renderHeatmap() {
    const el = document.getElementById('chart-heatmap');
    if (!el) return;
    const labels = ['F&B', 'Apparel', 'Beauty', 'Tech', 'Activities', 'Entertain.', 'Health'];
    new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Master',   data: [1240, 420, 380, 290, 180, 220, 160], backgroundColor: C.green },
          { label: 'Banned',   data: [45, 0, 0, 0, 0, 12, 0],              backgroundColor: C.orange },
          { label: 'Alumni',   data: [12, 4, 2, 5, 3, 1, 2],               backgroundColor: C.navy },
          { label: 'Unverif.', data: [320, 110, 90, 80, 60, 70, 40],       backgroundColor: C.muted }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: C.muted } },
          y: { stacked: true, grid: { color: '#F0F0F0' }, ticks: { color: C.muted } }
        }
      }
    });
  }

  // Wait for Chart.js to load, then init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
