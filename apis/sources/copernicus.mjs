// Copernicus / GDACS — Global Disaster Alert and Coordination System
// No API key required. Tracks earthquakes, floods, tropical cyclones, volcanoes, droughts.
// Alternative to EFFIS/CEMS which have restructured their feeds.

import { safeFetch } from '../utils/fetch.mjs';

// GDACS provides reliable RSS feeds for global emergencies
const GDACS_RSS = 'https://www.gdacs.org/xml/rss.xml';
const GDACS_EQ_RSS = 'https://www.gdacs.org/xml/rss_eq.xml';
const GDACS_FL_RSS = 'https://www.gdacs.org/xml/rss_fl.xml';
const GDACS_TC_RSS = 'https://www.gdacs.org/xml/rss_tc.xml';

// Parse RSS/Atom feed
async function parseRSSFeed(url, sourceName) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 
        'User-Agent': 'Crucix/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    clearTimeout(timer);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const xml = await res.text();
    const items = [];
    
    // Parse RSS items
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      
      const title = extractTag(block, 'title');
      const link = extractTag(block, 'link');
      const description = extractTag(block, 'description');
      const pubDate = extractTag(block, 'pubDate');
      const category = extractTag(block, 'category');
      
      // Try to extract coordinates from description or georss
      const coords = extractCoords(block);
      
      if (title) {
        items.push({
          title: cleanHtml(title).substring(0, 150),
          link,
          description: cleanHtml(description).substring(0, 300),
          date: pubDate,
          category: category || null,
          lat: coords?.lat || null,
          lon: coords?.lon || null,
          source: sourceName,
        });
      }
    }
    
    // Also try Atom format (entry tags)
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      
      const title = extractTag(block, 'title');
      const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || extractTag(block, 'link');
      const summary = extractTag(block, 'summary') || extractTag(block, 'content');
      const updated = extractTag(block, 'updated') || extractTag(block, 'published');
      
      const coords = extractCoords(block);
      
      if (title) {
        items.push({
          title: cleanHtml(title).substring(0, 150),
          link,
          description: cleanHtml(summary).substring(0, 300),
          date: updated,
          category: null,
          lat: coords?.lat || null,
          lon: coords?.lon || null,
          source: sourceName,
        });
      }
    }
    
    return items;
  } catch (e) {
    return { error: e.message };
  }
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() || null;
}

