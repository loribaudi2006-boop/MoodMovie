/* ============================================================
   MoodMovie — cloud.js
   Google Sign-In only — there's no separate MoodMovie cloud database
   here. Instead, signing in derives a stable "codice di sincronizzazione"
   from the Google account's uid and feeds it straight into the existing
   Supabase-based pairing-code sync already built into index.html
   (startSync/pushSync/pollSync etc.) — same account on two devices means
   the same derived code, so they end up in the same sync group without
   ever having to copy-paste a code by hand.

   Reuses the same Firebase project as Wavelane (wavelane-36860) purely
   for Google identity — no data from either app is stored there or
   shared between them.

   Sign-in usa signInWithPopup: funziona su tutti i browser desktop
   e mobile moderni senza bisogno di proxy /__/auth/*.
   authDomain punta al dominio Firebase nativo del progetto.

   This is a native ES module (needed for the modular Firebase SDK via
   CDN, no bundler in this project), while index.html's main <script>
   is a plain classic script. They talk to each other through:
     - window.MoodCloud.{signIn,signOutUser,switchAccount,...}  (module -> index.html calls these)
     - CustomEvents on window: "moodcloud-authchanged"           (module -> index.html listens)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signOut, onAuthStateChanged, deleteUser, reauthenticateWithPopup
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBDC1t74lUb1gEVJgLJQFFofq9drM9sumY",
  // Dominio Firebase nativo del progetto — funziona subito con signInWithPopup
  // senza necessità di proxy. Il sito (moodmovie.pages.dev) deve essere
  // nei "Domini autorizzati" in Firebase Console > Authentication > Settings.
  authDomain: "wavelane-36860.firebaseapp.com",
  projectId: "wavelane-36860",
  storageBucket: "wavelane-36860.firebasestorage.app",
  messagingSenderId: "512056899201",
  appId: "1:512056899201:web:3172de2ac6f1d0943b3f80",
  measurementId: "G-5ML2LZBJG7"
};

const fbApp = initializeApp(firebaseConfig, "moodmovie");
const auth = getAuth(fbApp);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// Continuation of deleteAccount()'s reauth-then-delete path.
if (sessionStorage.getItem("moodcloud_pending_delete") === "1") {
  sessionStorage.removeItem("moodcloud_pending_delete");
  let deleteRetryUnsub = null;
  deleteRetryUnsub = onAuthStateChanged(auth, (user) => {
    if (!user) return;
    if (deleteRetryUnsub) deleteRetryUnsub();
    deleteUser(user)
      .then(() => dispatch("moodcloud-account-deleted", {}))
      .catch((e) => dispatch("moodcloud-delete-failed", { error: e }));
  });
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  dispatch("moodcloud-authchanged", {
    user: user ? { uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL } : null
  });
});

window.MoodCloud = {
  async signIn() {
    try {
      const result = await signInWithPopup(auth, provider);
      // result.user è disponibile subito — onAuthStateChanged aggiornerà la UI
      return { ok: true };
    } catch (e) {
      console.warn("MoodMovie cloud: sign-in failed", e);
      dispatch("moodcloud-signin-error", { code: e?.code || "unknown", message: e?.message || String(e) });
      return { ok: false, code: e?.code || "unknown", message: e?.message || String(e) };
    }
  },
  async signOutUser() {
    try { await signOut(auth); } catch (e) { /* ignore */ }
  },
  async switchAccount() {
    try { await signOut(auth); } catch (e) { /* ignore */ }
    provider.setCustomParameters({ prompt: "select_account" });
    return window.MoodCloud.signIn();
  },
  // Deletes only the Firebase Auth account (Google identity). The
  // Supabase sync group this device is in is left completely alone —
  // deleting the cloud identity should never silently disconnect other
  // devices still relying on that sync code.
  async deleteAccount() {
    if (!currentUser) return { ok: false };
    const user = currentUser;
    try {
      await deleteUser(user);
      return { ok: true };
    } catch (e) {
      if (e.code === "auth/requires-recent-login") {
        try {
          await reauthenticateWithPopup(user, provider);
          await deleteUser(user);
          return { ok: true };
        } catch (e2) {
          return { ok: false, needsReauth: true, error: e2 };
        }
      }
      return { ok: false, error: e };
    }
  },
  isSignedIn() { return !!currentUser; },
  getUser() {
    return currentUser
      ? { uid: currentUser.uid, name: currentUser.displayName, email: currentUser.email, photo: currentUser.photoURL }
      : null;
  }
};
