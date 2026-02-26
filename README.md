# OxyTrace — Integrated Final Product

## File Structure

```
oxytrace/
├── index.html          ← Onboarding (form + ML dashboard). Entry for new users.
├── profile.html        ← Live AQI neon dashboard. Main screen after onboarding.
├── health.html         ← Lung health deep-dive: charts, heatmap, spikes, risks.
├── map.html            ← Leaflet live air quality map.
├── signup.html         ← Login / register page.
├── details.html        ← User details step 1 (name, age, gender).
├── health-survey.html  ← Medical profile step 2 (conditions).
├── app.js              ← 🔑 ML model + location gate + WAQI + event bus.
├── api.js              ← Data layer for health.html (WAQI + Open-Meteo + cache).
├── firebase.js         ← Firebase config, auth helpers, Firestore save/load.
├── logic.js            ← Adaptive health engine (disease-specific advice).
├── personalisation.js  ← UI mutation based on user conditions.
├── chatbot.js          ← OxyBot Gemini AI assistant.
├── style.css           ← Base layout styles (from original index.html).
└── ui.css              ← Visual overrides / theme layer.
```

## User Flow

```
signup.html  →  details.html  →  health-survey.html
                                         ↓
                                    index.html  (onboarding + ML scan)
                                         ↓
                                   profile.html  (live AQI dashboard)
                                         ↓
                              health.html / map.html
```

## Location Gating

Every page that loads `app.js` automatically:
1. Shows a **full-screen blocking modal** on load
2. Requests GPS permission immediately
3. Auto-retries every **4 seconds** if denied
4. Shows step-by-step instructions for Chrome / Firefox / Safari
5. Vanishes instantly when permission is granted

## Architecture

- `app.js` owns: location gate, WAQI AQI fetch, ML risk model, onboarding form logic
- `api.js` owns: health.html data pipeline (WAQI + Open-Meteo fallback)
- Both fire `CustomEvent 'oxytrace:data'` — all HTML files only listen, never fetch
- `profile.html` listens to `oxytrace:data` from `app.js`
- `health.html` listens to `oxytrace:data` from `api.js`

## API Keys

| Service  | Key Location       | Notes                    |
|----------|--------------------|--------------------------|
| WAQI     | `app.js` line 11   | Replace with your token  |
| Gemini   | `chatbot.js`       | Replace with your key    |
| Firebase | `firebase.js`      | Already configured       |
