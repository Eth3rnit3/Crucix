// ECB — European Central Bank Data
// No API key required. Economic indicators for Eurozone.
// Tracks: Main refinancing rate, EUR/USD, M3 money supply, inflation.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://data-api.ecb.europa.eu/service/data';

// ECB SDMX API - returns XML by default, we request JSON
async function getECBSeries(flowRef, key, opts = {}) {
  const { startPeriod, endPeriod } = opts;
  let url = `${BASE}/${flowRef}/${key}?format=jsondata`;
  if (startPeriod) url += `&startPeriod=${startPeriod}`;
  if (endPeriod) url += `&endPeriod=${endPeriod}`;
  
  const data = await safeFetch(url, { timeout: 20000 });
  return data;
}

// Parse ECB JSON data format
function parseECBData(data) {
  try {
    if (data.error) return { error: data.error };
    
    const dataSets = data.dataSets?.[0];
    const structure = data.structure;
    
    if (!dataSets?.series || !structure) {
      return { error: 'Invalid ECB data structure' };
    }

    // Get time periods
    const timeDimension = structure.dimensions?.observation?.[0];
    const periods = timeDimension?.values?.map(v => v.id) || [];

    // Extract observations from first series
    const seriesKey = Object.keys(dataSets.series)[0];
    const observations = dataSets.series[seriesKey]?.observations || {};

    const values = [];
    for (const [idx, obs] of Object.entries(observations)) {
      const period = periods[parseInt(idx)];
      const value = obs[0];
      if (period && value !== null) {
        values.push({ period, value });
      }
    }

    // Sort by period descending
    values.sort((a, b) => b.period.localeCompare(a.period));

    return {
      latest: values[0] || null,
      recent: values.slice(0, 12),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Get multiple ECB indicators in parallel
async function getIndicators() {
  const startPeriod = getStartPeriod(24); // Last 24 months
  
  const [mrrRaw, eurusdRaw, m3Raw, hicpRaw] = await Promise.all([
    // Main Refinancing Rate (MRR)
    getECBSeries('FM', 'D.U2.EUR.4F.KR.MRR_FR.LEV', { startPeriod }),
    // EUR/USD exchange rate
    getECBSeries('EXR', 'D.USD.EUR.SP00.A', { startPeriod }),
    // M3 Money Supply (annual growth rate)
    getECBSeries('BSI', 'M.U2.Y.V.M30.X.1.U2.2300.Z01.A', { startPeriod }),
    // HICP Inflation (annual rate)
    getECBSeries('ICP', 'M.U2.N.000000.4.ANR', { startPeriod }),
  ]);

  return {
    mainRefinancingRate: parseECBData(mrrRaw),
    eurusd: parseECBData(eurusdRaw),
    m3MoneySupply: parseECBData(m3Raw),
    hicp: parseECBData(hicpRaw),
  };
}

function getStartPeriod(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Generate signals based on indicators
function generateSignals(indicators) {
  const signals = [];
  
  const mrr = indicators.mainRefinancingRate?.latest?.value;
  const eurusd = indicators.eurusd?.latest?.value;
  const m3 = indicators.m3MoneySupply?.latest?.value;
  const hicp = indicators.hicp?.latest?.value;

  if (mrr !== undefined && mrr !== null) {
    if (mrr >= 4) {
      signals.push(`ECB RESTRICTIVE: Main rate at ${mrr}% — tight monetary policy`);
    } else if (mrr <= 1) {
      signals.push(`ECB ACCOMMODATIVE: Main rate at ${mrr}% — loose monetary policy`);
    }
  }

  if (hicp !== undefined && hicp !== null) {
    if (hicp > 4) {
      signals.push(`EUROZONE INFLATION HIGH: HICP at ${hicp.toFixed(1)}% YoY — above target`);
    } else if (hicp < 1) {
      signals.push(`EUROZONE DEFLATION RISK: HICP at ${hicp.toFixed(1)}% YoY — below target`);
    }
  }

  if (m3 !== undefined && m3 !== null) {
    if (m3 < 0) {
      signals.push(`MONEY SUPPLY CONTRACTING: M3 at ${m3.toFixed(1)}% YoY — liquidity squeeze`);
    } else if (m3 > 8) {
      signals.push(`MONEY SUPPLY SURGING: M3 at ${m3.toFixed(1)}% YoY — inflationary pressure`);
    }
  }

  if (eurusd !== undefined && eurusd !== null) {
    if (eurusd < 1.05) {
      signals.push(`EUR WEAKNESS: EUR/USD at ${eurusd.toFixed(4)} — dollar strength`);
    } else if (eurusd > 1.15) {
      signals.push(`EUR STRENGTH: EUR/USD at ${eurusd.toFixed(4)} — euro rally`);
    }
  }

  return signals;
}

// Briefing export
export async function briefing() {
  const indicators = await getIndicators();

  // Check for errors
  const hasError = Object.values(indicators).every(i => i.error);
  if (hasError) {
    return {
      source: 'ECB',
      timestamp: new Date().toISOString(),
      status: 'error',
      error: 'Failed to fetch ECB data',
    };
  }

  const signals = generateSignals(indicators);

  // Format for display
  const formatted = {
    mainRefinancingRate: indicators.mainRefinancingRate?.latest ? {
      value: indicators.mainRefinancingRate.latest.value,
      period: indicators.mainRefinancingRate.latest.period,
      recent: indicators.mainRefinancingRate.recent?.slice(0, 6).map(r => r.value),
    } : null,
    eurusd: indicators.eurusd?.latest ? {
      value: indicators.eurusd.latest.value,
      period: indicators.eurusd.latest.period,
      recent: indicators.eurusd.recent?.slice(0, 10).map(r => r.value),
    } : null,
    m3MoneySupply: indicators.m3MoneySupply?.latest ? {
      value: indicators.m3MoneySupply.latest.value,
      period: indicators.m3MoneySupply.latest.period,
      recent: indicators.m3MoneySupply.recent?.slice(0, 6).map(r => r.value),
    } : null,
    hicp: indicators.hicp?.latest ? {
      value: indicators.hicp.latest.value,
      period: indicators.hicp.latest.period,
      recent: indicators.hicp.recent?.slice(0, 6).map(r => r.value),
    } : null,
  };

  return {
    source: 'ECB',
    timestamp: new Date().toISOString(),
    status: 'active',
    indicators: formatted,
    signals,
  };
}

if (process.argv[1]?.endsWith('ecb.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
