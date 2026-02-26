/**
 * logic.js — OxyTrace Core Lung Health Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Works in three environments:
 *   1. Browser via <script src="logic.js"> → exposes window.OxyTrace
 *   2. ES Module  → named exports (import { calculateHealthRisk } from './logic.js')
 *   3. Node.js    → CommonJS (const { calculateHealthRisk } = require('./logic.js'))
 *
 * Integration points with index.html:
 *   • Called after AQI is fetched (onPositionReceived) via window.OxyTrace.onAQIReady(aqi)
 *   • Called after postMessage from map.html via window.OxyTrace.onAQIReady(aqi) too
 *   • Reads user health profile from localStorage key: 'oxtrace_health_profile'
 *   • Writes live alerts into #alert-feed in the DOM
 *   • Triggers browser Notification API when AQI > 150
 */

// ─── 1. HEALTH RISK CALCULATOR ───────────────────────────────────────────────
/**
 * Calculates a personalised health risk score from AQI + user profile.
 *
 * @param {number}   aqi            – Raw Air Quality Index (0–500)
 * @param {string[]} userConditions – e.g. ['asthma', 'copd', 'heart_disease']
 * @param {number}   age            – User's age in years
 * @returns {{ riskLevel: string, riskScore: number, message: string }}
 */
const calculateHealthRisk = (aqi, userConditions = [], age = 0) => {
  if (typeof aqi !== 'number' || isNaN(aqi)) {
    return { riskLevel: 'Unknown', riskScore: 0, message: 'AQI data unavailable.' };
  }

  let riskScore = aqi;

  // Respiratory condition multiplier — asthma / COPD make AQI effects ~50% worse
  const RESPIRATORY = ['asthma', 'copd'];
  const hasRespiratory = userConditions.some(c => RESPIRATORY.includes(c.toLowerCase()));
  if (hasRespiratory) riskScore *= 1.5;

  // Heart disease adds moderate vulnerability
  const hasHeartDisease = userConditions.some(c => c.toLowerCase() === 'heart_disease');
  if (hasHeartDisease) riskScore += 30;

  // Age penalty — seniors (60+) and young children (<6) are more vulnerable
  if (age > 60)     riskScore += 20;
  else if (age < 6) riskScore += 15;

  // Pregnancy flag
  const isPregnant = userConditions.some(c => c.toLowerCase() === 'pregnant');
  if (isPregnant) riskScore += 25;

  // Determine tier
  let riskLevel, message;
  if (riskScore >= 300) {
    riskLevel = 'Critical';
    message   = 'Hazardous conditions. Emergency health warnings for everyone.';
  } else if (riskScore >= 150) {
    riskLevel = 'High';
    message   = 'Unhealthy air quality. Everyone may begin to experience health effects.';
  } else if (riskScore >= 51) {
    riskLevel = 'Moderate';
    message   = 'Acceptable air quality, but may be a risk for some people.';
  } else {
    riskLevel = 'Low';
    message   = 'Air quality is considered satisfactory.';
  }

  return { riskLevel, riskScore: Math.round(riskScore), message };
};

// ─── 2. SAFETY RECOMMENDATION ────────────────────────────────────────────────
/**
 * Returns actionable, punchy advice for the given risk level.
 *
 * @param {string} riskLevel – 'Low' | 'Moderate' | 'High' | 'Critical'
 * @returns {string}
 */
const getSafetyRecommendation = (riskLevel) => {
  const advice = {
    Critical : '🚨 STAY INDOORS. Use air purifiers. Total outdoor activity avoidance required.',
    High     : '😷 Wear an N95 mask immediately. Avoid all outdoor exercise.',
    Moderate : '⚠️ Sensitive groups should limit outdoor time and monitor symptoms.',
    Low      : '✅ Air is clean. Safe to enjoy outdoor activities.',
    Unknown  : '📡 Monitor local air quality reports for updates.',
  };
  return advice[riskLevel] ?? advice.Unknown;
};

