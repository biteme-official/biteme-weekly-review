/**
 * Vercel Serverless Function: Tableau Data API
 *
 * Fetches all dashboard data from Tableau REST API in real-time.
 * No Google Sheets caching — direct Tableau → JSON.
 *
 * Environment variables required:
 *   TABLEAU_PAT_NAME    — Personal Access Token name
 *   TABLEAU_PAT_SECRET  — Personal Access Token secret
 */

// ═══════════════════════════════════════════
//  Tableau Configuration
// ═══════════════════════════════════════════
const TABLEAU_SERVER = 'https://prod-apnortheast-a.online.tableau.com';
const TABLEAU_SITE = 'biteme01';
const TABLEAU_API = '/api/3.24';
const TABLEAU_WORKBOOK_ID = '086a345c-987d-4692-8483-481f6ed5414d';

const VIEWS = {
  CM:             '4632dc12-77ed-403a-9dc3-f8332bea26e7',
  RAW:            'e4b0546f-4f4f-4837-9665-8d0a6d1df5b7',
  SS:             '2c4bf72b-58d6-4b49-9134-5c72d5bf93d8',
  B2B:            '6d4aa68c-a9ae-4b1c-b59e-9d74921a7881',
  CPO:            '72b87bb4-3dbf-4aa8-8e27-a5ec5e4b9f63',
  SKU_STEADY:     '1b00c18b-93f4-4a8b-805f-cdb8ff483da5',
  SKU_NEW:        'a89d2601-e907-442b-bf80-bfabf466c736',
  PROFIT:         '209e152a-487b-4fba-8c4a-3607736b30e6',
  MKT_DAU:        'c47b9732-8bf5-4214-89b1-081d43e7425a',
  MKT_BRAND_DAU:  'fcbd5f3c-963b-4ee7-b7af-f5a45177e33b',
  CHANNEL_CM:     'f1e3944d-1001-45d6-982f-430ae1a815b0',
};

const DAILY_ROI_VIEWS = {
  '바잇미 자사몰': 'e53fb200-eb4b-42db-98f2-4c30ba519577',
  '스스':         'c75b28ac-3bf1-4f05-9633-f4dabe0782b8',
  'B2B':          'df575f01-23f5-466d-8989-710881e9055c',
  '쿠팡':         '3062396f-f1fb-4d51-8014-5dac66a0a53e',
  '해외':         'e47c337f-2eeb-4f65-a61c-89d17694c9d3',
  '그외':         'ade7640b-6c24-4819-9de2-43e30af2941c',
};

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

/** ISO 8601 week number */
function getISOWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const w1 = new Date(date.getFullYear(), 0, 4);
  return Math.round(((date - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7) + 1;
}

/** Parse Tableau CSV text into an array of string-arrays (skips header row). */
function parseCsv(csvText) {
  let clean = csvText.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  if (clean.charAt(0) === '"' && clean.charAt(clean.length - 1) === '"') {
    clean = clean.substring(1, clean.length - 1);
  }
  const lines = clean.split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = [];
    let inQuote = false;
    let val = '';
    for (let c = 0; c < line.length; c++) {
      const ch = line.charAt(c);
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(val); val = ''; }
      else { val += ch; }
    }
    cols.push(val);
    rows.push(cols);
  }
  return rows;
}

