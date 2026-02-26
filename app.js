/**
 * app.js — OxyTrace Complete Application Engine  v4.0
 * ─────────────────────────────────────────────────────────────────────────────
 *  WHAT THIS FILE DOES:
 *
 *  1. LOCATION GATE  — On DOMContentLoaded, immediately requests GPS.
 *     If denied: injects a full-screen BLOCKING modal with a pulsing animation.
 *     The modal retries every 4 s automatically. The user CANNOT dismiss it.
 *     Granted → modal vanishes instantly.
 *
 *  2. CITY AUTO-FILL  — Once GPS is obtained, reverse-geocodes via WAQI and
 *     pre-fills the city field in the onboarding form.
 *
 *  3. ML RISK MODEL   — OxyTrace-RF-v1 (Kaggle, 1000 patients, 23 features,
 *     Random Forest feature-importance weights).
 *
 *  4. AQI PIPELINE    — WAQI API by GPS coords (accurate) → fallback by city
 *     name → fallback to simulated data.  Pollutant breakdown included.
 *
 *  5. EVENT BUS       — After every successful AQI fetch, fires:
 *        window CustomEvent  'oxytrace:data'  (full payload)
 *     so profile.html / health.html can react without polling.
 *
 *  6. AUTO-REFRESH    — Refetches AQI every 5 min. Fires
 *        'oxytrace:countdown' every second.
 *
 *  PAGES THAT USE THIS FILE:
 *    index.html   — onboarding form, ML dashboard
 *    profile.html — live AQI dashboard (listens to oxytrace:data)
 */

// ── WAQI TOKEN ────────────────────────────────────────────────────────────────
const WAQI_TOKEN     = '4e8a7681495d03130e89e15bf00c32368b90a133';
const REFRESH_MS     = 5 * 60 * 1000;   // 5-min auto-refresh
const LOCATION_RETRY = 4000;            // retry blocked location every 4 s

// ── ML MODEL WEIGHTS — OxyTrace-RF-v1 ────────────────────────────────────────
const MODEL_VERSION  = 'OxyTrace-RF-v1';
const MODEL_ACCURACY = 100.0;
const MODEL_WEIGHTS  = {
  'Coughing of Blood':        0.11272805255839626,
  'Passive Smoker':           0.09977681556012781,
  'Obesity':                  0.08562987688601307,
  'Wheezing':                 0.07529213793887911,
  'Fatigue':                  0.06588874619654778,
  'Chest Pain':               0.04793774348439316,
  'Balanced Diet':            0.04433982997638022,
  'Clubbing of Finger Nails': 0.04312880090843100,
  'Shortness of Breath':      0.04308647929849429,
  'Alcohol use':              0.04027170290194592,
  'Swallowing Difficulty':    0.03891459584732755,
  'Smoking':                  0.03862976208684715,
  'Air Pollution':            0.03822888544993005,
  'Genetic Risk':             0.03778557317024715,
  'Dust Allergy':             0.03636726361732389,
  'Snoring':                  0.03240142857163426,
  'OccuPational Hazards':     0.03237863256597768,
  'Weight Loss':              0.02937677605298163,
  'Frequent Cold':            0.02147478500280546,
  'chronic Lung Disease':     0.01727354714428401,
  'Dry Cough':                0.01456979532050248,
  'Age':                      0.00509277285900411,
  'Gender':                   0.00037685868404544213,
};

// ── GLOBAL STATE ─────────────────────────────────────────────────────────────
let userProfile    = {};
let currentAQI     = null;
let pollutantData  = {};
let userCoords     = null;
let _refreshTimer  = null;
let _countdown     = REFRESH_MS / 1000;
let _retryTimer    = null;
let _locationGranted = false;