// ─── 3. BROWSER NOTIFICATION ─────────────────────────────────────────────────
/**
 * Fires a browser push notification when AQI exceeds 150.
 * Safe to call in Node (no-op) — checks for window first.
 *
 * @param {number} aqi     – Current AQI
 * @param {string} riskLevel – Risk level label for richer notification body
 */
const checkAlertStatus = (aqi, riskLevel = '') => {
  // Guard: not in a browser context
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (aqi <= 150) return; // Only alert for High / Critical

  const title = riskLevel === 'Critical'
    ? '☠️ HAZARDOUS AIR — Stay Indoors'
    : '⚠️ DANGER: High Pollution Alert';

  const body = `AQI is ${aqi} (${riskLevel || 'Unhealthy'}) in your area. Take precautions immediately.`;

  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: './favicon.ico' });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, { body, icon: './favicon.ico' });
      }
    });
  }
};

// ─── 4. USER HEALTH PROFILE (localStorage) ───────────────────────────────────
/**
 * Loads the user's saved health profile from localStorage.
 * Returns safe defaults if nothing is saved yet.
 *
 * @returns {{ age: number, conditions: string[], name: string }}
 */
const getUserProfile = () => {
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem('oxtrace_health_profile');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { age: 0, conditions: [], name: 'User' };
};

/**
 * Saves a health profile to localStorage.
 *
 * @param {{ age: number, conditions: string[], name: string }} profile
 */
const saveUserProfile = (profile) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('oxtrace_health_profile', JSON.stringify(profile));
    }
  } catch (_) {}
};

// ─── 5. DOM INTEGRATION ──────────────────────────────────────────────────────
/**
 * Master entry point called by index.html after AQI is fetched.
 * Pulls the user profile from localStorage, runs risk calculation,
 * updates the health risk card in the DOM, fires notifications,
 * and injects a live alert into the alert feed.
 *
 * @param {number} aqi – Live AQI value from Open-Meteo
 */
const onAQIReady = (aqi) => {
  if (typeof aqi !== 'number' || isNaN(aqi)) return;

  const profile        = getUserProfile();
  const { riskLevel, riskScore, message } = calculateHealthRisk(aqi, profile.conditions, profile.age);
  const recommendation = getSafetyRecommendation(riskLevel);

  // Fire browser notification for High / Critical
  checkAlertStatus(aqi, riskLevel);

  // Update the health risk card in the DOM (if it exists)
  _updateHealthCard(riskLevel, riskScore, message, recommendation);

  // Push a new alert into the live alert feed
  _addAlertToFeed(aqi, riskLevel, recommendation);

  // Update the alert badge count in bottom nav
  _updateAlertBadge();
};

// ─── 6. PRIVATE DOM HELPERS ───────────────────────────────────────────────────

// Map risk level → neon color (aligns with index.html's AQI_TIERS palette)
const RISK_COLORS = {
  Low      : '#00ff88',
  Moderate : '#ffd700',
  High     : '#ff9500',
  Critical : '#ff0000',
  Unknown  : '#4a6680',
};

/**
 * Updates (or creates) the #health-risk-card section below the stats row.
 * If the card element doesn't exist yet, it is dynamically injected before #alert-feed.
 */
