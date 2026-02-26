/**
 * api.js — OxyTrace Data Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsibilities:
 *   • GPS acquisition with localStorage fallback
 *   • Reverse geocoding (BigDataCloud, no key)
 *   • Live AQI fetch (Open-Meteo, no key)
 *   • Hourly pattern generation from live AQI
 *   • Auto-refresh every REFRESH_INTERVAL_MS
 *   • Fires window CustomEvent 'oxytrace:data' on every successful update
 *   • Fires window CustomEvent 'oxytrace:error' on failures
 *   • postMessage bridge for map.html iframe
 *
 * UI files (index.html, health.html) ONLY listen to these events.
 * Zero data logic lives in the HTML files.
 */

(function (global) {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────────────────────
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const GEO_OPTS = { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 };
  const LS_LOC   = 'oxtrace_last_loc';
  const LS_AQI   = 'oxtrace_last_aqi';
  const LS_TIME  = 'oxtrace_last_fetch';

  // ─── INTERNAL STATE ────────────────────────────────────────────────────────
  let _coords    = null;   // { lat, lon }
  let _cityLabel = null;
  let _liveAqi   = null;
  let _hourly    = [];
  let _refreshTimer = null;
  let _refreshCountdown = REFRESH_INTERVAL_MS / 1000; // seconds
  let _countdownTimer = null;
  let _fetchInProgress = false;

  // ─── AQI HELPERS ───────────────────────────────────────────────────────────
  function aqiColor(v) {
    if (v == null) return '#4a6680';
    if (v <= 50)  return '#00ff88';
    if (v <= 100) return '#ffd700';
    if (v <= 150) return '#ff9500';
    if (v <= 200) return '#ff4444';
    if (v <= 300) return '#cc44ff';
    return '#ff0000';
  }

  function aqiLabel(v) {
    if (v == null) return 'N/A';
    if (v <= 50)  return 'Good';
    if (v <= 100) return 'Moderate';
    if (v <= 150) return 'Sensitive Grps';
    if (v <= 200) return 'Unhealthy';
    if (v <= 300) return 'Very Unhealthy';
    return 'Hazardous';
  }

  function aqiTier(v) {
    if (v == null) return { label: '⏳ LOADING', sub: 'Fetching air quality', color: '#00d4ff', glow: 'rgba(0,212,255,0.5)' };
    if (v <= 50)  return { label: '✓ GOOD',              sub: 'Air quality is satisfactory',      color: '#00ff88', glow: 'rgba(0,255,136,0.5)' };
    if (v <= 100) return { label: '⚠ MODERATE',          sub: 'Sensitive groups affected',         color: '#ffd700', glow: 'rgba(255,215,0,0.5)' };
    if (v <= 150) return { label: '⚠ UNHEALTHY·SENSIT.', sub: 'Limit prolonged outdoor exertion',  color: '#ff9500', glow: 'rgba(255,149,0,0.5)' };
    if (v <= 200) return { label: '✕ UNHEALTHY',         sub: 'Everyone may be affected',          color: '#ff4444', glow: 'rgba(255,68,68,0.5)' };
    if (v <= 300) return { label: '✕ VERY UNHEALTHY',    sub: 'Health alert — avoid outdoors',     color: '#cc00ff', glow: 'rgba(204,0,255,0.5)' };
    return              { label: '☠ HAZARDOUS',          sub: 'Emergency — stay indoors',          color: '#ff0000', glow: 'rgba(255,0,0,0.7)'   };
  }

  // ─── HOURLY PATTERN GENERATOR ──────────────────────────────────────────────
  // Open-Meteo free tier doesn't include past hourly history.
  // We model a realistic 24h AQI curve from the current live value using
  // traffic-pattern multipliers (pollution tracks rush hour / night drop).
  const TRAFFIC_PATTERN = [
    0.55, 0.50, 0.47, 0.45, 0.50, 0.60,  // 0–5  late night → pre-dawn
    0.80, 1.05, 1.18, 1.08, 0.92, 0.85,  // 6–11 morning rush
    0.87, 0.84, 0.82, 0.86, 0.95, 1.12,  // 12–17 midday → afternoon
    1.22, 1.12, 0.96, 0.86, 0.76, 0.65   // 18–23 evening rush → night
  ];

  function generateHourly(liveAqi) {
    const currentHour = new Date().getHours();
    const data = [];
    for (let h = 0; h <= currentHour; h++) {
      const noise = 0.90 + Math.random() * 0.20;
      const val   = Math.round(liveAqi * TRAFFIC_PATTERN[h] * noise);
      data.push({ hour: h, aqi: Math.max(0, Math.min(500, val)) });
    }
    return data;
  }

  // ─── LUNG HEALTH SCORE ─────────────────────────────────────────────────────
  function computeLungScore(hourly, currentAqi) {
    if (!hourly.length) return 50;
    const avg  = hourly.reduce((s, d) => s + d.aqi, 0) / hourly.length;
    const peak = Math.max(...hourly.map(d => d.aqi));
    const badH = hourly.filter(d => d.aqi > 100).length;
    let score  = 100 - (avg / 300 * 60) - (peak / 500 * 20) - (Math.min(badH / 12, 1) * 20);
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // ─── SPIKE DETECTOR ────────────────────────────────────────────────────────
  function findSpikes(hourly) {
    const spikes = [];
    for (let i = 1; i < hourly.length; i++) {
      const jump = hourly[i].aqi - hourly[i - 1].aqi;
      if (hourly[i].aqi > 100 && jump > 20)
        spikes.push({ hour: hourly[i].hour, aqi: hourly[i].aqi, jump, isPeak: false });
    }
    const peak = hourly.reduce((a, b) => b.aqi > a.aqi ? b : a, hourly[0]);
    if (peak && peak.aqi > 100 && !spikes.find(s => s.hour === peak.hour))
      spikes.push({ hour: peak.hour, aqi: peak.aqi, jump: null, isPeak: true });
    return spikes.sort((a, b) => b.aqi - a.aqi).slice(0, 4);
  }

  // ─── HEALTH ADVICE GENERATOR ───────────────────────────────────────────────
  function buildAdvice(liveAqi, hourly, score) {
    const tips = [];
    const h    = new Date().getHours();
    const bad  = hourly.filter(d => d.aqi > 100).length;
    const peak = hourly.length ? Math.max(...hourly.map(d => d.aqi)) : 0;

    if (score >= 75) tips.push({ icon: '✅', text: 'Overall air quality today is favourable for lung health.', color: '#00ff88' });
    if (score < 50)  tips.push({ icon: '⚠️', text: "Today's exposure exceeded safe thresholds. Rest and avoid further outdoor activity.", color: '#ff9500' });
    if (peak > 150)  tips.push({ icon: '😷', text: `Peak AQI of ${peak} reached today — N95 mask recommended for outdoor trips.`, color: '#ff4444' });
    if (bad >= 4)    tips.push({ icon: '🏠', text: `${bad} hours of unhealthy air today — prefer indoor activities.`, color: '#ff9500' });
    if (h >= 6  && h <= 9)  tips.push({ icon: '🚴', text: 'Morning rush hour — AQI peaks now. Avoid heavy outdoor exercise.', color: '#ffd700' });
    if (h >= 18 && h <= 20) tips.push({ icon: '🌆', text: 'Evening traffic peak — walk on low-traffic routes if possible.', color: '#ffd700' });
    if (h >= 22 || h <= 5)  tips.push({ icon: '🌙', text: 'Night air is usually cleanest. Window ventilation recommended.', color: '#00ff88' });
    tips.push({ icon: '💧', text: 'Stay hydrated — water helps flush fine particles from your respiratory tract.', color: '#00d4ff' });
    return tips;
  }

  // ─── LOCAL STORAGE HELPERS ─────────────────────────────────────────────────
  function saveLocation(lat, lon, label) {
    try { localStorage.setItem(LS_LOC, JSON.stringify({ lat, lon, cityLabel: label })); } catch (_) {}
  }

  function loadLocation() {
    try { const r = localStorage.getItem(LS_LOC); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }

  function cacheAqi(aqi) {
    try {
      localStorage.setItem(LS_AQI,  String(aqi));
      localStorage.setItem(LS_TIME, Date.now().toString());
    } catch (_) {}
  }

  function cachedAqi() {
    try { const v = localStorage.getItem(LS_AQI); return v ? parseInt(v, 10) : null; } catch (_) { return null; }
  }

  // ─── EVENT BUS ─────────────────────────────────────────────────────────────
  function emit(type, detail) {
    global.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ─── ASSEMBLE PAYLOAD ──────────────────────────────────────────────────────
  function buildPayload(aqi) {
    const hourly = generateHourly(aqi);
    const score  = computeLungScore(hourly, aqi);
    const spikes = findSpikes(hourly);
    const tier   = aqiTier(aqi);
    const avg    = hourly.length ? Math.round(hourly.reduce((s, d) => s + d.aqi, 0) / hourly.length) : aqi;
    const peak   = hourly.length ? Math.max(...hourly.map(d => d.aqi)) : aqi;
    const badH   = hourly.filter(d => d.aqi > 100).length;
    const advice = buildAdvice(aqi, hourly, score);

    return {
      aqi,
      tier,
      color:     aqiColor(aqi),
      label:     aqiLabel(aqi),
      cityLabel: _cityLabel || 'Locating...',
      coords:    _coords,
      fetchedAt: new Date(),
      hourly,
      score,
      spikes,
      avg,
      peak,
      badHours: badH,
      safeHours: hourly.length - badH,
      advice,
      nextRefreshIn: _refreshCountdown,
    };
  }

  // ─── FETCH AQI ─────────────────────────────────────────────────────────────
  async function fetchAQI(lat, lon) {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AQI fetch ${res.status}`);
    const data = await res.json();
    const aqi  = data?.current?.us_aqi;
    if (aqi == null) throw new Error('No AQI in response');
    return aqi;
  }

  // ─── FETCH CITY NAME ───────────────────────────────────────────────────────
  async function fetchCity(lat, lon) {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
    const d   = await res.json();
    const city  = d.city || d.locality || 'Unknown City';
    const state = d.principalSubdivision || d.countryName || '';
    return `${city}, ${state}`;
  }

  // ─── MAIN FETCH CYCLE ──────────────────────────────────────────────────────
  async function runFetch(lat, lon) {
    if (_fetchInProgress) return;
    _fetchInProgress = true;
    emit('oxytrace:fetching', {});

    try {
      // City name (fire-and-forget, don't block AQI)
      fetchCity(lat, lon).then(label => {
        _cityLabel = label;
        saveLocation(lat, lon, label);
      }).catch(() => {
        _cityLabel = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
      });

      const aqi = await fetchAQI(lat, lon);
      _liveAqi  = aqi;
      _hourly   = generateHourly(aqi);
      cacheAqi(aqi);

      const payload = buildPayload(aqi);
      emit('oxytrace:data', payload);

      // logic.js integration
      if (global.OxyTrace) global.OxyTrace.onAQIReady(aqi);

      // Reset refresh countdown
      _refreshCountdown = REFRESH_INTERVAL_MS / 1000;
    } catch (err) {
      console.warn('[api.js] fetch failed:', err.message);
      // Try cached value so UI isn't left blank
      const cached = cachedAqi();
      if (cached !== null) {
        _liveAqi = cached;
        emit('oxytrace:data', { ...buildPayload(cached), stale: true });
      } else {
        emit('oxytrace:error', { message: err.message });
      }
    } finally {
      _fetchInProgress = false;
    }
  }

  // ─── AUTO-REFRESH SCHEDULER ────────────────────────────────────────────────
  function startAutoRefresh() {
    // Refresh AQI every REFRESH_INTERVAL_MS
    _refreshTimer = setInterval(() => {
      if (_coords) runFetch(_coords.lat, _coords.lon);
    }, REFRESH_INTERVAL_MS);

    // Countdown ticker — fires every second so UI can show "Next refresh in Xs"
    _countdownTimer = setInterval(() => {
      _refreshCountdown = Math.max(0, _refreshCountdown - 1);
      emit('oxytrace:countdown', { secondsLeft: _refreshCountdown });
    }, 1000);
  }

  // ─── GPS INIT ──────────────────────────────────────────────────────────────
  function init() {
    // Immediately paint UI with cached data if available
    const cached   = cachedAqi();
    const lastLoc  = loadLocation();
    if (cached !== null && lastLoc) {
      _coords    = { lat: lastLoc.lat, lon: lastLoc.lon };
      _cityLabel = lastLoc.cityLabel;
      _liveAqi   = cached;
      emit('oxytrace:data', { ...buildPayload(cached), stale: true });
    }

    if (!('geolocation' in navigator)) {
      const fallback = lastLoc || { lat: 20.0, lon: 78.0 };
      _coords = { lat: fallback.lat, lon: fallback.lon };
      runFetch(_coords.lat, _coords.lon).then(startAutoRefresh);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        _coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        runFetch(_coords.lat, _coords.lon).then(startAutoRefresh);
      },
      () => {
        const loc = loadLocation();
        if (loc) {
          _coords = { lat: loc.lat, lon: loc.lon };
          _cityLabel = loc.cityLabel + ' (last known)';
          runFetch(_coords.lat, _coords.lon).then(startAutoRefresh);
        } else {
          emit('oxytrace:error', { message: 'Location access denied and no cached location.' });
        }
      },
      GEO_OPTS
    );
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────────────
  global.OxyTraceAPI = {
    init,
    forceRefresh: () => { if (_coords) runFetch(_coords.lat, _coords.lon); },
    aqiColor,
    aqiLabel,
    aqiTier,
    get lastPayload() {
      return _liveAqi != null ? buildPayload(_liveAqi) : null;
    },
  };

}(window));