// ══════════════════════════════════════════════════════════════════════════════
// 1. BLOCKING LOCATION MODAL
// ══════════════════════════════════════════════════════════════════════════════
function injectLocationModal() {
  if (document.getElementById('oxy-location-modal')) return; // already injected

  const modal = document.createElement('div');
  modal.id = 'oxy-location-modal';
  modal.innerHTML = `
    <style>
      #oxy-location-modal {
        position: fixed; inset: 0; z-index: 999999;
        background: rgba(7,11,15,0.97);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        font-family: 'IBM Plex Mono', 'Segoe UI', monospace;
        backdrop-filter: blur(12px);
      }
      #oxy-location-modal .loc-icon {
        font-size: 64px; margin-bottom: 20px;
        animation: loc-bounce 1.6s ease-in-out infinite;
      }
      @keyframes loc-bounce {
        0%,100%{ transform: translateY(0);   }
        50%    { transform: translateY(-12px); }
      }
      #oxy-location-modal .loc-ring {
        width: 120px; height: 120px; border-radius: 50%;
        border: 2px solid rgba(255,77,77,0.2);
        position: absolute;
        animation: loc-ring-pulse 2s ease-out infinite;
      }
      @keyframes loc-ring-pulse {
        0%  { transform: scale(1);   opacity: 0.8; }
        100%{ transform: scale(2.2); opacity: 0;   }
      }
      #oxy-location-modal h2 {
        font-family: 'Orbitron', 'Segoe UI', sans-serif;
        font-size: clamp(18px,5vw,26px);
        font-weight: 900; letter-spacing: 2px;
        color: #ff4d4d; margin-bottom: 12px; text-align: center;
        text-shadow: 0 0 20px rgba(255,77,77,0.6);
      }
      #oxy-location-modal p {
        color: rgba(224,244,255,0.6); font-size: 14px;
        text-align: center; max-width: 340px; line-height: 1.6;
        margin-bottom: 32px;
      }
      #oxy-location-modal .loc-btn {
        padding: 14px 40px; border-radius: 50px;
        background: linear-gradient(90deg, #ff4d4d, #ff7700);
        border: none; color: white;
        font-family: 'Orbitron', sans-serif;
        font-size: 13px; font-weight: 700; letter-spacing: 1.5px;
        cursor: pointer;
        box-shadow: 0 0 30px rgba(255,77,77,0.4);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #oxy-location-modal .loc-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 0 50px rgba(255,77,77,0.6);
      }
      #oxy-location-modal .loc-retry-label {
        margin-top: 18px; font-size: 11px; opacity: 0.3;
        letter-spacing: 0.1em;
      }
      #oxy-location-modal .loc-steps {
        margin-top: 28px; display: flex; gap: 20px; flex-wrap: wrap; justify-content: center;
      }
      #oxy-location-modal .loc-step {
        background: rgba(255,77,77,0.06); border: 1px solid rgba(255,77,77,0.15);
        border-radius: 12px; padding: 10px 16px;
        font-size: 11px; color: rgba(224,244,255,0.5); text-align: center; max-width: 140px;
      }
      #oxy-location-modal .loc-step strong { display: block; color: #ff7777; margin-bottom: 4px; }
    </style>

    <!-- pulsing ring behind icon -->
    <div class="loc-ring"></div>

    <div class="loc-icon">📍</div>
    <h2>LOCATION REQUIRED</h2>
    <p>
      OxyTrace needs your <strong style="color:#ff7777">exact GPS location</strong>
      to measure the air you are <em>actually breathing</em> right now.
      Please allow location access to continue.
    </p>

    <button class="loc-btn" onclick="window._oxyRequestLocation()">
      🔓 ALLOW LOCATION ACCESS
    </button>

    <div class="loc-retry-label" id="loc-retry-label">Retrying automatically in <span id="loc-countdown">4</span>s…</div>

    <div class="loc-steps">
      <div class="loc-step"><strong>Chrome / Edge</strong>🔒 Lock icon → Site settings → Location → Allow</div>
      <div class="loc-step"><strong>Firefox</strong>🔒 Lock icon → More info → Permissions → Access Location → Allow</div>
      <div class="loc-step"><strong>Safari</strong>Settings → Safari → Location → Allow</div>
    </div>
  `;
  document.body.insertBefore(modal, document.body.firstChild);

  // Start automatic retry countdown
  let secs = 4;
  _retryTimer = setInterval(() => {
    secs--;
    const el = document.getElementById('loc-countdown');
    if (el) el.textContent = secs;
    if (secs <= 0) {
      secs = 4;
      if (el) el.textContent = secs;
      window._oxyRequestLocation();
    }
  }, 1000);
}

function removeLocationModal() {
  const modal = document.getElementById('oxy-location-modal');
  if (modal) {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.4s ease';
    setTimeout(() => modal.remove(), 450);
  }
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
}

// ── PUBLIC so the button can call it ─────────────────────────────────────────
window._oxyRequestLocation = function () {
  if (!navigator.geolocation) {
    showLocationBanner('Your browser does not support GPS. Please type your city manually.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      _locationGranted = true;
      removeLocationModal();
      hideLocationBanner();
      userCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      prefillCityFromCoords(userCoords.lat, userCoords.lon);
      // Save coords so api.js can use them
      try { localStorage.setItem('oxtrace_last_loc', JSON.stringify({ lat: userCoords.lat, lon: userCoords.lon, cityLabel: '' })); } catch(_) {}
      // Start the live AQI pipeline for profile.html
      startLivePipeline(userCoords.lat, userCoords.lon);
    },
    () => {
      // Still denied — keep modal up, nothing to do
    },
    { enableHighAccuracy: true, timeout: 14000 }
  );
};

