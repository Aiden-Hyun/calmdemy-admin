/**
 * Unified Audio Upload Script
 * 
 * Analyzes, normalizes (if needed), and uploads audio to Firebase Storage
 * 
 * Usage:
 *   node scripts/uploadAudio.js <file-or-folder>           # Single file or folder
 *   node scripts/uploadAudio.js <file> --force             # Re-upload even if exists
 *   node scripts/uploadAudio.js <file> --skip-normalize    # Skip normalization
 *   node scripts/uploadAudio.js --all                      # Upload all audio files
 * 
 * Examples:
 *   node scripts/uploadAudio.js assets/audio/sleep/meditations/new-meditation.mp3
 *   node scripts/uploadAudio.js assets/audio/sleep/meditations/
 *   node scripts/uploadAudio.js --all --force
 * 
 * Prerequisites:
 * - FFmpeg installed (brew install ffmpeg)
 * - serviceAccountKey.json in the calmnest-headspace folder
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const TARGET_LUFS = -16;
const TOLERANCE = 3;
const AUDIO_DIR = path.join(__dirname, '..', 'assets', 'audio');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Error: serviceAccountKey.json not found!');
  console.log('\nTo get your service account key:');
  console.log('1. Go to Firebase Console > Project Settings > Service Accounts');
  console.log('2. Click "Generate new private key"');
  console.log('3. Save as "serviceAccountKey.json" in calmnest-headspace folder');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: 'calmnest-e910e.firebasestorage.app'
});

const bucket = getStorage().bucket();

// ==================== HELPER FUNCTIONS ====================

function checkFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    console.error('❌ FFmpeg is not installed!');
    console.log('\nInstall with: brew install ffmpeg');
    process.exit(1);
  }
}

function findAllMp3Files(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      findAllMp3Files(fullPath, files);
    } else if (item.endsWith('.mp3')) {
      files.push(fullPath);
    }
  }
  return files;
}

function analyzeLoudness(filePath) {
  try {
    const cmd = `ffmpeg -i "${filePath}" -af loudnorm=print_format=json -f null - 2>&1`;
    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    
    const jsonMatch = output.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        input_i: parseFloat(data.input_i),
        input_tp: data.input_tp,
        input_lra: data.input_lra,
        input_thresh: data.input_thresh,
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

function normalizeFile(inputPath, loudnessData) {
  const tempPath = inputPath + '.normalized.mp3';
  
  try {
    const cmd = `ffmpeg -y -i "${inputPath}" -af loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudnessData.input_i}:measured_TP=${loudnessData.input_tp}:measured_LRA=${loudnessData.input_lra}:measured_thresh=${loudnessData.input_thresh}:offset=0:linear=true -ar 44100 -b:a 192k "${tempPath}" 2>&1`;
    
    execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: 'pipe' });
    
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(inputPath);
      fs.renameSync(tempPath, inputPath);
      return true;
    }
    return false;
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    return false;
  }
}

async function fileExistsInStorage(remotePath) {
  try {
    const [exists] = await bucket.file(remotePath).exists();
    return exists;
  } catch {
    return false;
  }
}

async function uploadToStorage(localPath, remotePath) {
  try {
    await bucket.upload(localPath, {
      destination: remotePath,
      metadata: {
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000',
      },
    });
    return true;
  } catch (error) {
    console.error(`   ❌ Upload failed: ${error.message}`);
    return false;
  }
}

function getRemotePath(localPath) {
  // Convert local path to Firebase Storage path
  // assets/audio/sleep/meditations/file.mp3 -> audio/sleep/meditations/file.mp3
  const relativePath = path.relative(AUDIO_DIR, localPath);
  return 'audio/' + relativePath;
}

// ==================== MAIN PROCESSING ====================

async function processFile(filePath, options = {}) {
  const { force = false, skipNormalize = false } = options;
  const fileName = path.basename(filePath);
  const remotePath = getRemotePath(filePath);
  
  console.log(`\n📄 ${fileName}`);
  console.log(`   Path: ${remotePath}`);
  
  // Check if already exists in storage
  if (!force) {
    const exists = await fileExistsInStorage(remotePath);
    if (exists) {
      console.log('   ⏭️  Already exists in storage (use --force to re-upload)');
      return 'exists';
    }
  }
  
  // Step 1: Analyze loudness
  if (!skipNormalize) {
    process.stdout.write('   📊 Analyzing loudness... ');
    const loudness = analyzeLoudness(filePath);
    
    if (loudness) {
      const diff = loudness.input_i - TARGET_LUFS;
      console.log(`${loudness.input_i.toFixed(1)} LUFS`);
      
      // Step 2: Normalize if needed
      if (Math.abs(diff) > TOLERANCE) {
        process.stdout.write(`   🔧 Normalizing to ${TARGET_LUFS} LUFS... `);
        const normalized = normalizeFile(filePath, loudness);
        
        if (normalized) {
          const newLoudness = analyzeLoudness(filePath);
          console.log(`✅ Now ${newLoudness?.input_i?.toFixed(1) || TARGET_LUFS} LUFS`);
        } else {
          console.log('⚠️  Failed (uploading as-is)');
        }
      } else {
        console.log('   ✅ Loudness OK');
      }
    } else {
      console.log('⚠️  Could not analyze');
    }
  }
  
  // Step 3: Upload
  process.stdout.write('   ☁️  Uploading to Firebase Storage... ');
  const uploaded = await uploadToStorage(filePath, remotePath);
  
  if (uploaded) {
    console.log('✅ Done');
    console.log(`   📍 Storage path: ${remotePath}`);
    return 'uploaded';
  } else {
    return 'failed';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const skipNormalize = args.includes('--skip-normalize');
  const uploadAll = args.includes('--all');
  
  // Filter out flags to get the file/folder path
  const targetPath = args.find(arg => !arg.startsWith('--'));
  
  console.log('🎵 Unified Audio Upload Tool\n');
  console.log('='.repeat(60));
  
  checkFFmpeg();
  
  let filesToProcess = [];
  
  if (uploadAll) {
    console.log('📁 Mode: Upload all audio files');
    filesToProcess = findAllMp3Files(AUDIO_DIR);
  } else if (targetPath) {
    const fullPath = path.isAbsolute(targetPath) 
      ? targetPath 
      : path.join(process.cwd(), targetPath);
    
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Path not found: ${fullPath}`);
      process.exit(1);
    }
    
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      console.log(`📁 Mode: Upload folder - ${fullPath}`);
      filesToProcess = findAllMp3Files(fullPath);
    } else {
      console.log(`📄 Mode: Upload single file`);
      filesToProcess = [fullPath];
    }
  } else {
    console.log('Usage:');
    console.log('  node scripts/uploadAudio.js <file-or-folder>');
    console.log('  node scripts/uploadAudio.js --all');
    console.log('\nOptions:');
    console.log('  --force          Re-upload even if file exists');
    console.log('  --skip-normalize Skip loudness normalization');
    process.exit(0);
  }
  
  console.log(`📦 Files to process: ${filesToProcess.length}`);
  console.log(`🎯 Target loudness: ${TARGET_LUFS} LUFS`);
  console.log(`🔄 Force upload: ${force ? 'Yes' : 'No'}`);
  console.log(`🔧 Normalize: ${skipNormalize ? 'No' : 'Yes'}`);
  console.log('='.repeat(60));
  
  let uploaded = 0, exists = 0, failed = 0;
  
  for (const file of filesToProcess) {
    const result = await processFile(file, { force, skipNormalize });
    if (result === 'uploaded') uploaded++;
    else if (result === 'exists') exists++;
    else if (result === 'failed') failed++;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   ✅ Uploaded: ${uploaded}`);
  console.log(`   ⏭️  Already existed: ${exists}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log('='.repeat(60));
  
  if (uploaded > 0) {
    console.log('\n💡 Add this audioPath to your Firestore document:');
    if (filesToProcess.length === 1) {
      console.log(`   "${getRemotePath(filesToProcess[0])}"`);
    }
  }
}

main().catch(console.error);

