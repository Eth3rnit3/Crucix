// USGS Earthquake Hazards — Real-time seismic activity
// No API key required. Data refreshed every minute.
// Tracks earthquakes magnitude 4.0+ worldwide.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://earthquake.usgs.gov/fdsnws/event/1';

// Get recent significant earthquakes (mag 4+)
async function getRecentQuakes(opts = {}) {
  const { minMagnitude = 4, limit = 50, days = 7 } = opts;
  const startTime = new Date(Date.now() - days * 24 * 3600000).toISOString().split('T')[0];
  const url = `${BASE}/query?format=geojson&minmagnitude=${minMagnitude}&limit=${limit}&orderby=time&starttime=${startTime}`;
  return safeFetch(url, { timeout: 20000 });
}

// Analyze earthquake data
function analyzeQuakes(data) {
  if (!data?.features?.length) {
    return { totalEvents: 0, events: [], byMagnitude: {}, byRegion: {}, signals: [] };
  }

  const events = data.features.map(f => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place,
    time: new Date(f.properties.time).toISOString(),
    depth: f.geometry.coordinates[2],
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    tsunami: f.properties.tsunami === 1,
    felt: f.properties.felt || 0,
    alert: f.properties.alert, // green, yellow, orange, red
    significance: f.properties.sig,
    url: f.properties.url,
  }));

  // Group by magnitude range
  const byMagnitude = {
    major: events.filter(e => e.mag >= 7).length,
    strong: events.filter(e => e.mag >= 6 && e.mag < 7).length,
    moderate: events.filter(e => e.mag >= 5 && e.mag < 6).length,
    light: events.filter(e => e.mag >= 4 && e.mag < 5).length,
  };

  // Group by region (simple keyword extraction)
  const byRegion = {};
  events.forEach(e => {
    const region = extractRegion(e.place);
    byRegion[region] = (byRegion[region] || 0) + 1;
  });

  // Generate signals
  const signals = [];
  const majorQuakes = events.filter(e => e.mag >= 6);
  if (majorQuakes.length > 0) {
    signals.push(`MAJOR EARTHQUAKE${majorQuakes.length > 1 ? 'S' : ''}: ${majorQuakes.length} event(s) M6.0+ detected`);
  }
  
  const tsunamiRisk = events.filter(e => e.tsunami);
  if (tsunamiRisk.length > 0) {
    signals.push(`TSUNAMI WARNING: ${tsunamiRisk.length} event(s) with tsunami potential`);
  }

  const redAlerts = events.filter(e => e.alert === 'red' || e.alert === 'orange');
  if (redAlerts.length > 0) {
    signals.push(`HIGH IMPACT ALERT: ${redAlerts.length} earthquake(s) with significant damage potential`);
  }

  // Sort by magnitude descending for top events
  const topEvents = [...events].sort((a, b) => b.mag - a.mag).slice(0, 15);

  return {
    totalEvents: events.length,
    events: topEvents,
    byMagnitude,
    byRegion,
    signals,
  };
}

// Extract region from place string (e.g., "123 km NW of Tokyo, Japan" -> "Japan")
function extractRegion(place) {
  if (!place) return 'Unknown';
  const parts = place.split(',');
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  // Common region patterns
  const regions = ['Alaska', 'California', 'Hawaii', 'Japan', 'Indonesia', 'Chile', 'Philippines', 'Mexico', 'Turkey', 'Iran', 'Pacific', 'Atlantic'];
  for (const r of regions) {
    if (place.includes(r)) return r;
  }
  return place.length > 30 ? place.substring(0, 30) + '...' : place;
}

// Briefing export
export async function briefing() {
  const data = await getRecentQuakes({ minMagnitude: 4, limit: 50, days: 7 });

  if (data.error) {
    return {
      source: 'USGS Earthquakes',
      timestamp: new Date().toISOString(),
      status: 'error',
      error: data.error,
    };
  }

  const analysis = analyzeQuakes(data);

  return {
    source: 'USGS Earthquakes',
    timestamp: new Date().toISOString(),
    status: 'active',
    ...analysis,
  };
}

if (process.argv[1]?.endsWith('usgs.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