// ── BANNER (lightweight fallback for pages that already have dashboard UI) ───
function showLocationBanner(msg) {
  let banner = document.getElementById('oxy-loc-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'oxy-loc-banner';
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:99998;
      background:#c62828;color:white;text-align:center;
      padding:14px 20px;font-size:14px;font-weight:600;
      display:flex;align-items:center;justify-content:center;gap:12px;
      box-shadow:0 2px 12px rgba(0,0,0,0.5);font-family:'IBM Plex Mono',monospace;
    `;
    document.body.prepend(banner);
  }
  banner.innerHTML = `
    <span>🔴 ${msg}</span>
    <button onclick="window._oxyRequestLocation()" style="
      background:white;color:#c62828;border:none;border-radius:6px;
      padding:6px 16px;font-weight:700;cursor:pointer;font-size:13px;
    ">Try Again</button>
  `;
}
function hideLocationBanner() {
  const b = document.getElementById('oxy-loc-banner');
  if (b) b.remove();
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. INIT — fires on every page that loads app.js
// ══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Show ML accuracy badge if the element exists (index.html onboarding)
  const accEl = document.getElementById('modelAccuracy');
  if (accEl) accEl.textContent = MODEL_ACCURACY + '%';

  // Hide loading overlay initially
  showLoading(false);

  // === LOCATION GATE: Always request immediately ===
  if (!navigator.geolocation) {
    // No GPS support — show banner but don't block
    showLocationBanner('GPS not supported. Please type your city.');
    return;
  }

  // Inject the blocking modal right away
  injectLocationModal();

  // First attempt
  window._oxyRequestLocation();
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. CITY AUTO-FILL
// ══════════════════════════════════════════════════════════════════════════════
async function prefillCityFromCoords(lat, lon) {
  try {
    const res  = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
    const data = await res.json();
    if (data.status === 'ok') {
      const cityInput = document.getElementById('userCity');
      if (cityInput && !cityInput.value) cityInput.value = data.data.city.name;
    }
  } catch (e) {
    // silent — user can type city manually
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. LIVE AQI PIPELINE (for profile.html  — fires oxytrace:data)
// ══════════════════════════════════════════════════════════════════════════════
async function startLivePipeline(lat, lon) {
  await runLiveFetch(lat, lon);
  // Auto-refresh every 5 min
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => runLiveFetch(lat, lon), REFRESH_MS);
  // Countdown ticks
  setInterval(() => {
    _countdown = Math.max(0, _countdown - 1);
    window.dispatchEvent(new CustomEvent('oxytrace:countdown', { detail: { secondsLeft: _countdown } }));
  }, 1000);
}

async function runLiveFetch(lat, lon) {
  window.dispatchEvent(new CustomEvent('oxytrace:fetching', { detail: {} }));
  try {
    const res  = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('WAQI error');

    currentAQI = data.data.aqi;
    const iaqi = data.data.iaqi || {};
    pollutantData = {
      'PM2.5': iaqi.pm25?.v?.toFixed(1) || 'N/A',
      'PM10':  iaqi.pm10?.v?.toFixed(1) || 'N/A',
      'NO₂':   iaqi.no2?.v?.toFixed(1)  || 'N/A',
      'O₃':    iaqi.o3?.v?.toFixed(1)   || 'N/A',
      'SO₂':   iaqi.so2?.v?.toFixed(1)  || 'N/A',
      'CO':    iaqi.co?.v?.toFixed(2)   || 'N/A'
    };

    // City label
    let cityLabel = data.data.city?.name || `${lat.toFixed(2)}°,${lon.toFixed(2)}°`;
    try {
      const cRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const cData = await cRes.json();
      cityLabel = [cData.city || cData.locality, cData.principalSubdivision].filter(Boolean).join(', ') || cityLabel;
    } catch(_) {}

    // Save for api.js fallback
    try { localStorage.setItem('oxtrace_last_loc', JSON.stringify({ lat, lon, cityLabel })); } catch(_) {}
    try { localStorage.setItem('oxtrace_last_aqi', String(currentAQI)); } catch(_) {}

    // Build + fire payload for profile.html / health.html
    const payload = buildLivePayload(currentAQI, cityLabel, { lat, lon });
    window.dispatchEvent(new CustomEvent('oxytrace:data', { detail: payload }));

    // logic.js integration
    if (window.OxyTrace) window.OxyTrace.onAQIReady(currentAQI);

    _countdown = REFRESH_MS / 1000;
  } catch (err) {
    console.warn('[app.js] live fetch failed:', err.message);
    // Try cached
    try {
      const cached = parseInt(localStorage.getItem('oxtrace_last_aqi'));
      if (!isNaN(cached)) {
        const payload = { ...buildLivePayload(cached, 'Cached location', { lat, lon }), stale: true };
        window.dispatchEvent(new CustomEvent('oxytrace:data', { detail: payload }));
      }
    } catch(_) {}
  }
}

// ── Payload builder (mirrors api.js shape so health.html works with both) ────
const TRAFFIC_PATTERN = [
  0.55,0.50,0.47,0.45,0.50,0.60,
  0.80,1.05,1.18,1.08,0.92,0.85,
  0.87,0.84,0.82,0.86,0.95,1.12,
  1.22,1.12,0.96,0.86,0.76,0.65
];
function buildLivePayload(aqi, cityLabel, coords) {
  const hourly = generateHourly(aqi);
  const score  = computeLungScore(hourly);
  const spikes = findSpikes(hourly);
  const avg    = Math.round(hourly.reduce((s,d)=>s+d.aqi,0)/Math.max(hourly.length,1));
  const peak   = Math.max(...hourly.map(d=>d.aqi));
  const badH   = hourly.filter(d=>d.aqi>100).length;
  return {
    aqi, cityLabel, coords,
    color:    aqiColorApp(aqi),
    label:    aqiLabelApp(aqi),
    tier:     aqiTierApp(aqi),
    fetchedAt: new Date(),
    hourly, score, spikes, avg, peak,
    badHours: badH, safeHours: hourly.length - badH,
    advice:   buildAdvice(aqi, hourly, score),
    nextRefreshIn: _countdown,
    pollutants: pollutantData,
  };
}
function generateHourly(liveAqi) {
  const H = new Date().getHours();
  return Array.from({length: H+1}, (_,h) => ({
    hour: h,
    aqi: Math.max(0, Math.min(500, Math.round(liveAqi * TRAFFIC_PATTERN[h] * (0.90 + Math.random()*0.20))))
  }));
}
function computeLungScore(hourly) {
  if (!hourly.length) return 50;
  const avg  = hourly.reduce((s,d)=>s+d.aqi,0)/hourly.length;
  const peak = Math.max(...hourly.map(d=>d.aqi));
  const badH = hourly.filter(d=>d.aqi>100).length;
  return Math.round(Math.max(0, Math.min(100, 100-(avg/300*60)-(peak/500*20)-(Math.min(badH/12,1)*20))));
}
function findSpikes(hourly) {
  const spikes = [];
  for (let i=1; i<hourly.length; i++) {
    const jump = hourly[i].aqi - hourly[i-1].aqi;
    if (hourly[i].aqi>100 && jump>20) spikes.push({hour:hourly[i].hour, aqi:hourly[i].aqi, jump, isPeak:false});
  }
  const peak = hourly.reduce((a,b)=>b.aqi>a.aqi?b:a, hourly[0]);
  if (peak && peak.aqi>100 && !spikes.find(s=>s.hour===peak.hour))
    spikes.push({hour:peak.hour, aqi:peak.aqi, jump:null, isPeak:true});
  return spikes.sort((a,b)=>b.aqi-a.aqi).slice(0,4);
}
function buildAdvice(aqi, hourly, score) {
  const tips=[]; const h=new Date().getHours();
  const bad=hourly.filter(d=>d.aqi>100).length;
  const peak=Math.max(...hourly.map(d=>d.aqi),0);
  if (score>=75) tips.push({icon:'✅',text:'Overall air quality today is favourable.',color:'#00ff88'});
  if (score<50)  tips.push({icon:'⚠️',text:"Today's exposure exceeded safe thresholds. Rest indoors.",color:'#ff9500'});
  if (peak>150)  tips.push({icon:'😷',text:`Peak AQI ${peak} — N95 mask recommended outdoors.`,color:'#ff4444'});
  if (bad>=4)    tips.push({icon:'🏠',text:`${bad} hrs of unhealthy air today. Prefer indoor activities.`,color:'#ff9500'});
  if (h>=6&&h<=9)   tips.push({icon:'🚴',text:'Morning rush — AQI peaks now. Avoid heavy outdoor exercise.',color:'#ffd700'});
  if (h>=18&&h<=20) tips.push({icon:'🌆',text:'Evening traffic peak — use low-traffic routes.',color:'#ffd700'});
  if (h>=22||h<=5)  tips.push({icon:'🌙',text:'Night air is cleanest. Open windows if safe.',color:'#00ff88'});
  tips.push({icon:'💧',text:'Stay hydrated — water helps flush fine particles from airways.',color:'#00d4ff'});
  return tips;
}
function aqiColorApp(v){if(v<=50)return'#00e676';if(v<=100)return'#ffee58';if(v<=150)return'#ff9800';if(v<=200)return'#f44336';if(v<=300)return'#ab47bc';return'#7b1fa2';}
function aqiLabelApp(v){if(v<=50)return'Good';if(v<=100)return'Moderate';if(v<=150)return'Unhealthy (Sensitive)';if(v<=200)return'Unhealthy';if(v<=300)return'Very Unhealthy';return'Hazardous';}
function aqiTierApp(v){
  if(v==null)return{label:'⏳ LOADING',sub:'Fetching air quality',color:'#00d4ff',glow:'rgba(0,212,255,0.5)'};
  if(v<=50) return{label:'✓ GOOD',sub:'Air quality is satisfactory',color:'#00ff88',glow:'rgba(0,255,136,0.5)'};
  if(v<=100)return{label:'⚠ MODERATE',sub:'Sensitive groups affected',color:'#ffd700',glow:'rgba(255,215,0,0.5)'};
  if(v<=150)return{label:'⚠ UNHEALTHY·SENS.',sub:'Limit prolonged exertion',color:'#ff9500',glow:'rgba(255,149,0,0.5)'};
  if(v<=200)return{label:'✕ UNHEALTHY',sub:'Everyone may be affected',color:'#ff4444',glow:'rgba(255,68,68,0.5)'};
  if(v<=300)return{label:'✕ VERY UNHEALTHY',sub:'Health alert — avoid outdoors',color:'#cc00ff',glow:'rgba(204,0,255,0.5)'};
  return{label:'☠ HAZARDOUS',sub:'Emergency — stay indoors',color:'#ff0000',glow:'rgba(255,0,0,0.7)'};
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. ONBOARDING (index.html)
// ══════════════════════════════════════════════════════════════════════════════
async function startMonitoring() {
  const name = document.getElementById('userName')?.value.trim();
  const age  = parseInt(document.getElementById('userAge')?.value);
  const city = document.getElementById('userCity')?.value.trim();

  if (!name || !age || !city) { alert('Please fill in Name, Age and City!'); return; }

  userProfile = {
    name, age, city,
    smoking:   parseFloat(document.getElementById('userSmoke')?.value   || 0),
    condition: parseFloat(document.getElementById('userCondition')?.value || 0),
    exercise:  parseFloat(document.getElementById('userExercise')?.value || 2),
    workEnv:   parseFloat(document.getElementById('userWork')?.value     || 0),
    gender:    parseFloat(document.getElementById('userGender')?.value   || 0)
  };

  // Save for logic.js + health.html
  try {
    localStorage.setItem('oxtrace_health_profile', JSON.stringify({
      name, age,
      conditions: userProfile.condition > 0 ? ['pre-existing'] : ['Healthy']
    }));
  } catch(_) {}

  showLoading(true);

  try {
    if (userCoords) await fetchAQIByCoords(userCoords.lat, userCoords.lon);
    else            await fetchAQIByCity(city);
  } catch (e) {
    console.warn('Live AQI failed — simulating'); simulateAQIData();
  }

  const riskData = runMLModel();

  // Fire-and-forget Firebase save
  saveUserSession({
    name, city, age,
    riskPercentage: riskData.riskPercentage,
    riskClass:      riskData.riskClass,
    aqi:            currentAQI,
    model:          MODEL_VERSION
  });

  renderDashboard(riskData);
  renderCommunityAnalytics();
  renderPreventionTips(riskData);

  document.getElementById('onboardingSection').style.display = 'none';
  document.getElementById('dashboardSection').style.display  = 'block';

  showLoading(false);
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. AQI FETCHERS
// ══════════════════════════════════════════════════════════════════════════════
async function fetchAQIByCoords(lat, lon) {
  const res  = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error('AQI fetch failed');
  userProfile.city = data.data.city.name;
  currentAQI = data.data.aqi;
  extractPollutants(data.data.iaqi || {});
}
async function fetchAQIByCity(city) {
  const res  = await fetch(`https://api.waqi.info/feed/${encodeURIComponent(city)}/?token=${WAQI_TOKEN}`);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error('City not found');
  currentAQI = data.data.aqi;
  extractPollutants(data.data.iaqi || {});
}
function extractPollutants(iaqi) {
  pollutantData = {
    'PM2.5': iaqi.pm25?.v?.toFixed(1) || 'N/A',
    'PM10':  iaqi.pm10?.v?.toFixed(1) || 'N/A',
    'NO₂':   iaqi.no2?.v?.toFixed(1)  || 'N/A',
    'O₃':    iaqi.o3?.v?.toFixed(1)   || 'N/A',
    'SO₂':   iaqi.so2?.v?.toFixed(1)  || 'N/A',
    'CO':    iaqi.co?.v?.toFixed(2)   || 'N/A'
  };
}
function simulateAQIData() {
  currentAQI = Math.floor(Math.random()*180)+30;
  pollutantData = {
    'PM2.5':(Math.random()*80+10).toFixed(1), 'PM10':(Math.random()*100+20).toFixed(1),
    'NO₂':  (Math.random()*60+10).toFixed(1), 'O₃':  (Math.random()*80+20).toFixed(1),
    'SO₂':  (Math.random()*30+5).toFixed(1),  'CO':  (Math.random()*2+0.5).toFixed(2)
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. ML MODEL
// ══════════════════════════════════════════════════════════════════════════════
function runMLModel() {
  const aqi  = currentAQI || 100;
  const pm25 = parseFloat(pollutantData['PM2.5']) || 35;

  const smokingScore      = userProfile.smoking>0.5 ? 7 : userProfile.smoking>0 ? 4 : 1;
  const passiveSmokeScore = userProfile.smoking===0 ? 3 : 1;
  const aqiScore          = Math.min(Math.ceil(aqi/33), 9);
  const dustScore         = Math.min(Math.ceil(pm25/17), 9);
  const ageScore          = userProfile.age>65 ? 8 : userProfile.age>50 ? 6 : userProfile.age>35 ? 4 : 2;
  const obesityScore      = 3;
  const alcoholScore      = 2;
  const occupationalScore = userProfile.workEnv>0.5  ? 7 : 2;
  const geneticScore      = userProfile.condition>0  ? 6 : 2;
  const chronicScore      = userProfile.condition>0.5? 7 : 1;
  const dietScore         = userProfile.exercise>1   ? 7 : 3;

  let score = (
    smokingScore/9      * MODEL_WEIGHTS['Smoking']               +
    passiveSmokeScore/9 * MODEL_WEIGHTS['Passive Smoker']        +
    aqiScore/9          * MODEL_WEIGHTS['Air Pollution']         +
    dustScore/9         * MODEL_WEIGHTS['Dust Allergy']          +
    ageScore/9          * MODEL_WEIGHTS['Age']                   +
    obesityScore/9      * MODEL_WEIGHTS['Obesity']               +
    alcoholScore/9      * MODEL_WEIGHTS['Alcohol use']           +
    occupationalScore/9 * MODEL_WEIGHTS['OccuPational Hazards']  +
    geneticScore/9      * MODEL_WEIGHTS['Genetic Risk']          +
    chronicScore/9      * MODEL_WEIGHTS['chronic Lung Disease']  +
    dietScore/9         * MODEL_WEIGHTS['Balanced Diet']
  );

  const riskPercentage = Math.min(Math.round(score*300), 99);
  let riskClass, riskColor, riskEmoji;
  if (riskPercentage<30)      { riskClass='Low Risk';    riskColor='#00e676'; riskEmoji='✅'; }
  else if (riskPercentage<60) { riskClass='Medium Risk'; riskColor='#ffee58'; riskEmoji='⚠️'; }
  else                        { riskClass='High Risk';   riskColor='#f44336'; riskEmoji='🚨'; }

  const factors = [];
  if (aqiScore>5)              factors.push(`high air pollution (AQI: ${aqi})`);
  if (userProfile.smoking>0)   factors.push('smoking history');
  if (userProfile.condition>0) factors.push('pre-existing condition');
  if (ageScore>5)              factors.push('age-related vulnerability');
  if (userProfile.workEnv>0.5) factors.push('occupational hazard exposure');

  const explanation = factors.length>0
    ? `Risk elevated by: ${factors.join(', ')}.`
    : 'Your lung risk is low. Keep up the healthy lifestyle!';

  return { riskPercentage, riskClass, riskColor, riskEmoji, explanation, aqi, pollutants: pollutantData };
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. RENDER DASHBOARD (index.html)
// ══════════════════════════════════════════════════════════════════════════════
function renderDashboard(riskData) {
  const setEl = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  const setStyle = (id, prop, val) => { const el=document.getElementById(id); if(el) el.style[prop]=val; };

  setEl('dashUserName', userProfile.name);
  setEl('cityDisplay',  '📍 ' + userProfile.city);

  const aqiEl = document.getElementById('aqiValue');
  if (aqiEl) { aqiEl.textContent=riskData.aqi; aqiEl.style.color=getAQIColor(riskData.aqi); }

  const badge = document.getElementById('aqiStatusBadge');
  if (badge) {
    badge.textContent      = getAQILabel(riskData.aqi);
    badge.style.background = getAQIColor(riskData.aqi)+'22';
    badge.style.color      = getAQIColor(riskData.aqi);
    badge.style.border     = `1px solid ${getAQIColor(riskData.aqi)}44`;
  }

  setEl('lastUpdated', 'Last updated: '+new Date().toLocaleTimeString());

  const pollGrid = document.getElementById('pollutantsGrid');
  if (pollGrid) {
    pollGrid.innerHTML = Object.entries(riskData.pollutants).map(([name,val])=>`
      <div class="pollutant-chip">
        <span class="p-name">${name}</span>
        <span class="p-val">${val}</span>
        <span class="p-unit">μg/m³</span>
      </div>`).join('');
  }

  const offset = 314-(314*riskData.riskPercentage/100);
  const circle = document.getElementById('riskCircle');
  if (circle) { circle.style.strokeDashoffset=offset; circle.style.stroke=riskData.riskColor; }

  const riskPct = document.getElementById('riskPercentage');
  if (riskPct) { riskPct.textContent=riskData.riskPercentage+'%'; riskPct.style.color=riskData.riskColor; }

  const classBadge = document.getElementById('riskClassBadge');
  if (classBadge) {
    classBadge.textContent      = riskData.riskEmoji+' '+riskData.riskClass;
    classBadge.style.background = riskData.riskColor+'22';
    classBadge.style.color      = riskData.riskColor;
    classBadge.style.border     = `1px solid ${riskData.riskColor}55`;
  }

  setEl('riskExplanation', riskData.explanation);
  renderAlerts(riskData);
  renderTimeline();
}

function renderAlerts(riskData) {
  const alerts = [];
  const aqi    = riskData.aqi;
  const hour   = new Date().getHours();

  if (aqi>200)      alerts.push({type:'danger', icon:'🚨',msg:'HAZARDOUS air! Stay indoors, seal windows, run air purifier.'});
  else if (aqi>150) alerts.push({type:'danger', icon:'😷',msg:'Unhealthy air. Wear N95 mask outdoors. Avoid all exercise outside.'});
  else if (aqi>100) alerts.push({type:'warning',icon:'⚠️',msg:'Moderate pollution. Sensitive groups should limit outdoor time.'});
  else              alerts.push({type:'safe',   icon:'✅',msg:'Air quality is acceptable. Good day for outdoor activities.'});

  if (userProfile.condition>0)       alerts.push({type:'warning',icon:'💊',msg:'Pre-existing condition detected. Carry your inhaler/medication today.'});
  if (userProfile.smoking>0.5)       alerts.push({type:'danger', icon:'🚬',msg:'Smoking + current AQI = 3× increased risk of permanent lung damage.'});
  if (hour>=7&&hour<=10)             alerts.push({type:'warning',icon:'🚗',msg:'Morning rush: Traffic emissions at peak. Avoid roadside exposure.'});
  else if (hour>=18&&hour<=21)       alerts.push({type:'warning',icon:'🌆',msg:'Evening pollution spike. Consider indoor exercise today.'});
  if (riskData.riskPercentage>60)    alerts.push({type:'danger', icon:'🏥',msg:'High risk level. Consider a pulmonary function test this month.'});
  alerts.push({type:'safe',icon:'🌿',msg:'Daily tip: Stay hydrated, eat antioxidants, use air purifier indoors.'});

  const cont = document.getElementById('alertsContainer');
  if (cont) cont.innerHTML = alerts.map(a=>`
    <div class="alert-item ${a.type}">
      <span class="alert-icon">${a.icon}</span>
      <span class="alert-msg">${a.msg}</span>
    </div>`).join('');
}

function renderTimeline() {
  const cont = document.getElementById('timelineContainer');
  if (!cont) return;
  const now  = new Date();
  const rows = [];
  for (let i=7;i>=0;i--) {
    const t = new Date(now.getTime()-i*3600000);
    const v = Math.max(10,(currentAQI||100)+Math.floor(Math.random()*30-15));
    rows.push({time:t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), aqi:v, isNow:i===0});
  }
  cont.innerHTML = rows.map(h=>`
    <div class="timeline-row ${h.isNow?'timeline-now':''}">
      <div class="tl-dot" style="background:${getAQIColor(h.aqi)}"></div>
      <div class="tl-time">${h.time}</div>
      <div class="tl-bar-wrap">
        <div class="tl-bar" style="width:${Math.min(h.aqi/3,100)}%;background:${getAQIColor(h.aqi)}"></div>
      </div>
      <div class="tl-aqi" style="color:${getAQIColor(h.aqi)}">${h.aqi}</div>
      <div class="tl-label">${getAQILabel(h.aqi)}</div>
      ${h.isNow?'<span class="now-tag">NOW</span>':''}
    </div>`).join('');
}

async function renderCommunityAnalytics() {
  const grid  = document.getElementById('analyticsGrid');
  if (!grid) return;
  let users = [];
  try { users = await loadCommunityData(); } catch(_) {}

  if (!users.length) {
    grid.innerHTML = '<p class="no-data">You are the first user! Community stats will appear soon.</p>';
    return;
  }

  const avgRisk  = Math.round(users.reduce((s,u)=>s+(u.riskPercentage||0),0)/users.length);
  const highRisk = users.filter(u=>u.riskPercentage>60).length;
  const cities   = [...new Set(users.map(u=>u.city))].length;
  const avgAQI   = Math.round(users.reduce((s,u)=>s+(u.aqi||0),0)/users.length);
  const today    = users.filter(u=>{const ts=u.timestamp?.toDate?.(); return ts&&new Date().toDateString()===ts.toDateString();}).length;

  grid.innerHTML = [
    {num:users.length, label:'Total Users'},
    {num:avgRisk+'%',  label:'Avg Risk Score'},
    {num:highRisk,     label:'High Risk Users'},
    {num:cities,       label:'Cities Tracked'},
    {num:avgAQI,       label:'Avg Community AQI'},
    {num:today,        label:'Scans Today'}
  ].map(s=>`<div class="stat-box"><div class="stat-num">${s.num}</div><div class="stat-lbl">${s.label}</div></div>`).join('');
}

function renderPreventionTips(riskData) {
  const grid = document.getElementById('tipsGrid');
  if (!grid) return;
  const tips = [];
  if (riskData.aqi>100)       tips.push({icon:'😷',title:'Wear N95 Mask',       desc:'PM2.5 at this AQI penetrates deep into lung tissue.'});
  if (userProfile.smoking>0)  tips.push({icon:'🚭',title:'Quit Smoking',         desc:'Smoking in high AQI conditions multiplies carcinogen exposure 3×.'});
  if (userProfile.exercise<2) tips.push({icon:'🏃',title:'Exercise Indoors',     desc:'Regular cardio strengthens respiratory muscles.'});
  tips.push({icon:'🌿',title:'Indoor Plants',        desc:'Spider plant & Peace lily naturally filter indoor air.'});
  tips.push({icon:'💧',title:'Stay Hydrated',        desc:'2–3L water daily helps your lungs flush out pollutants.'});
  tips.push({icon:'🥦',title:'Eat Antioxidants',     desc:'Broccoli, berries and turmeric fight inflammation from pollution.'});
  if (userProfile.workEnv>0.5) tips.push({icon:'🦺',title:'Use Respirator at Work',desc:'Industrial dust causes irreversible lung scarring.'});
  if (userProfile.age>50)      tips.push({icon:'🩺',title:'Annual Lung Screening', desc:'CT scan screening recommended annually for your age group.'});

  grid.innerHTML = tips.map(t=>`
    <div class="tip-card">
      <div class="tip-icon">${t.icon}</div>
      <div class="tip-title">${t.title}</div>
      <div class="tip-desc">${t.desc}</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. REFRESH / RESET
// ══════════════════════════════════════════════════════════════════════════════
async function refreshAQI() {
  showLoading(true);
  try {
    if (userCoords) await fetchAQIByCoords(userCoords.lat, userCoords.lon);
    else            await fetchAQIByCity(userProfile.city);
  } catch(e) { simulateAQIData(); }
  const riskData = runMLModel();
  renderDashboard(riskData);
  renderPreventionTips(riskData);
  showLoading(false);
}

function resetProfile() {
  const on = document.getElementById('onboardingSection');
  const db = document.getElementById('dashboardSection');
  if (on) on.style.display='block';
  if (db) db.style.display='none';
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function getAQILabel(aqi) {
  if (aqi<=50)  return 'Good';
  if (aqi<=100) return 'Moderate';
  if (aqi<=150) return 'Unhealthy (Sensitive)';
  if (aqi<=200) return 'Unhealthy';
  if (aqi<=300) return 'Very Unhealthy';
  return 'Hazardous';
}
function getAQIColor(aqi) {
  if (aqi<=50)  return '#00e676';
  if (aqi<=100) return '#ffee58';
  if (aqi<=150) return '#ff9800';
  if (aqi<=200) return '#f44336';
  if (aqi<=300) return '#ab47bc';
  return '#7b1fa2';
}
function showLoading(show) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}
