/**
 * logic.js — Adaptive Health Engine (AI Personalization)
 * ─────────────────────────────────────────────────────────────────────────────
 * NOW INCLUDES:
 * 1. Disease-Specific Advice Logic (Asthma vs COPD vs Healthy)
 * 2. Personalized Risk Scoring
 * 3. Custom Alert Generation
 */

// ─── 1. ADVICE DATABASE (The Knowledge Base) ─────────────────────────────────
const ADVICE_DB = {
  ASTHMA: {
    Critical: "🚨 ASTHMA EMERGENCY: Air is hazardous. Seal windows. Keep rescue inhaler ready immediately.",
    High:     "⚠️ ASTHMA WARNING: High triggers detected. Carry your inhaler. Avoid cold air.",
    Moderate: "ℹ️ Monitor breathing. Keep inhaler nearby if going outside.",
    Low:      "✅ Air is safe. Good conditions for outdoor exercise."
  },
  COPD: {
    Critical: "🚨 COPD DANGER: High pollution. Oxygen levels may drop. Stay indoors with purified air.",
    High:     "⚠️ LUNG STRESS WARNING: Avoid all exertion. Use maintenance inhalers as prescribed.",
    Moderate: "ℹ️ Watch for wheezing. Limit outdoor walks to 10 minutes.",
    Low:      "✅ Safe for light activity. Maintain normal therapy routine."
  },
  ELDERLY: {
    Critical: "🚨 SENIOR ALERT: Hazardous air. Heart/Lung stress high. Stay inside.",
    High:     "⚠️ Limit exposure. High PM2.5 can strain the cardiovascular system.",
    Moderate: "ℹ️ Take breaks if walking outside. Wear a mask if dusty.",
    Low:      "✅ Good air quality. Enjoy your walk."
  },
  DEFAULT: { // For Healthy / Athletes
    Critical: "🚨 HAZARDOUS: Do not exercise outside. Indoor cardio only.",
    High:     "⚠️ UNHEALTHY: Skip the run. Opt for the gym today.",
    Moderate: "ℹ️ Acceptable, but sensitive people should take it easy.",
    Low:      "✅ PERFECT conditions for a run or outdoor workout."
  }
};

// ─── 2. PERSONA CLASSIFIER ───────────────────────────────────────────────────
function detectPersona(conditions = [], age = 0) {
  const c = conditions.map(x => x.toLowerCase());
  if (c.includes('copd') || c.includes('emphysema')) return 'COPD';
  if (c.includes('asthma') || c.includes('bronchitis')) return 'ASTHMA';
  if (age >= 65) return 'ELDERLY';
  return 'DEFAULT';
}

// ─── 3. RISK CALCULATOR ──────────────────────────────────────────────────────
const calculateHealthRisk = (aqi, userConditions = [], age = 0) => {
  if (typeof aqi !== 'number' || isNaN(aqi)) return { riskLevel: 'Unknown', riskScore: 0 };

  let score = aqi;
  const persona = detectPersona(userConditions, age);

  // Apply "Vulnerability Multipliers"
  if (persona === 'COPD') score *= 1.6;      // COPD is most sensitive
  else if (persona === 'ASTHMA') score *= 1.4; // Asthma is reactive
  else if (persona === 'ELDERLY') score *= 1.2; // Age factor

  // Cap score at 500
  score = Math.min(Math.round(score), 500);

  // Determine Tier
  let level = 'Low';
  if (score >= 300) level = 'Critical';
  else if (score >= 150) level = 'High';
  else if (score >= 51)  level = 'Moderate';

  // Get Custom Message
  const message = ADVICE_DB[persona][level];

  return { riskLevel: level, riskScore: score, message, persona };
};

// ─── 4. BROWSER NOTIFICATION SYSTEM ──────────────────────────────────────────
const checkAlertStatus = (aqi, riskLevel, message) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (aqi <= 100) return; // Only alert if bad

  const title = `OxyTrace: ${riskLevel} Alert`;
  
  if (Notification.permission === 'granted') {
    new Notification(title, { body: message, icon: 'https://cdn-icons-png.flaticon.com/512/2964/2964063.png' });
  }
};

// ─── 5. DATA MANAGER ─────────────────────────────────────────────────────────
const getUserProfile = () => {
  try {
    const raw = localStorage.getItem('oxtrace_health_profile');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { age: 0, conditions: [], name: 'User' };
};

// ─── 6. MAIN INTEGRATION ─────────────────────────────────────────────────────
const onAQIReady = (aqi) => {
  const profile = getUserProfile();
  const { riskLevel, riskScore, message, persona } = calculateHealthRisk(aqi, profile.conditions, profile.age);

  // Send Browser Notification
  checkAlertStatus(aqi, riskLevel, message);

  // Update UI (Alerts Tab)
  if (typeof document !== 'undefined') {
    // Inject the alert into the feed
    const feed = document.getElementById('alert-feed');
    if (feed) {
      const card = document.createElement('div');
      card.className = "stat-card rounded-xl px-4 py-3 flex items-center gap-3 border-l-4";
      // Color code the border based on risk
      const color = riskLevel === 'Critical' ? '#ff0000' : riskLevel === 'High' ? '#ff9500' : '#00ff88';
      card.style.borderLeftColor = color;
      
      card.innerHTML = `
        <div class="flex-1">
          <div class="flex justify-between items-center mb-1">
            <span class="font-orbitron text-xs text-white">${riskLevel.toUpperCase()} RISK</span>
            <span class="text-[10px] opacity-50">Just now</span>
          </div>
          <p class="text-xs text-cyan-100 font-medium">${message}</p>
          <p class="text-[10px] opacity-40 mt-1 uppercase tracking-widest">${persona} PROTOCOL ACTIVE</p>
        </div>
      `;
      feed.insertBefore(card, feed.firstChild);
    }
  }
};

// Export
window.OxyTrace = { calculateHealthRisk, getUserProfile, onAQIReady };
