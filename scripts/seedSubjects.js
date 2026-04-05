/**
 * Seed the 'subjects' Firestore collection with the default therapy types.
 *
 * Run from the project root:
 *   node scripts/seedSubjects.js
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or a service-account-key.json
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

// Try to find service account key
const keyPath = path.join(__dirname, '..', 'worker', 'service-account-key.json');
if (fs.existsSync(keyPath)) {
  initializeApp({ credential: cert(require(keyPath)) });
} else {
  initializeApp(); // Use GOOGLE_APPLICATION_CREDENTIALS
}

const db = getFirestore();

const subjects = [
  {
    id: 'cbt',
    label: 'CBT',
    fullName: 'Cognitive Behavioral Therapy',
    icon: 'bulb-outline',
    color: '#2DD4BF',
    description: 'Learn to identify and change negative thought patterns that affect your emotions and behaviors.',
  },
  {
    id: 'act',
    label: 'ACT',
    fullName: 'Acceptance & Commitment',
    icon: 'hand-left-outline',
    color: '#818CF8',
    description: 'Develop psychological flexibility through acceptance and mindfulness-based strategies.',
  },
  {
    id: 'dbt',
    label: 'DBT',
    fullName: 'Dialectical Behavior Therapy',
    icon: 'git-merge-outline',
    color: '#F472B6',
    description: 'Build skills in mindfulness, distress tolerance, emotion regulation, and interpersonal effectiveness.',
  },
  {
    id: 'mbct',
    label: 'MBCT',
    fullName: 'Mindfulness-Based CBT',
    icon: 'infinite-outline',
    color: '#34D399',
    description: 'Combine mindfulness practices with cognitive therapy to prevent depressive relapse.',
  },
  {
    id: 'ifs',
    label: 'IFS',
    fullName: 'Internal Family Systems',
    icon: 'people-outline',
    color: '#FB923C',
    description: 'Explore and heal different parts of yourself to achieve internal harmony and self-leadership.',
  },
  {
    id: 'somatic',
    label: 'Somatic',
    fullName: 'Body-Based Therapy',
    icon: 'body-outline',
    color: '#A78BFA',
    description: 'Connect with your body to release stored trauma and regulate your nervous system.',
  },
];

async function seed() {
  const batch = db.batch();

  for (const subject of subjects) {
    const { id, ...data } = subject;
    const ref = db.collection('subjects').doc(id);
    batch.set(ref, data, { merge: true });
    console.log(`  Seeding: ${id} (${data.fullName})`);
  }

  await batch.commit();
  console.log(`\nDone! Seeded ${subjects.length} subjects.`);
}

seed().catch(console.error);
