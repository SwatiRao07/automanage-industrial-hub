// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

// ✅ Your Firebase Config (use the one you posted)
const firebaseConfig = {
  apiKey: "AIzaSyCrqIzOQG2I87LCTcBBAAAXEjJBTD2NV2Q",
  authDomain: "bom-page.firebaseapp.com",
  projectId: "bom-page",
  storageBucket: "bom-page.firebasestorage.app",
  messagingSenderId: "443487359138",
  appId: "1:443487359138:web:0cce9814a9b59ba5aec7fb",
  measurementId: "G-HRWHM191JV"
};

// ✅ Initialize Firebase services
const app = initializeApp(firebaseConfig);

// ✅ Firestore and Auth setup
export const db = getFirestore(app);
export const auth = getAuth(app);

// ✅ Sign in user anonymously on load
signInAnonymously(auth).catch((error) => {
  console.error("Firebase Auth failed:", error);
});
