/**
 * Enforce "courses-only premium" policy in Firestore.
 *
 * Policy:
 * - Only `course_sessions` are premium-gated (isFree=false).
 * - All other audio content is free (isFree=true).
 * - Legacy `bedtime_stories.is_premium` is removed.
 *
 * Usage:
 *   node scripts/migrateCoursesOnlyPremium.js --dry-run
 *   node scripts/migrateCoursesOnlyPremium.js
 */

const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const BATCH_LIMIT = 450;

const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Missing serviceAccountKey.json in project root');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

let batch = db.batch();
let batchOps = 0;
let committedBatches = 0;
let updatedDocs = 0;

const perCollectionUpdates = {};

async function commitBatchIfNeeded(force = false) {
  if (batchOps === 0) return;
  if (!force && batchOps < BATCH_LIMIT) return;
  if (!isDryRun) {
    await batch.commit();
  }
  batch = db.batch();
  batchOps = 0;
  committedBatches += 1;
}

function markUpdate(collectionName) {
  updatedDocs += 1;
  perCollectionUpdates[collectionName] = (perCollectionUpdates[collectionName] || 0) + 1;
}

function queueMerge(docRef, collectionName, patch) {
  if (Object.keys(patch).length === 0) return;
  batch.set(docRef, patch, { merge: true });
  batchOps += 1;
  markUpdate(collectionName);
}

async function updateSimpleCollection(collectionName, patchBuilder) {
  const snapshot = await db.collection(collectionName).get();
  console.log(`\n📚 ${collectionName}: ${snapshot.size} docs`);

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const patch = patchBuilder(data);
    queueMerge(docSnap.ref, collectionName, patch);
  });

  await commitBatchIfNeeded();
}

async function updateAlbums() {
  const collectionName = 'albums';
  const snapshot = await db.collection(collectionName).get();
  console.log(`\n📚 ${collectionName}: ${snapshot.size} docs`);

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    let changed = false;

    const normalizedTracks = tracks.map((track) => {
      if (track && track.isFree !== true) {
        changed = true;
        return { ...track, isFree: true };
      }
      return track;
    });

    if (changed) {
      queueMerge(docSnap.ref, collectionName, {
        tracks: normalizedTracks,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  await commitBatchIfNeeded();
}

async function updateSeries() {
  const collectionName = 'series';
  const snapshot = await db.collection(collectionName).get();
  console.log(`\n📚 ${collectionName}: ${snapshot.size} docs`);

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const chapters = Array.isArray(data.chapters) ? data.chapters : [];
    let changed = false;

    const normalizedChapters = chapters.map((chapter) => {
      if (chapter && chapter.isFree !== true) {
        changed = true;
        return { ...chapter, isFree: true };
      }
      return chapter;
    });

    if (changed) {
      queueMerge(docSnap.ref, collectionName, {
        chapters: normalizedChapters,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  await commitBatchIfNeeded();
}

async function run() {
  console.log('🔧 Enforcing courses-only premium policy');
  console.log(`🧪 Mode: ${isDryRun ? 'DRY RUN' : 'LIVE WRITE'}`);

  await updateSimpleCollection('guided_meditations', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('sleep_meditations', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('bedtime_stories', (data) => {
    const patch = {};
    if (data.isFree !== true) patch.isFree = true;
    if (Object.prototype.hasOwnProperty.call(data, 'is_premium')) {
      patch.is_premium = FieldValue.delete();
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = FieldValue.serverTimestamp();
    }
    return patch;
  });

  await updateSimpleCollection('sleep_sounds', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('background_sounds', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('white_noise', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('music', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('asmr', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateSimpleCollection('emergency_meditations', (data) => (
    data.isFree === true ? {} : { isFree: true, updatedAt: FieldValue.serverTimestamp() }
  ));

  await updateAlbums();
  await updateSeries();

  // Keep course content premium-only.
  await updateSimpleCollection('course_sessions', (data) => (
    data.isFree === false ? {} : { isFree: false, updatedAt: FieldValue.serverTimestamp() }
  ));
  await updateSimpleCollection('courses', (data) => (
    data.isFree === false ? {} : { isFree: false, updatedAt: FieldValue.serverTimestamp() }
  ));

  await commitBatchIfNeeded(true);

  console.log('\n✅ Migration complete');
  console.log(`   Updated docs: ${updatedDocs}`);
  console.log(`   Batch commits: ${committedBatches}`);
  Object.keys(perCollectionUpdates)
    .sort()
    .forEach((key) => {
      console.log(`   - ${key}: ${perCollectionUpdates[key]}`);
    });
}

run().catch((error) => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
