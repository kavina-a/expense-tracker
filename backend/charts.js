/**
 * charts.js — server-side chart image generation via QuickChart.io
 *
 * QuickChart renders Chart.js configs into PNG images with no native deps.
 * POST https://quickchart.io/chart → returns raw PNG bytes
 */
const axios = require('axios');

const QUICKCHART_URL = 'https://quickchart.io/chart';
const BG   = '#161921'; // dark background — matches dashboard
const GRID = '#1e2130';

// ─── Low-level renderer ──────────────────────────────────────────────────────

async function generateChartImage(chartConfig, { width = 620, height = 400 } = {}) {
  const { data } = await axios.post(
    QUICKCHART_URL,
    {
      chart:            chartConfig,
      width,
      height,
      devicePixelRatio: 2,
      format:           'png',
      backgroundColor:  BG,
    },
    { responseType: 'arraybuffer', timeout: 15_000 }
  );
  return Buffer.from(data);
}

// ─── Chart config builders ───────────────────────────────────────────────────

/**
 * Category donut chart — sent when user asks "chart" or "pie"
 * Enriched expense rows must have a .color field.
 */
function buildCategoryChartConfig(summaryData) {
  const { expenses, totalSpent, totalEarned, net, month } = summaryData;
  const monthLabel = fmtMonthLabel(month);
  const netSign    = net >= 0 ? '+' : '';

  const labels = expenses.map(e => {
    const k = (e.total / 1000).toFixed(1);
    return `${e.category}  Rs.${k}k`;
  });

  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data:            expenses.map(e => e.total),
        backgroundColor: expenses.map(e => e.color || '#6b7280'),
        borderWidth:     0,
        hoverOffset:     6,
      }],
    },
    options: {
      cutout: '60%',
      plugins: {
        title: {
          display: true,
          text: [
            `📊  ${monthLabel}`,
            `Spent Rs.${fmtK(totalSpent)}  ·  Earned Rs.${fmtK(totalEarned)}  ·  Net ${netSign}Rs.${fmtK(net)}`,
          ],
          color: '#e2e8f0',
          font: { size: 13, weight: 'bold' },
          padding: { bottom: 16 },
        },
        legend: {
          position: 'right',
          labels: {
            color:     '#94a3b8',
            font:      { size: 11 },
            padding:   12,
            boxWidth:  10,
          },
        },
      },
    },
  };
}

/**
 * Income vs expense grouped bar chart — sent when user asks "trend"
 */
function buildTrendChartConfig(trends) {
  const map = {};
  for (const r of trends) {
    if (!map[r.month]) map[r.month] = { income: 0, expense: 0 };
    map[r.month][r.type] += r.total;
  }
  const months = Object.keys(map).sort();
  const labels  = months.map(m => fmtMonthShort(m));

  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:           'Earned',
          data:            months.map(m => map[m].income),
          backgroundColor: '#22c55e99',
          borderColor:     '#22c55e',
          borderWidth:     1,
          borderRadius:    4,
        },
        {
          label:           'Spent',
          data:            months.map(m => map[m].expense),
          backgroundColor: '#ef444499',
          borderColor:     '#ef4444',
          borderWidth:     1,
          borderRadius:    4,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text:  '📈  Monthly Trend — Income vs Expenses',
          color: '#e2e8f0',
          font:  { size: 13, weight: 'bold' },
          padding: { bottom: 16 },
        },
        legend: {
          labels: { color: '#94a3b8', font: { size: 11 } },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 11 } },
          grid:  { color: GRID },
        },
        y: {
          ticks: {
            color:    '#64748b',
            font:     { size: 11 },
            callback: v => `${(v / 1000).toFixed(0)}k`,
          },
          grid: { color: GRID },
        },
      },
    },
  };
}

/**
 * Daily activity bar chart — sent when user asks "daily chart"
 */
function buildDailyChartConfig(dailyData, month) {
  const map = {};
  for (const r of dailyData) {
    if (!map[r.date]) map[r.date] = { expense: 0, income: 0 };
    map[r.date][r.type] += r.total;
  }
  const dates  = Object.keys(map).sort();
  const labels  = dates.map(d => d.slice(8)); // just "01", "02", …
  const monthLabel = fmtMonthLabel(month);

  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:           'Spent',
          data:            dates.map(d => map[d].expense),
          backgroundColor: '#ef444499',
          borderColor:     '#ef4444',
          borderWidth:     1,
          borderRadius:    3,
        },
        {
          label:           'Earned',
          data:            dates.map(d => map[d].income),
          backgroundColor: '#22c55e99',
          borderColor:     '#22c55e',
          borderWidth:     1,
          borderRadius:    3,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text:  `📅  ${monthLabel} — Daily Activity`,
          color: '#e2e8f0',
          font:  { size: 13, weight: 'bold' },
          padding: { bottom: 16 },
        },
        legend: {
          labels: { color: '#94a3b8', font: { size: 11 } },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 } },
          grid:  { color: GRID },
        },
        y: {
          ticks: {
            color:    '#64748b',
            font:     { size: 11 },
            callback: v => `${(v / 1000).toFixed(0)}k`,
          },
          grid: { color: GRID },
        },
      },
    },
  };
}

/**
 * Horizontal category bar — sent as part of "stats"
 * Uses type:'bar' + indexAxis:'y' (Chart.js v3/v4 — horizontalBar was removed in v3)
 */
function buildCategoryBarConfig(expenses, month) {
  const sorted = [...expenses].sort((a, b) => b.total - a.total).slice(0, 8);
  const monthLabel = fmtMonthLabel(month);

  return {
    type: 'bar',
    data: {
      labels:   sorted.map(e => e.category),
      datasets: [{
        label:           'Spent',
        data:            sorted.map(e => e.total),
        backgroundColor: sorted.map(e => e.color || '#6b7280'),
        borderWidth:     0,
        borderRadius:    4,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        title: {
          display: true,
          text:  `🔍  ${monthLabel} — Top Categories`,
          color: '#e2e8f0',
          font:  { size: 13, weight: 'bold' },
          padding: { bottom: 12 },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: {
            color:    '#64748b',
            callback: v => `${(v / 1000).toFixed(0)}k`,
          },
          grid: { color: GRID },
        },
        y: {
          ticks: { color: '#94a3b8', font: { size: 11 } },
          grid:  { color: GRID },
        },
      },
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMonthLabel(m) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1, 1)
    .toLocaleString('default', { month: 'long', year: 'numeric' });
}

function fmtMonthShort(m) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1, 1)
    .toLocaleString('default', { month: 'short' });
}

function fmtK(n) {
  const abs = Math.abs(n);
  return abs >= 1000
    ? `${(abs / 1000).toFixed(1)}k`
    : abs.toLocaleString('en-IN');
}

module.exports = {
  generateChartImage,
  buildCategoryChartConfig,
  buildTrendChartConfig,
  buildDailyChartConfig,
  buildCategoryBarConfig,
};
