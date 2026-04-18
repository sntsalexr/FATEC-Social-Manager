/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
// Firebase configuration from environment variables (Vite-style)
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID
};

const app = initializeApp(config);

// Use initializeFirestore with forced long-polling to fix "client is offline" issues across all environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, config.firestoreDatabaseId || '(default)');

export const auth = getAuth(app);

// CRITICAL: Validate connection to Firestore
async function testConnection() {
  try {
    // Attempt a light read to confirm connectivity and keys
    await getDocFromServer(doc(db, 'productionSteps', '1'));
    console.log("Firebase: Firestore connection confirmed.");
  } catch (error: any) {
    const errorMsg = error?.message || "";
    if (errorMsg.includes('the client is offline')) {
      console.error("Firebase Connection Error: The browser cannot reach the Firestore servers. \nPotential fixes:\n1. Ensure your firewall/VPN isn't blocking Firebase.\n2. In Firebase Console, go to Authentication > Settings > Authorized Domains and add: " + window.location.hostname);
    } else if (errorMsg.includes('permission-denied')) {
      // This is actually GOOD news - it means we connected and the rules blocked us (as expected for a 'test' read)
      console.log("Firebase: Firestore reached (Access denied as expected).");
    } else {
      console.warn("Firebase: Connection test status:", errorMsg);
    }
  }
}
testConnection();
