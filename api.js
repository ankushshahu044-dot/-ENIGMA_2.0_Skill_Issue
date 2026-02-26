/**
 * api.js — OxyTrace Data Layer  v3.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Used by: health.html
 *
 * Coordinates:
 *  • If app.js has already fired 'oxytrace:data' (i.e. profile.html / index.html
 *    called startLivePipeline), api.js simply re-fires the cached payload so
 *    health.html doesn't need to do a second GPS request.
 *  • If no payload is available yet, api.js runs its own GPS + AQI pipeline
 *    using WAQI with Open-Meteo as fallback.
 *
 * All pages:
 *  • NEVER fetch data themselves — they only listen to 'oxytrace:data'.
 *
 * Events fired:
 *   oxytrace:fetching   — fetch in progress
 *   oxytrace:data       — full payload ready
 *   oxytrace:countdown  — { secondsLeft } every 1 s
 *   oxytrace:error      — { message } on failure with no cache
 */

(function (global) {
  'use strict';

  const WAQI_TOKEN         = '4e8a7681495d03130e89e15bf00c32368b90a133';
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const GEO_OPTS = { enableHighAccuracy: true, timeout: 14000, maximumAge: 30000 };
  const LS_LOC   = 'oxtrace_last_loc';
  const LS_AQI   = 'oxtrace_last_aqi';

  let _coords    = null;
  let _cityLabel = null;
  let _liveAqi   = null;
  let _refreshTimer    = null;
  let _countdownTimer  = null;
  let _countdown = REFRESH_INTERVAL_MS / 1000;
  let _fetchInProgress = false;

  // ── AQI helpers ─────────────────────────────────────────────────────────────
  function aqiColor(v) {
    if (v==null) return '#4a6680';
    if (v<=50)  return '#00ff88';
    if (v<=100) return '#ffd700';
    if (v<=150) return '#ff9500';
    if (v<=200) return '#ff4444';
    if (v<=300) return '#cc44ff';
    return '#ff0000';
  }
  function aqiLabel(v) {
    if (v==null) return 'N/A';
    if (v<=50)  return 'Good';
    if (v<=100) return 'Moderate';
    if (v<=150) return 'Sensitive Grps';
    if (v<=200) return 'Unhealthy';
    if (v<=300) return 'Very Unhealthy';
    return 'Hazardous';
  }
  function aqiTier(v) {
    if (v==null) return { label:'⏳ LOADING',sub:'Fetching air quality',color:'#00d4ff',glow:'rgba(0,212,255,0.5)' };
    if (v<=50)  return { label:'✓ GOOD',sub:'Air quality is satisfactory',color:'#00ff88',glow:'rgba(0,255,136,0.5)' };
    if (v<=100) return { label:'⚠ MODERATE',sub:'Sensitive groups affected',color:'#ffd700',glow:'rgba(255,215,0,0.5)' };
    if (v<=150) return { label:'⚠ UNHEALTHY·SENS.',sub:'Limit prolonged exertion',color:'#ff9500',glow:'rgba(255,149,0,0.5)' };
    if (v<=200) return { label:'✕ UNHEALTHY',sub:'Everyone may be affected',color:'#ff4444',glow:'rgba(255,68,68,0.5)' };
    if (v<=300) return { label:'✕ VERY UNHEALTHY',sub:'Health alert — avoid outdoors',color:'#cc00ff',glow:'rgba(204,0,255,0.5)' };
    return      { label:'☠ HAZARDOUS',sub:'Emergency — stay indoors',color:'#ff0000',glow:'rgba(255,0,0,0.7)' };
  }

  // ── Hourly pattern ───────────────────────────────────────────────────────────
  const TRAFFIC_PATTERN = [
    0.55,0.50,0.47,0.45,0.50,0.60,
    0.80,1.05,1.18,1.08,0.92,0.85,
    0.87,0.84,0.82,0.86,0.95,1.12,
    1.22,1.12,0.96,0.86,0.76,0.65
  ];
  function generateHourly(liveAqi) {
    const H = new Date().getHours();
    return Array.from({length: H+1}, (_,h) => ({
      hour: h,
      aqi:  Math.max(0, Math.min(500, Math.round(liveAqi * TRAFFIC_PATTERN[h] * (0.90+Math.random()*0.20))))
    }));
  }

  // ── Health computations ──────────────────────────────────────────────────────
  function computeLungScore(hourly) {
    if (!hourly.length) return 50;
    const avg  = hourly.reduce((s,d)=>s+d.aqi,0)/hourly.length;
    const peak = Math.max(...hourly.map(d=>d.aqi));
    const badH = hourly.filter(d=>d.aqi>100).length;
    return Math.round(Math.max(0, Math.min(100, 100-(avg/300*60)-(peak/500*20)-(Math.min(badH/12,1)*20))));
  }
  function findSpikes(hourly) {
    const spikes=[];
    for(let i=1;i<hourly.length;i++){
      const jump=hourly[i].aqi-hourly[i-1].aqi;
      if(hourly[i].aqi>100&&jump>20) spikes.push({hour:hourly[i].hour,aqi:hourly[i].aqi,jump,isPeak:false});
    }
    const peak=hourly.reduce((a,b)=>b.aqi>a.aqi?b:a,hourly[0]);
    if(peak&&peak.aqi>100&&!spikes.find(s=>s.hour===peak.hour))
      spikes.push({hour:peak.hour,aqi:peak.aqi,jump:null,isPeak:true});
    return spikes.sort((a,b)=>b.aqi-a.aqi).slice(0,4);
  }
  function buildAdvice(aqi, hourly, score) {
    const tips=[]; const h=new Date().getHours();
    const bad=hourly.filter(d=>d.aqi>100).length;
    const peak=Math.max(...hourly.map(d=>d.aqi),0);
    if(score>=75) tips.push({icon:'✅',text:'Overall air quality today is favourable for lung health.',color:'#00ff88'});
    if(score<50)  tips.push({icon:'⚠️',text:"Today's exposure exceeded safe thresholds. Rest and avoid further outdoor activity.",color:'#ff9500'});
    if(peak>150)  tips.push({icon:'😷',text:`Peak AQI of ${peak} reached — N95 mask recommended for outdoor trips.`,color:'#ff4444'});
    if(bad>=4)    tips.push({icon:'🏠',text:`${bad} hours of unhealthy air today — prefer indoor activities.`,color:'#ff9500'});
    if(h>=6&&h<=9)   tips.push({icon:'🚴',text:'Morning rush hour — AQI peaks now. Avoid heavy outdoor exercise.',color:'#ffd700'});
    if(h>=18&&h<=20) tips.push({icon:'🌆',text:'Evening traffic peak — walk on low-traffic routes if possible.',color:'#ffd700'});
    if(h>=22||h<=5)  tips.push({icon:'🌙',text:'Night air is usually cleanest. Window ventilation recommended.',color:'#00ff88'});
    tips.push({icon:'💧',text:'Stay hydrated — water helps flush fine particles from your respiratory tract.',color:'#00d4ff'});
    return tips;
  }

  // ── localStorage ─────────────────────────────────────────────────────────────
  function saveLocation(lat,lon,label){ try{localStorage.setItem(LS_LOC,JSON.stringify({lat,lon,cityLabel:label}));}catch(_){} }
  function loadLocation(){ try{const r=localStorage.getItem(LS_LOC);return r?JSON.parse(r):null;}catch(_){return null;} }
  function cacheAqi(aqi){ try{localStorage.setItem(LS_AQI,String(aqi));}catch(_){} }
  function cachedAqi(){ try{const v=localStorage.getItem(LS_AQI);return v?parseInt(v,10):null;}catch(_){return null;} }

  // ── Event bus ────────────────────────────────────────────────────────────────
  function emit(type, detail){ global.dispatchEvent(new CustomEvent(type,{detail})); }

  // ── Build full payload ───────────────────────────────────────────────────────
  function buildPayload(aqi, opts={}) {
    const hourly  = generateHourly(aqi);
    const score   = computeLungScore(hourly);
    const spikes  = findSpikes(hourly);
    const tier    = aqiTier(aqi);
    const avg     = Math.round(hourly.reduce((s,d)=>s+d.aqi,0)/Math.max(hourly.length,1));
    const peak    = Math.max(...hourly.map(d=>d.aqi));
    const badH    = hourly.filter(d=>d.aqi>100).length;
    return {
      aqi, tier,
      color:     aqiColor(aqi),
      label:     aqiLabel(aqi),
      cityLabel: opts.cityLabel || _cityLabel || 'Locating…',
      coords:    opts.coords || _coords,
      fetchedAt: new Date(),
      hourly, score, spikes, avg, peak,
      badHours:  badH,
      safeHours: hourly.length - badH,
      advice:    buildAdvice(aqi, hourly, score),
      nextRefreshIn: _countdown,
      stale: opts.stale || false,
    };
  }

  // ── AQI fetch — WAQI then Open-Meteo fallback ────────────────────────────────
  async function fetchAQI(lat, lon) {
    // Try WAQI first
    try {
      const res  = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
      const data = await res.json();
      if (data.status === 'ok') return data.data.aqi;
    } catch(_) {}
    // Fallback to Open-Meteo
    const res  = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`);
    if (!res.ok) throw new Error(`AQI fetch ${res.status}`);
    const data = await res.json();
    const aqi  = data?.current?.us_aqi;
    if (aqi == null) throw new Error('No AQI in response');
    return aqi;
  }

  // ── City name ────────────────────────────────────────────────────────────────
  async function fetchCity(lat, lon) {
    try {
      const res  = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const d    = await res.json();
      const city = d.city || d.locality || 'Unknown City';
      return [city, d.principalSubdivision || d.countryName].filter(Boolean).join(', ');
    } catch(_) {
      return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
    }
  }

  // ── Main fetch cycle ──────────────────────────────────────────────────────────
  async function runFetch(lat, lon) {
    if (_fetchInProgress) return;
    _fetchInProgress = true;
    emit('oxytrace:fetching', {});
    try {
      // City (parallel, non-blocking)
      fetchCity(lat, lon).then(label => {
        _cityLabel = label;
        saveLocation(lat, lon, label);
      });

      const aqi = await fetchAQI(lat, lon);
      _liveAqi  = aqi;
      cacheAqi(aqi);

      const payload = buildPayload(aqi);
      emit('oxytrace:data', payload);

      if (global.OxyTrace) global.OxyTrace.onAQIReady(aqi);
      _countdown = REFRESH_INTERVAL_MS / 1000;
    } catch (err) {
      console.warn('[api.js] fetch failed:', err.message);
      const cached = cachedAqi();
      if (cached !== null) {
        _liveAqi = cached;
        emit('oxytrace:data', buildPayload(cached, { stale: true }));
      } else {
        emit('oxytrace:error', { message: err.message });
      }
    } finally {
      _fetchInProgress = false;
    }
  }

  // ── Auto-refresh scheduler ───────────────────────────────────────────────────
  function startAutoRefresh() {
    _refreshTimer = setInterval(() => {
      if (_coords) runFetch(_coords.lat, _coords.lon);
    }, REFRESH_INTERVAL_MS);
    _countdownTimer = setInterval(() => {
      _countdown = Math.max(0, _countdown - 1);
      emit('oxytrace:countdown', { secondsLeft: _countdown });
    }, 1000);
  }

  // ── INIT ──────────────────────────────────────────────────────────────────────
  function init() {
    // If app.js already has live data cached, just re-fire it
    const cachedAQI = cachedAqi();
    const lastLoc   = loadLocation();
    if (cachedAQI !== null && lastLoc) {
      _coords    = { lat: lastLoc.lat, lon: lastLoc.lon };
      _cityLabel = lastLoc.cityLabel;
      _liveAqi   = cachedAQI;
      // Fire stale payload immediately so UI isn't blank
      emit('oxytrace:data', buildPayload(cachedAQI, { stale: true, cityLabel: _cityLabel }));
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
          _coords    = { lat: loc.lat, lon: loc.lon };
          _cityLabel = loc.cityLabel + ' (last known)';
          runFetch(_coords.lat, _coords.lon).then(startAutoRefresh);
        } else {
          emit('oxytrace:error', { message: 'Location denied and no cached location.' });
        }
      },
      GEO_OPTS
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  global.OxyTraceAPI = {
    init,
    forceRefresh: () => { if (_coords) runFetch(_coords.lat, _coords.lon); },
    aqiColor, aqiLabel, aqiTier,
    get lastPayload() { return _liveAqi != null ? buildPayload(_liveAqi) : null; },
  };

}(window));
