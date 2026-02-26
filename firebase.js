// ── firebase.js — OxyTrace Firebase Integration ───────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Your Firebase config ──────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAvDsel_ZqQrqtCuMKBTDqQFVM_zP7VplQ",
  authDomain: "oxytrace-b1010.firebaseapp.com",
  projectId: "oxytrace-b1010",
  storageBucket: "oxytrace-b1010.firebasestorage.app",
  messagingSenderId: "535755454947",
  appId: "1:535755454947:web:024254448bbf50061848d6",
  measurementId: "G-X96ES1ZTQ1"
};


const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── AUTH: Sign Up ─────────────────────────────────────────────────────────────
export async function signUp(email, password, username) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Create user document in Firestore
  await setDoc(doc(db, "users", cred.user.uid), {
    username,
    email,
    createdAt: serverTimestamp(),
    healthProfile: null
  });
  return cred.user;
}

// ── AUTH: Sign In ─────────────────────────────────────────────────────────────
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ── AUTH: Sign Out ────────────────────────────────────────────────────────────
export async function logOut() {
  await signOut(auth);
}

// ── AUTH: Watch login state ───────────────────────────────────────────────────
export function watchAuth(callback) {
  onAuthStateChanged(auth, callback);
}

// ── FIRESTORE: Save health profile ───────────────────────────────────────────
export async function saveHealthProfile(profile) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not logged in");
  await updateDoc(doc(db, "users", user.uid), {
    healthProfile: profile,
    healthProfileUpdatedAt: serverTimestamp()
  });
  // Also keep localStorage in sync for personalization.js
  localStorage.setItem('oxtrace_health_profile', JSON.stringify(profile));
  localStorage.setItem('oxy_onboarded', 'true');
}

// ── FIRESTORE: Get health profile ─────────────────────────────────────────────
export async function getHealthProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) return snap.data().healthProfile;
  return null;
}

// ── FIRESTORE: Save AQI reading (per session) ─────────────────────────────────
export async function saveAQIReading(data) {
  const user = auth.currentUser;
  if (!user) return; // silently skip if not logged in
  const ref = doc(db, "users", user.uid, "aqiReadings", Date.now().toString());
  await setDoc(ref, {
    ...data,
    timestamp: serverTimestamp()
  });
}

export { auth, db };
