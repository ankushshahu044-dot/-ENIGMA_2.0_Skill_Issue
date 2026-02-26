// ============================================================
// 🔥 FIREBASE CONFIG
// ⚠️ Go to console.firebase.google.com
// → Your Project → Project Settings → Your Apps → Web
// → Copy the firebaseConfig object and paste it below
// ============================================================

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCRLzKoRScWEmab59QcYrmNvB6Z28VZpEw",
  authDomain: "oxytrace-29e3a.firebaseapp.com",
  projectId: "oxytrace-29e3a",
  storageBucket: "oxytrace-29e3a.firebasestorage.app",
  messagingSenderId: "603192857855",
  appId: "1:603192857855:web:4a9e993ae7183b591168ca",
  measurementId: "G-GYQH5PSRRF"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ============================================================
// SAVE user session to Firestore
// ============================================================
async function saveUserSession(userData) {
  try {
    await db.collection('oxytrace_users').add({
      ...userData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ OxyTrace: Data saved to Firebase');
  } catch (e) {
    console.warn('Firebase save skipped:', e.message);
  }
}

// ============================================================
// LOAD community data from Firestore
// ============================================================
async function loadCommunityData() {
  try {
    const snapshot = await db.collection('oxytrace_users')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    return snapshot.docs.map(d => d.data());
  } catch (e) {
    console.warn('Firebase load skipped:', e.message);
    return [];
  }
}