/** Parse a numeric string (strip commas, quotes). */
function num(s) {
  return parseFloat((s || '0').replace(/,/g, '').replace(/"/g, '')) || 0;
}

/** Sort key helper: extract week number from "W01|..." or "W01" */
function weekNum(key) {
  const w = key.split('|')[0];
  return parseInt(w.substring(1), 10) || 0;
}

/** Month order for sorting */
const MONTH_ORDER = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const MONTH_MAP = {};
MONTH_ORDER.forEach((m, i) => { MONTH_MAP[m] = i; });

function sortWeekMonthKeys(keys) {
  return keys.sort((a, b) => {
    const wa = weekNum(a), wb = weekNum(b);
    if (wa !== wb) return wa - wb;
    const ma = MONTH_MAP[a.split('|')[1]] ?? 0;
    const mb = MONTH_MAP[b.split('|')[1]] ?? 0;
    return ma - mb;
  });
}

// ═══════════════════════════════════════════
//  Tableau REST API helpers
// ═══════════════════════════════════════════

let _authCache = null;

async function tableauAuth() {
  const resp = await fetch(`${TABLEAU_SERVER}${TABLEAU_API}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      credentials: {
        personalAccessTokenName: process.env.TABLEAU_PAT_NAME,
        personalAccessTokenSecret: process.env.TABLEAU_PAT_SECRET,
        site: { contentUrl: TABLEAU_SITE },
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Tableau auth failed (${resp.status}): ${body.substring(0, 200)}`);
  }
  const json = await resp.json();
  _authCache = {
    token: json.credentials.token,
    siteId: json.credentials.site.id,
  };
  return _authCache;
}

async function getAuth() {
  if (_authCache) return _authCache;
  return tableauAuth();
}

/**
 * Fetch CSV data from a Tableau view.
 * Re-authenticates once on 401.
 */
async function fetchViewCsv(viewId) {
  let auth = await getAuth();
  let url = `${TABLEAU_SERVER}${TABLEAU_API}/sites/${auth.siteId}/views/${viewId}/data?maxAge=1`;

  let resp = await fetch(url, {
    headers: { 'X-Tableau-Auth': auth.token },
  });

  // Re-auth on 401
  if (resp.status === 401) {
    auth = await tableauAuth();
    url = `${TABLEAU_SERVER}${TABLEAU_API}/sites/${auth.siteId}/views/${viewId}/data?maxAge=1`;
    resp = await fetch(url, {
      headers: { 'X-Tableau-Auth': auth.token },
    });
  }

  if (!resp.ok) {
    throw new Error(`View ${viewId}: HTTP ${resp.status}`);
  }
  return resp.text();
}

async function fetchJson(path) {
  const auth = await getAuth();
  const resp = await fetch(`${TABLEAU_SERVER}${path}`, {
    headers: { 'X-Tableau-Auth': auth.token, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`JSON fetch ${path}: HTTP ${resp.status}`);
  return resp.json();
}

// ═══════════════════════════════════════════
//  Data Parsers  (mirror Code.js logic)
// ═══════════════════════════════════════════

/** CM_VIEW -> platformWeekly */
function parsePlatformCM(csvText) {
  const rows = parseCsv(csvText);
  const weekMonth = {};
  for (const r of rows) {
    if (r.length < 5 || r[3] === 'All') continue;
    const week = r[0], month = r[1], cat = r[3], val = num(r[4]);
    const key = `${week}|${month}`;
    if (!weekMonth[key]) weekMonth[key] = { week, month };
    weekMonth[key][cat] = (weekMonth[key][cat] || 0) + val;
  }
  const keys = sortWeekMonthKeys(Object.keys(weekMonth));
  return keys.map(k => {
    const d = weekMonth[k];
    return {
      week: d.week,
      month: d.month,
      '제품CM': Math.round(d['제품'] || 0),
      '상품CM': Math.round(d['상품'] || 0),
      '수수료CM': Math.round(d['수수료'] || 0),
      '서비스CM': Math.round(d['서비스'] || 0),
    };
  });
}

/** RAW_VIEW -> platformRaw */
function parsePlatformRaw(csvText) {
  const rows = parseCsv(csvText);
  const weekRaw = {};
  for (const r of rows) {
    if (r.length < 5) continue;
    const wk = r[0], measure = r[1], val = num(r[4]);
    if (!weekRaw[wk]) weekRaw[wk] = {};
    weekRaw[wk][measure] = (weekRaw[wk][measure] || 0) + val;
  }
  const allWeeks = Object.keys(weekRaw).sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
  return allWeeks.map(wk => {
    const d = weekRaw[wk];
    return {
      week: wk,
      '제품매출': Math.round(d['제품매출'] || 0),
      '제품원가': Math.round(d['제품원가'] || 0),
      '상품매출': Math.round(d['상품매출'] || 0),
      '상품원가': Math.round(d['상품원가'] || 0),
      '수수료거래액': Math.round(d['수수료거래액'] || 0),
      '수수료매출': Math.round(d['수수료매출'] || 0),
      '서비스매출': Math.round(d['서비스매출'] || 0),
      '마케팅비용': Math.round(d['마케팅비용'] || 0),
      '위수탁부담금': Math.round(d['위수탁부담금'] || 0),
      '마케팅성변동비': Math.round(d['마케팅성 변동비'] || 0),
    };
  });
}

/**
 * Auto-calculate CM from Raw data (fallback when CM view fails).
 * Returns the same shape as parsePlatformCM.
 */
function calcCMFromRaw(csvText) {
  const rows = parseCsv(csvText);
  const weekMonthRaw = {};
  for (const r of rows) {
    if (r.length < 5) continue;
    const wk = r[0], measure = r[1], month = r[2];
    const val = num(r[4]);
    const key = `${wk}|${month}`;
    if (!weekMonthRaw[key]) weekMonthRaw[key] = { week: wk, month };
    weekMonthRaw[key][measure] = (weekMonthRaw[key][measure] || 0) + val;
  }
  const keys = sortWeekMonthKeys(Object.keys(weekMonthRaw));
  return keys.map(k => {
    const d = weekMonthRaw[k];
    return {
      week: d.week,
      month: d.month,
      '제품CM': Math.round((d['제품매출'] || 0) - (d['제품원가'] || 0)),
      '상품CM': Math.round((d['상품매출'] || 0) - (d['상품원가'] || 0)),
      '수수료CM': Math.round(d['수수료매출'] || 0),
      '서비스CM': Math.round(d['서비스매출'] || 0),
    };
  });
}

/** SS_VIEW / B2B_VIEW -> ssWeekly / b2bWeekly */
function parseChannelView(csvText) {
  const rows = parseCsv(csvText);
  const weekMonth = {};
  for (const r of rows) {
    if (r.length < 5) continue;
    const week = r[0], measure = r[1], month = r[2];
    const val = num(r[4]);
    const key = `${week}|${month}`;
    if (!weekMonth[key]) weekMonth[key] = { week, month };
    weekMonth[key][measure] = (weekMonth[key][measure] || 0) + val;
  }
  const keys = sortWeekMonthKeys(Object.keys(weekMonth));
  return keys.map(k => {
    const d = weekMonth[k];
    return {
      week: d.week,
      month: d.month,
      '공헌이익': Math.round(d['공헌이익'] || 0),
      '순매출': Math.round(d['순매출'] || 0),
      '매출원가': Math.round(d['매출원가'] || 0),
      '운반비성변동비': Math.round(d['운반비성 변동비'] || d['운반비성변동비'] || 0),
      '도착보장비용': Math.round(d['도착보장비용'] || 0),
      '마케팅비용': Math.round(d['마케팅비용'] || 0),
      '변동비최종': Math.round(d['변동비(최종)'] || d['변동비최종'] || 0),
      '신규거래액': Math.round(d['신규 거래액'] || d['신규거래액'] || 0),
      '신규원가': Math.round(d['신규 원가'] || d['신규원가'] || 0),
      '기존거래액': Math.round(d['기존 거래액'] || d['기존거래액'] || 0),
      '기존원가': Math.round(d['기존 원가'] || d['기존원가'] || 0),
      'VIP거래액': Math.round(d['VIP 거래액'] || d['VIP거래액'] || 0),
      'VIP원가': Math.round(d['VIP 원가'] || d['VIP원가'] || 0),
      '주문건수': Math.round(d['주문건수'] || 0),
    };
  });
}

/** CPO_VIEW -> cpoWeekly (day-level -> week aggregation) */
function parseCPO(csvText) {
  const rows = parseCsv(csvText);
  const cats = ['영양제/식품', '용품', '의류/잡화', '장난감'];
  const weekMonth = {};

  for (const r of rows) {
    if (r.length < 6) continue;
    const day = parseInt(r[0], 10);
    const monthStr = r[1];
    const year = parseInt(r[2], 10);
    const channel = r[3];
    const category = r[4];
    if (channel !== 'All') continue;
    if (cats.indexOf(category) < 0) continue;
    const val = num(r[5]);
    const mi = MONTH_MAP[monthStr];
    if (mi === undefined || isNaN(day) || isNaN(year)) continue;

    const dt = new Date(year, mi, day);
    const wn = getISOWeek(dt);
    const weekId = 'W' + String(wn).padStart(2, '0');
    const key = `${weekId}|${monthStr}`;
    if (!weekMonth[key]) weekMonth[key] = { week: weekId, month: monthStr };
    weekMonth[key][category] = (weekMonth[key][category] || 0) + val;
  }

  const keys = sortWeekMonthKeys(Object.keys(weekMonth));
  return keys.map(k => {
    const d = weekMonth[k];
    return {
      week: d.week,
      month: d.month,
      '영양제식품': Math.round(d['영양제/식품'] || 0),
      '용품': Math.round(d['용품'] || 0),
      '의류잡화': Math.round(d['의류/잡화'] || 0),
      '장난감': Math.round(d['장난감'] || 0),
    };
  });
}

/** SKU_STEADY + SKU_NEW -> cpoSkuWeekly */
function parseSKU(steadyCsv, newCsv) {
  const weekMonth = {};
  for (const csvText of [newCsv, steadyCsv]) {
    if (!csvText) continue;
    const rows = parseCsv(csvText);
    for (const r of rows) {
      if (r.length < 7) continue;
      const week = r[0], month = r[1], skuType = r[3], channel = r[5];
      if (channel !== 'All') continue;
      const val = num(r[6]);
      const key = `${week}|${month}`;
      if (!weekMonth[key]) weekMonth[key] = { week, month };
      weekMonth[key][skuType] = (weekMonth[key][skuType] || 0) + val;
    }
  }
  const keys = sortWeekMonthKeys(Object.keys(weekMonth));
  return keys.map(k => {
    const d = weekMonth[k];
    return {
      week: d.week,
      month: d.month,
      '신상': Math.round(d['신상'] || 0),
      '스테디': Math.round(d['스테디'] || 0),
      '시즈널': Math.round(d['시즈널'] || 0),
    };
  });
}

/** PROFIT_VIEW -> profitData */
function parseProfit(csvText) {
  const rows = parseCsv(csvText);
  const weekMonth = {};
  for (const r of rows) {
    if (r.length < 6) continue;
    const week = r[0].trim(), measure = r[1].trim(), month = r[2].trim(), bu = r[4].trim();
    const val = num(r[5]);
    const key = `${week}|${month}|${bu}`;
    if (!weekMonth[key]) weekMonth[key] = { week, month, bu, '순매출': 0, '공헌이익': 0 };
    if (measure === '순매출') weekMonth[key]['순매출'] += val;
    else if (measure === '공헌이익') weekMonth[key]['공헌이익'] += val;
  }
  const keys = Object.keys(weekMonth).sort((a, b) => {
    const wa = parseInt(a.split('|')[0].substring(1)), wb = parseInt(b.split('|')[0].substring(1));
    return wa - wb;
  });
  return keys.map(k => {
    const d = weekMonth[k];
    return {
      week: d.week,
      month: d.month,
      bu: d.bu,
      '순매출': Math.round(d['순매출']),
      '공헌이익': Math.round(d['공헌이익']),
    };
  });
}

/** MKT_DAU_VIEW -> mktPlatformDau */
function parseMktDau(csvText) {
  const rows = parseCsv(csvText);
  const weekMonth = {};
  for (const r of rows) {
    if (r.length < 5) continue;
    const week = r[0].trim(), measure = r[1].trim(), month = r[2].trim();
    const val = num(r[4]);
    const key = `${week}|${month}`;
    if (!weekMonth[key]) weekMonth[key] = { week, month, dau: 0, affiliateSub: 0, cumAffiliate: 0, cumAppConsent: 0 };
    if (measure === 'dau') weekMonth[key].dau += val;
    else if (measure === '어필리에이트 동의자') weekMonth[key].affiliateSub += val;
    else if (measure === '주간 누적동의자') weekMonth[key].cumAffiliate = val;
    else if (measure === '주간 누적 앱동의자수') weekMonth[key].cumAppConsent = val;
  }
  const keys = sortWeekMonthKeys(Object.keys(weekMonth));
  return keys.map(k => {
    const d = weekMonth[k];
    return {
      week: d.week,
      month: d.month,
      dau: Math.round(d.dau),
      affiliateSub: Math.round(d.affiliateSub),
      cumAffiliate: Math.round(d.cumAffiliate),
      cumAppConsent: Math.round(d.cumAppConsent),
    };
  });
}

/** MKT_BRAND_DAU_VIEW -> mktBrandDau */
function parseMktBrandDau(csvText) {
  const rows = parseCsv(csvText);
  const weekMonth = {};
  for (const r of rows) {
    if (r.length < 4) continue;
    const week = r[0].trim(), month = r[1].trim();
    const val = num(r[3]);
    const key = `${week}|${month}`;
    if (!weekMonth[key]) weekMonth[key] = { week, month, dau: 0 };
    weekMonth[key].dau += val;
  }
  const keys = sortWeekMonthKeys(Object.keys(weekMonth));
  return keys.map(k => {
    const d = weekMonth[k];
    return { week: d.week, month: d.month, dau: Math.round(d.dau) };
  });
}

/** CHANNEL_CM_VIEW -> cmData (monthly, in 만원) + cmChannelWeekly (weekly, in 원) */
function parseChannelCM(csvText) {
  const rows = parseCsv(csvText);
  const channels = ['B2B', '그외', '바잇미 자사몰', '스스', '쿠팡', '해외'];
  const monthCM = {};
  const weekMonthCM = {};

  for (const r of rows) {
    if (r.length < 7) continue;
    const week = r[0].trim(), measure = r[1].trim(), month = r[2].trim(), ch = r[4].trim();
    if (measure !== '공헌이익' || channels.indexOf(ch) < 0) continue;
    const val = num(r[6]);

    // Monthly
    if (!monthCM[month]) {
      monthCM[month] = {};
      channels.forEach(c => { monthCM[month][c] = 0; });
    }
    monthCM[month][ch] += val;

    // Weekly
    const wk = `${week}|${month}`;
    if (!weekMonthCM[wk]) {
      weekMonthCM[wk] = { week, month };
      channels.forEach(c => { weekMonthCM[wk][c] = 0; });
    }
    weekMonthCM[wk][ch] += val;
  }

  // cmData — monthly in 만원
  const months = Object.keys(monthCM).sort((a, b) => (MONTH_MAP[a] ?? 99) - (MONTH_MAP[b] ?? 99));
  const cmData = months.map(m => {
    const d = monthCM[m];
    return {
      month: m,
      B2B: Math.round(d['B2B'] / 10000),
      '그외': Math.round(d['그외'] / 10000),
      '바잇미자사몰': Math.round(d['바잇미 자사몰'] / 10000),
      '스스': Math.round(d['스스'] / 10000),
      '쿠팡': Math.round(d['쿠팡'] / 10000),
      '해외': Math.round(d['해외'] / 10000),
    };
  });

  // cmChannelWeekly — weekly in 원
  const wKeys = sortWeekMonthKeys(Object.keys(weekMonthCM));
  const cmChannelWeekly = wKeys.map(k => {
    const d = weekMonthCM[k];
    return {
      week: d.week,
      month: d.month,
      B2B: Math.round(d['B2B']),
      '그외': Math.round(d['그외']),
      '바잇미자사몰': Math.round(d['바잇미 자사몰']),
      '스스': Math.round(d['스스']),
      '쿠팡': Math.round(d['쿠팡']),
      '해외': Math.round(d['해외']),
    };
  });

  return { cmData, cmChannelWeekly };
}

/** DAILY_ROI_VIEWS -> dailyROICost */
function parseDailyROI(channelCsvMap) {
  const TARGET = {
    '순매출': 1,
    '매출원가': 1,
    '마케팅성 변동비': 1,
    '운반비성 변동비': 1,
    'PG수수료성 변동비': 1,
    '공헌이익': 1,
  };
  const agg = {};
  const measureSet = {};

  for (const [chName, csvText] of Object.entries(channelCsvMap)) {
    if (!csvText) continue;
    const lines = (() => {
      let clean = csvText.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      if (clean.charAt(0) === '"' && clean.charAt(clean.length - 1) === '"') {
        clean = clean.substring(1, clean.length - 1);
      }
      return clean.split('\n');
    })();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = [];
      let inQ = false, v = '';
      for (let c = 0; c < line.length; c++) {
        const ch = line.charAt(c);
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { cols.push(v); v = ''; }
        else v += ch;
      }
      cols.push(v);
      if (cols.length < 8) continue;
      const measure = cols[2].trim();
      if (!TARGET[measure]) continue;
      const week = cols[1].trim();
      const month = cols[3].trim();
      const numVal = parseFloat(cols[7].replace(/,/g, '')) || 0;
      measureSet[measure] = true;
      const key = `${week}|${month}|${chName}`;
      if (!agg[key]) agg[key] = { week, month, channel: chName };
      agg[key][measure] = (agg[key][measure] || 0) + numVal;
    }
  }

  const measures = Object.keys(measureSet).sort();
  const keys = Object.keys(agg).sort((a, b) => {
    const pa = a.split('|'), pb = b.split('|');
    const wa = parseInt(pa[0].substring(1)), wb = parseInt(pb[0].substring(1));
    if (wa !== wb) return wa - wb;
    return (MONTH_MAP[pa[1]] ?? 0) - (MONTH_MAP[pb[1]] ?? 0);
  });

  return keys.map(k => {
    const d = agg[k];
    const row = { week: d.week, month: d.month, channel: d.channel };
    for (const m of measures) {
      row[m] = Math.round(d[m] || 0);
    }
    return row;
  });
}

// ═══════════════════════════════════════════
//  Fixed Cost Date (from workbook parameters)
// ═══════════════════════════════════════════

async function getFixedCostDate() {
  try {
    const auth = await getAuth();
    const json = await fetchJson(
      `${TABLEAU_API}/sites/${auth.siteId}/workbooks/${TABLEAU_WORKBOOK_ID}/parameters`
    );
    const params = json.parameters?.parameter || [];
    for (const p of params) {
      if (p.name.includes('고정비') || p.name.includes('fixed')) {
        return p.currentValue || '';
      }
    }
  } catch (_) {
    // non-critical
  }
  return '';
}

// ═══════════════════════════════════════════
//  Main Handler
// ═══════════════════════════════════════════

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Cache: 5 min server-side, serve stale while revalidating for 60s
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const errors = [];

  try {
    // 1. Authenticate
    await tableauAuth();

    // 2. Fetch all views in parallel
    const [
      cmCsv,
      rawCsv,
      ssCsv,
      b2bCsv,
      cpoCsv,
      skuSteadyCsv,
      skuNewCsv,
      profitCsv,
      mktDauCsv,
      mktBrandDauCsv,
      channelCmCsv,
      fixedCostDate,
      ...dailyRoiCsvs
    ] = await Promise.all([
      fetchViewCsv(VIEWS.CM).catch(e => { errors.push('CM: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.RAW).catch(e => { errors.push('Raw: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.SS).catch(e => { errors.push('SS: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.B2B).catch(e => { errors.push('B2B: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.CPO).catch(e => { errors.push('CPO: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.SKU_STEADY).catch(e => { errors.push('SKU_STEADY: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.SKU_NEW).catch(e => { errors.push('SKU_NEW: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.PROFIT).catch(e => { errors.push('Profit: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.MKT_DAU).catch(e => { errors.push('MktDAU: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.MKT_BRAND_DAU).catch(e => { errors.push('MktBrandDAU: ' + e.message); return null; }),
      fetchViewCsv(VIEWS.CHANNEL_CM).catch(e => { errors.push('ChannelCM: ' + e.message); return null; }),
      getFixedCostDate(),
      // Daily ROI views
      ...Object.values(DAILY_ROI_VIEWS).map(vid =>
        fetchViewCsv(vid).catch(e => { errors.push('DailyROI: ' + e.message); return null; })
      ),
    ]);

    // Build daily ROI channel->csv map
    const dailyRoiChannels = Object.keys(DAILY_ROI_VIEWS);
    const channelCsvMap = {};
    dailyRoiChannels.forEach((ch, i) => {
      if (dailyRoiCsvs[i]) channelCsvMap[ch] = dailyRoiCsvs[i];
    });

    // 3. Parse each dataset
    let platformWeekly = [];
    if (cmCsv) {
      try {
        platformWeekly = parsePlatformCM(cmCsv);
      } catch (e) {
        errors.push('CM parse: ' + e.message);
      }
    }

    // Fallback: calculate CM from Raw data if CM view failed
    if (platformWeekly.length === 0 && rawCsv) {
      try {
        platformWeekly = calcCMFromRaw(rawCsv);
        if (platformWeekly.length > 0) {
          errors.push('CM: Raw 데이터에서 CM 자동 계산됨');
        }
      } catch (e) {
        errors.push('CM fallback: ' + e.message);
      }
    }

    let platformRaw = [];
    if (rawCsv) {
      try { platformRaw = parsePlatformRaw(rawCsv); } catch (e) { errors.push('Raw parse: ' + e.message); }
    }

    let ssWeekly = [];
    if (ssCsv) {
      try { ssWeekly = parseChannelView(ssCsv); } catch (e) { errors.push('SS parse: ' + e.message); }
    }

    let b2bWeekly = [];
    if (b2bCsv) {
      try { b2bWeekly = parseChannelView(b2bCsv); } catch (e) { errors.push('B2B parse: ' + e.message); }
    }

    let cpoWeekly = [];
    if (cpoCsv) {
      try { cpoWeekly = parseCPO(cpoCsv); } catch (e) { errors.push('CPO parse: ' + e.message); }
    }

    let cpoSkuWeekly = [];
    try { cpoSkuWeekly = parseSKU(skuSteadyCsv, skuNewCsv); } catch (e) { errors.push('SKU parse: ' + e.message); }

    let profitData = [];
    if (profitCsv) {
      try { profitData = parseProfit(profitCsv); } catch (e) { errors.push('Profit parse: ' + e.message); }
    }

    let mktPlatformDau = [];
    if (mktDauCsv) {
      try { mktPlatformDau = parseMktDau(mktDauCsv); } catch (e) { errors.push('MktDAU parse: ' + e.message); }
    }

    let mktBrandDau = [];
    if (mktBrandDauCsv) {
      try { mktBrandDau = parseMktBrandDau(mktBrandDauCsv); } catch (e) { errors.push('MktBrandDAU parse: ' + e.message); }
    }

    let cmData = [];
    let cmChannelWeekly = [];
    if (channelCmCsv) {
      try {
        const channelResult = parseChannelCM(channelCmCsv);
        cmData = channelResult.cmData;
        cmChannelWeekly = channelResult.cmChannelWeekly;
      } catch (e) { errors.push('ChannelCM parse: ' + e.message); }
    }

    let dailyROICost = [];
    if (Object.keys(channelCsvMap).length > 0) {
      try { dailyROICost = parseDailyROI(channelCsvMap); } catch (e) { errors.push('DailyROI parse: ' + e.message); }
    }

    // 4. Build response
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const updatedAt = kst.toISOString().replace('T', ' ').substring(0, 16);

    const data = {
      platformWeekly,
      platformRaw,
      ssWeekly,
      b2bWeekly,
      cpoWeekly,
      cpoSkuWeekly,
      profitData,
      mktPlatformDau,
      mktBrandDau,
      cmData,
      cmChannelWeekly,
      dailyROICost,
      fixedCostDate: fixedCostDate || '',
      updatedAt,
    };

    if (errors.length > 0) {
      data._errors = errors;
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({
      error: e.message,
      _errors: errors,
    });
  }
};