function extractCoords(block) {
  // Try georss:point
  const point = block.match(/<georss:point>([^<]+)<\/georss:point>/);
  if (point) {
    const [lat, lon] = point[1].trim().split(/\s+/).map(Number);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  
  // Try geo:lat and geo:long
  const geoLat = block.match(/<geo:lat>([^<]+)<\/geo:lat>/);
  const geoLon = block.match(/<geo:long?>([^<]+)<\/geo:long?>/);
  if (geoLat && geoLon) {
    const lat = parseFloat(geoLat[1]);
    const lon = parseFloat(geoLon[1]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  
  return null;
}

function cleanHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Classify alert type
function classifyAlert(item) {
  const text = `${item.title} ${item.description} ${item.category || ''}`.toLowerCase();
  
  if (text.includes('fire') || text.includes('wildfire') || text.includes('incend')) {
    return 'fire';
  }
  if (text.includes('flood') || text.includes('inondation') || text.includes('inund')) {
    return 'flood';
  }
  if (text.includes('earthquake') || text.includes('séisme') || text.includes('terremoto')) {
    return 'earthquake';
  }
  if (text.includes('storm') || text.includes('cyclone') || text.includes('hurricane') || text.includes('typhoon')) {
    return 'storm';
  }
  if (text.includes('landslide') || text.includes('glissement') || text.includes('avalanche')) {
    return 'landslide';
  }
  if (text.includes('drought') || text.includes('sécheresse')) {
    return 'drought';
  }
  if (text.includes('volcano') || text.includes('volcanic') || text.includes('eruption')) {
    return 'volcanic';
  }
  
  return 'other';
}

// Analyze alerts
function analyzeAlerts(items) {
  const alerts = items.map(item => ({
    ...item,
    type: classifyAlert(item),
  }));
  
  // Group by type
  const byType = {};
  alerts.forEach(a => {
    byType[a.type] = (byType[a.type] || 0) + 1;
  });
  
  // Group by country/region (simple extraction)
  const byRegion = {};
  const europeanCountries = ['france', 'spain', 'italy', 'germany', 'portugal', 'greece', 'turkey', 'croatia', 'romania', 'bulgaria', 'poland', 'ukraine', 'albania', 'serbia', 'bosnia', 'montenegro', 'slovenia', 'austria', 'hungary', 'czech', 'slovakia'];
  
  alerts.forEach(a => {
    const text = `${a.title} ${a.description}`.toLowerCase();
    for (const country of europeanCountries) {
      if (text.includes(country)) {
        byRegion[country.charAt(0).toUpperCase() + country.slice(1)] = 
          (byRegion[country.charAt(0).toUpperCase() + country.slice(1)] || 0) + 1;
        break;
      }
    }
  });
  
  // Generate signals
  const signals = [];
  
  const fireCount = byType.fire || 0;
  const floodCount = byType.flood || 0;
  
  if (fireCount > 5) {
    signals.push(`EUROPE FIRE ACTIVITY: ${fireCount} active fire alerts — elevated risk`);
  }
  
  if (floodCount > 3) {
    signals.push(`EUROPE FLOOD ALERTS: ${floodCount} flood events active`);
  }
  
  const totalAlerts = alerts.length;
  if (totalAlerts > 15) {
    signals.push(`ELEVATED EMERGENCY ACTIVITY: ${totalAlerts} Copernicus alerts active in Europe`);
  }
  
  // Sort by date
  alerts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  
  return {
    totalAlerts: alerts.length,
    alerts: alerts.slice(0, 20),
    byType,
    byRegion,
    signals,
  };
}

// Briefing export
export async function briefing() {
  // Try GDACS feeds (more reliable than EFFIS/CEMS)
  const [gdacsAll, gdacsEQ, gdacsFL, gdacsTC] = await Promise.all([
    parseRSSFeed(GDACS_RSS, 'GDACS'),
    parseRSSFeed(GDACS_EQ_RSS, 'GDACS-EQ'),
    parseRSSFeed(GDACS_FL_RSS, 'GDACS-FL'),
    parseRSSFeed(GDACS_TC_RSS, 'GDACS-TC'),
  ]);
  
  // Combine results
  const allItems = [];
  
  if (Array.isArray(gdacsAll)) {
    allItems.push(...gdacsAll);
  }
  if (Array.isArray(gdacsEQ)) {
    allItems.push(...gdacsEQ);
  }
  if (Array.isArray(gdacsFL)) {
    allItems.push(...gdacsFL);
  }
  if (Array.isArray(gdacsTC)) {
    allItems.push(...gdacsTC);
  }
  
  // De-duplicate by title
  const seen = new Set();
  const unique = allItems.filter(item => {
    const key = item.title?.substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Check if all failed
  if (unique.length === 0) {
    const errors = [];
    if (gdacsAll?.error) errors.push(`GDACS: ${gdacsAll.error}`);
    
    return {
      source: 'GDACS/Copernicus',
      timestamp: new Date().toISOString(),
      status: errors.length > 0 ? 'degraded' : 'no_data',
      error: errors.join('; ') || 'No data available',
      totalAlerts: 0,
      alerts: [],
      byType: {},
      byRegion: {},
      signals: [],
    };
  }
  
  const analysis = analyzeAlerts(unique);
  
  return {
    source: 'GDACS/Copernicus',
    timestamp: new Date().toISOString(),
    status: 'active',
    ...analysis,
  };
}

if (process.argv[1]?.endsWith('copernicus.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
