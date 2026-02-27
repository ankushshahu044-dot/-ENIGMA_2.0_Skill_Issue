/**
 * logic.js — Adaptive Health Engine + Real Push Notifications + Firebase Alerts
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Disease-Specific Advice Logic (Asthma vs COPD vs Healthy)
 * 2. Personalized Risk Scoring
 * 3. Real Push Notifications (works when app is closed)
 * 4. Saves every alert to Firebase Firestore
 */

// ─── 1. ADVICE DATABASE ───────────────────────────────────────────────────────
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
  DEFAULT: {
    Critical: "🚨 HAZARDOUS: Do not exercise outside. Indoor cardio only.",
    High:     "⚠️ UNHEALTHY: Skip the run. Opt for the gym today.",
    Moderate: "ℹ️ Acceptable, but sensitive people should take it easy.",
    Low:      "✅ PERFECT conditions for a run or outdoor workout."
  }
};

// ─── 2. PERSONA CLASSIFIER ────────────────────────────────────────────────────
function detectPersona(conditions = [], age = 0) {
  const c = conditions.map(x => x.toLowerCase());
  if (c.includes('copd') || c.includes('emphysema')) return 'COPD';
  if (c.includes('asthma') || c.includes('bronchitis')) return 'ASTHMA';
  if (age >= 65) return 'ELDERLY';
  return 'DEFAULT';
}

// ─── 3. RISK CALCULATOR ───────────────────────────────────────────────────────
const calculateHealthRisk = (aqi, userConditions = [], age = 0) => {
  if (typeof aqi !== 'number' || isNaN(aqi)) return { riskLevel: 'Unknown', riskScore: 0 };
  let score = aqi;
  const persona = detectPersona(userConditions, age);
  if (persona === 'COPD')         score *= 1.6;
  else if (persona === 'ASTHMA')  score *= 1.4;
  else if (persona === 'ELDERLY') score *= 1.2;
  score = Math.min(Math.round(score), 500);
  let level = 'Low';
  if (score >= 300)      level = 'Critical';
  else if (score >= 150) level = 'High';
  else if (score >= 51)  level = 'Moderate';
  const message = ADVICE_DB[persona][level];
  return { riskLevel: level, riskScore: score, message, persona };
};

// ─── 4. PUSH NOTIFICATION SETUP ──────────────────────────────────────────────
// !! PASTE YOUR VAPID KEY BELOW (Firebase Console → Project Settings → Cloud Messaging → Web Push certificates)
const VAPID_KEY = 'BNAg1sozMvGLcp6vaVWgWsKU-6NZKcvDRZPYB8sVlYbUEhtlAVguPDjy6_cu1sOCOPvNQHn4wk14EMSLU9Mm7mM';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAvDsel_ZqQrqtCuMKBTDqQFVM_zP7VplQ",
  authDomain: "oxytrace-b1010.firebaseapp.com",
  projectId: "oxytrace-b1010",
  storageBucket: "oxytrace-b1010.firebasestorage.app",
  messagingSenderId: "535755454947",
  appId: "1:535755454947:web:024254448bbf50061848d6"
};

let _notifLastSent = 0;
const NOTIF_COOLDOWN_MS = 10 * 60 * 1000; // max 1 notification per 10 minutes

async function setupPushNotifications() {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    // Register service worker
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('✅ OxyTrace SW registered');

    // Ask user for permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('🔕 Notifications denied by user');
      return;
    }

    // Init Firebase Messaging
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getMessaging, getToken }  = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');

    const app       = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    const messaging = getMessaging(app);

    // Get FCM token and store it
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });

    if (token) {
      localStorage.setItem('oxy_fcm_token', token);
      console.log('✅ FCM ready — notifications enabled');
    }

  } catch (err) {
    console.warn('Push setup error:', err.message);
  }
}

// ─── 5. SEND NOTIFICATION ────────────────────────────────────────────────────
function sendNotification(title, body) {
  const now = Date.now();
  if (now - _notifLastSent < NOTIF_COOLDOWN_MS) return; // cooldown
  _notifLastSent = now;

  if (Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon:     'https://cdn-icons-png.flaticon.com/512/2964/2964063.png',
      badge:    'https://cdn-icons-png.flaticon.com/512/2964/2964063.png',
      vibrate:  [200, 100, 200],
      tag:      'oxytrace-alert', // replaces previous instead of stacking
      renotify: true
    });
  }
}

// ─── 6. SAVE ALERT TO FIREBASE ───────────────────────────────────────────────
async function saveAlertToFirebase(aqi, riskLevel, message) {
  try {
    const { initializeApp, getApps }                      = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getFirestore, collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { getAuth }                                     = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

    const app  = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    const db   = getFirestore(app);
    const auth = getAuth(app);
    const user = auth.currentUser;

    const alertData = {
      aqi,
      riskLevel,
      message,
      location:  localStorage.getItem('oxtrace_last_loc') || 'Unknown',
      timestamp: serverTimestamp()
    };

    if (user) {
      // Logged in → save under user's own alerts
      await addDoc(collection(db, 'users', user.uid, 'alerts'), alertData);
    } else {
      // Not logged in → save to global alerts collection
      await addDoc(collection(db, 'alerts'), alertData);
    }

    console.log('✅ Alert saved to Firebase');
  } catch (err) {
    console.warn('Firebase alert save failed:', err.message);
  }
}

// ─── 7. ALERT CHECKER (called on every AQI update) ───────────────────────────
const checkAlertStatus = async (aqi, riskLevel, message) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (aqi <= 100) return; // only alert on bad air

  // Send push notification
  sendNotification(`OxyTrace: ${riskLevel} Air Quality Alert`, message);

  // Save to Firebase
  await saveAlertToFirebase(aqi, riskLevel, message);
};

// ─── 8. PROFILE READER ───────────────────────────────────────────────────────
const getUserProfile = () => {
  try {
    const raw = localStorage.getItem('oxtrace_health_profile');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { age: 0, conditions: [], name: 'User' };
};

// ─── 9. MAIN INTEGRATION ─────────────────────────────────────────────────────
const onAQIReady = (aqi) => {
  const profile = getUserProfile();
  const { riskLevel, riskScore, message, persona } = calculateHealthRisk(aqi, profile.conditions, profile.age);

  // Send notification + save to Firebase
  checkAlertStatus(aqi, riskLevel, message);

  // Update UI alert feed
  if (typeof document !== 'undefined') {
    const feed = document.getElementById('alert-feed');
    if (feed) {
      const card = document.createElement('div');
      card.className = "stat-card rounded-xl px-4 py-3 flex items-center gap-3 border-l-4";
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

// ─── BOOT: Ask for notification permission on page load ───────────────────────
window.addEventListener('DOMContentLoaded', () => setupPushNotifications());

// Export
window.OxyTrace = { calculateHealthRisk, getUserProfile, onAQIReady };
