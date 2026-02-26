// ============================================================
// 🔥 FIREBASE CONFIG — OxyTrace
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyCRLzKoRScWEmab59QcYrmNvB6Z28VZpEw",
  authDomain:        "oxytrace-29e3a.firebaseapp.com",
  projectId:         "oxytrace-29e3a",
  storageBucket:     "oxytrace-29e3a.firebasestorage.app",
  messagingSenderId: "603192857855",
  appId:             "1:603192857855:web:4a9e993ae7183b591168ca",
  measurementId:     "G-GYQH5PSRRF"
};

// Guard against double-initialisation (multiple pages load this file)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db   = firebase.firestore();
const auth = firebase.auth();

// ============================================================
// AUTH HELPERS
// ============================================================
async function signIn(email, password) {
  return firebase.auth().signInWithEmailAndPassword(email, password);
}

async function signUp(email, password, username) {
  const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName: username });
  // Create user doc
  await db.collection('users').doc(cred.user.uid).set({
    name: username, email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return cred;
}

// ============================================================
// SAVE user session to Firestore (risk scan results)
// ============================================================
async function saveUserSession(userData) {
  try {
    await db.collection('oxytrace_users').add({
      ...userData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ OxyTrace: session saved to Firebase');
  } catch (e) {
    console.warn('Firebase save skipped:', e.message);
  }
}

// ============================================================
// SAVE health profile (from health-survey.html)
// ============================================================
async function saveHealthProfile(profile) {
  try {
    const user = auth.currentUser;
    if (user) {
      await db.collection('users').doc(user.uid).set(
        { healthProfile: profile, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      console.log('✅ Health profile saved to Firebase');
    }
  } catch (e) {
    console.warn('Firebase health profile save skipped:', e.message);
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
