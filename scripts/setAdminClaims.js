#!/usr/bin/env node
const admin = require('firebase-admin');

// Usage: GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json PROJECT_ID=... node setAdminClaims.js uid1 uid2 ...
const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error('PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set');
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS must point to a service account key');
  process.exit(1);
}

if (process.argv.length < 3) {
  console.error('Provide at least one UID to grant admin claim');
  process.exit(1);
}

admin.initializeApp({ projectId });

async function main() {
  const uids = process.argv.slice(2);
  for (const uid of uids) {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    await admin.firestore().collection('users').doc(uid).set({ role: 'admin' }, { merge: true });
    console.log(`Granted admin claim and mirrored role for ${uid}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