const _updateHealthCard = (riskLevel, riskScore, message, recommendation) => {
  if (typeof document === 'undefined') return;

  const color = RISK_COLORS[riskLevel] ?? RISK_COLORS.Unknown;

  let card = document.getElementById('health-risk-card');

  if (!card) {
    // Create the card and insert it before the alerts section
    card = document.createElement('section');
    card.id = 'health-risk-card';
    card.style.cssText = 'margin-bottom: 0;';

    const alertSection = document.getElementById('alert-feed-section');
    if (alertSection) {
      alertSection.parentNode.insertBefore(card, alertSection);
    } else {
      // Fallback: append to main
      const main = document.querySelector('main');
      if (main) main.appendChild(card);
    }
  }

  card.innerHTML = `
    <div style="
      background: rgba(13,21,32,0.95);
      border: 1px solid ${color}33;
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 0 0 1px ${color}18, inset 0 0 20px ${color}06;
    ">
      <!-- Header row -->
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <span style="font-family:'Orbitron',sans-serif; font-size:10px; letter-spacing:0.15em; opacity:0.5; text-transform:uppercase;">
          Personal Health Risk
        </span>
        <span style="
          font-family:'Orbitron',sans-serif; font-size:10px; letter-spacing:0.1em;
          padding: 3px 10px; border-radius: 999px;
          border: 1px solid ${color}55;
          color: ${color};
          background: ${color}12;
          text-shadow: 0 0 8px ${color};
        ">${riskLevel.toUpperCase()}</span>
      </div>

      <!-- Risk score bar -->
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <div style="flex:1; height:6px; border-radius:999px; background:rgba(255,255,255,0.06); overflow:hidden;">
          <div style="
            width: ${Math.min(riskScore / 500 * 100, 100)}%;
            height:100%;
            border-radius:999px;
            background: ${color};
            box-shadow: 0 0 8px ${color};
            transition: width 1.2s cubic-bezier(0.4,0,0.2,1);
          "></div>
        </div>
        <span style="font-family:'Orbitron',sans-serif; font-size:12px; font-weight:700; color:${color}; min-width:36px; text-align:right;">
          ${riskScore}
        </span>
      </div>

      <!-- Message -->
      <p style="font-size:12px; opacity:0.65; margin-bottom:8px; line-height:1.5;">${message}</p>

      <!-- Recommendation chip -->
      <div style="
        background: ${color}0d;
        border: 1px solid ${color}2a;
        border-radius: 10px;
        padding: 8px 12px;
        font-size:11px;
        line-height:1.5;
        color: ${color};
      ">${recommendation}</div>
    </div>
  `;
};

/**
 * Injects a new alert row at the top of the #alert-feed div.
 * Keeps a max of 5 alerts to avoid infinite growth.
 *
 * @param {number} aqi
 * @param {string} riskLevel
 * @param {string} recommendation
 */
const _addAlertToFeed = (aqi, riskLevel, recommendation) => {
  if (typeof document === 'undefined') return;

  const feed = document.getElementById('alert-feed');
  if (!feed) return;

  const color     = RISK_COLORS[riskLevel] ?? RISK_COLORS.Unknown;
  const isHigh    = ['High', 'Critical'].includes(riskLevel);
  const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const icon      = isHigh ? '⚠️' : '✓';

  const item = document.createElement('div');
  item.className = 'stat-card';
  item.style.cssText = `
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-color: ${color}44;
    margin-bottom: 8px;
    animation: count-up 0.4s ease both;
  `;
  item.innerHTML = `
    <div style="
      width:32px; height:32px; border-radius:50%; flex-shrink:0;
      display:flex; align-items:center; justify-content:center;
      background: ${color}18; font-size:14px;
    ">${icon}</div>
    <div style="flex:1; min-width:0;">
      <p style="font-size:13px; font-weight:600; color:${color}; margin-bottom:2px;">
        AQI ${aqi} — ${riskLevel} Risk
      </p>
      <p style="font-size:11px; opacity:0.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${recommendation.replace(/^[^\s]+\s/, '')} · ${timeLabel}
      </p>
    </div>
  `;

  // Prepend so newest is on top
  feed.insertBefore(item, feed.firstChild);

  // Cap at 5 items
  while (feed.children.length > 5) feed.removeChild(feed.lastChild);
};

/**
 * Updates the alert badge count in the bottom nav.
 */
const _updateAlertBadge = () => {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  const current = parseInt(badge.textContent, 10) || 0;
  badge.textContent = current + 1;
  badge.style.display = 'flex';
};

// ─── 7. EXPORTS ──────────────────────────────────────────────────────────────

// Browser global
if (typeof window !== 'undefined') {
  window.OxyTrace = {
    calculateHealthRisk,
    getSafetyRecommendation,
    checkAlertStatus,
    getUserProfile,
    saveUserProfile,
    onAQIReady,
  };
}

// Node.js / CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateHealthRisk,
    getSafetyRecommendation,
    checkAlertStatus,
    getUserProfile,
    saveUserProfile,
    onAQIReady,
  };
}
