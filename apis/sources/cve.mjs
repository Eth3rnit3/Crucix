// CVE — NVD National Vulnerability Database
// No API key required (rate limited to 5 requests per 30s without key).
// Tracks critical and high severity vulnerabilities (CVSS >= 7).

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

// Get recent CVEs
async function getRecentCVEs(opts = {}) {
  const { days = 7, resultsPerPage = 50 } = opts;
  
  const startDate = new Date(Date.now() - days * 24 * 3600000);
  const endDate = new Date();
  
  // Format dates as ISO 8601 with timezone
  const pubStartDate = startDate.toISOString();
  const pubEndDate = endDate.toISOString();
  
  // NVD API 2.0 parameters - get high/critical severity CVEs
  const params = new URLSearchParams({
    pubStartDate,
    pubEndDate,
    resultsPerPage: String(resultsPerPage),
    cvssV3Severity: 'HIGH', // HIGH or CRITICAL
  });

  // Also try CRITICAL severity
  const [highResult, criticalResult] = await Promise.all([
    safeFetch(`${BASE}?${params.toString()}`, { timeout: 30000 }),
    safeFetch(`${BASE}?${params.toString().replace('cvssV3Severity=HIGH', 'cvssV3Severity=CRITICAL')}`, { timeout: 30000 }),
  ]);

  return { high: highResult, critical: criticalResult };
}

// Parse CVE data
function parseCVE(cveItem) {
  try {
    const cve = cveItem.cve;
    const id = cve.id;
    
    // Get description (prefer English)
    const descriptions = cve.descriptions || [];
    const englishDesc = descriptions.find(d => d.lang === 'en');
    const description = englishDesc?.value || descriptions[0]?.value || 'No description available';
    
    // Get CVSS score (prefer v3.1, then v3.0, then v2.0)
    const metrics = cve.metrics || {};
    let cvssScore = null;
    let severity = 'UNKNOWN';
    let vector = null;
    
    if (metrics.cvssMetricV31?.length) {
      const m = metrics.cvssMetricV31[0].cvssData;
      cvssScore = m.baseScore;
      severity = m.baseSeverity;
      vector = m.vectorString;
    } else if (metrics.cvssMetricV30?.length) {
      const m = metrics.cvssMetricV30[0].cvssData;
      cvssScore = m.baseScore;
      severity = m.baseSeverity;
      vector = m.vectorString;
    } else if (metrics.cvssMetricV2?.length) {
      const m = metrics.cvssMetricV2[0].cvssData;
      cvssScore = m.baseScore;
      severity = m.baseSeverity || (cvssScore >= 7 ? 'HIGH' : 'MEDIUM');
      vector = m.vectorString;
    }
    
    // Get affected products (CPE)
    const configurations = cve.configurations || [];
    const affectedProducts = [];
    configurations.forEach(config => {
      (config.nodes || []).forEach(node => {
        (node.cpeMatch || []).forEach(match => {
          if (match.vulnerable) {
            // Parse CPE to get vendor:product
            const parts = match.criteria?.split(':') || [];
            if (parts.length >= 5) {
              const vendor = parts[3];
              const product = parts[4];
              if (!affectedProducts.includes(`${vendor}/${product}`)) {
                affectedProducts.push(`${vendor}/${product}`);
              }
            }
          }
        });
      });
    });
    
    // Get references
    const references = (cve.references || []).slice(0, 3).map(r => r.url);
    
    // Dates
    const published = cve.published;
    const modified = cve.lastModified;
    
    // Weaknesses (CWE)
    const weaknesses = (cve.weaknesses || [])
      .flatMap(w => w.description || [])
      .filter(d => d.lang === 'en')
      .map(d => d.value);

    return {
      id,
      description: description.substring(0, 300),
      cvssScore,
      severity,
      vector,
      published,
      modified,
      affectedProducts: affectedProducts.slice(0, 5),
      weaknesses: weaknesses.slice(0, 3),
      references,
    };
  } catch (e) {
    return null;
  }
}

// Analyze CVE data
function analyzeCVEs(highData, criticalData) {
  const vulnerabilities = [];
  
  // Parse high severity CVEs
  if (highData?.vulnerabilities?.length) {
    highData.vulnerabilities.forEach(item => {
      const parsed = parseCVE(item);
      if (parsed) vulnerabilities.push(parsed);
    });
  }
  
  // Parse critical severity CVEs
  if (criticalData?.vulnerabilities?.length) {
    criticalData.vulnerabilities.forEach(item => {
      const parsed = parseCVE(item);
      if (parsed) vulnerabilities.push(parsed);
    });
  }
  
  // De-duplicate by CVE ID
  const seen = new Set();
  const unique = vulnerabilities.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  
  // Sort by CVSS score descending
  unique.sort((a, b) => (b.cvssScore || 0) - (a.cvssScore || 0));
  
  // Stats
  const bySeverity = {
    critical: unique.filter(v => v.severity === 'CRITICAL').length,
    high: unique.filter(v => v.severity === 'HIGH').length,
  };
  
  // Affected products frequency
  const productFreq = {};
  unique.forEach(v => {
    v.affectedProducts.forEach(p => {
      productFreq[p] = (productFreq[p] || 0) + 1;
    });
  });
  const topProducts = Object.entries(productFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([product, count]) => ({ product, count }));
  
  // Signals
  const signals = [];
  if (bySeverity.critical > 5) {
    signals.push(`CYBER ALERT: ${bySeverity.critical} critical CVEs published this week — patch urgently`);
  }
  
  // Check for high-profile products
  const criticalProducts = ['microsoft', 'apple', 'google', 'linux', 'apache', 'oracle', 'cisco', 'fortinet', 'palo_alto'];
  const affectedMajor = unique
    .filter(v => v.severity === 'CRITICAL')
    .filter(v => v.affectedProducts.some(p => 
      criticalProducts.some(cp => p.toLowerCase().includes(cp))
    ));
  
  if (affectedMajor.length > 0) {
    const vendors = [...new Set(affectedMajor.flatMap(v => v.affectedProducts))].slice(0, 3);
    signals.push(`CRITICAL VENDOR CVEs: ${vendors.join(', ')} — enterprise impact likely`);
  }

  return {
    totalVulnerabilities: unique.length,
    bySeverity,
    topVulnerabilities: unique.slice(0, 15),
    topProducts,
    signals,
  };
}

// Briefing export
export async function briefing() {
  try {
    const { high, critical } = await getRecentCVEs({ days: 7, resultsPerPage: 30 });
    
    // Check for rate limiting or errors
    if (high?.error && critical?.error) {
      return {
        source: 'NVD CVE',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: high.error || critical.error,
        hint: 'NVD API rate limit: 5 requests per 30 seconds without API key',
      };
    }
    
    const analysis = analyzeCVEs(high, critical);
    
    return {
      source: 'NVD CVE',
      timestamp: new Date().toISOString(),
      status: 'active',
      ...analysis,
    };
  } catch (e) {
    return {
      source: 'NVD CVE',
      timestamp: new Date().toISOString(),
      status: 'error',
      error: e.message,
    };
  }
}

if (process.argv[1]?.endsWith('cve.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
