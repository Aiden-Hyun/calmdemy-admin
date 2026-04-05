/**
 * Course Upload Script
 * 
 * Uploads an entire course folder to Firebase Storage and creates Firestore documents.
 * Handles file renaming, duration extraction, and proper session code generation.
 * 
 * Usage:
 *   node scripts/uploadCourse.js <folder-path> --course-code DBT101 [options]
 * 
 * Options:
 *   --course-code <CODE>   Course code (e.g., DBT101, CBT102) - REQUIRED
 *   --title <TITLE>        Course title (prompted if not provided)
 *   --thumbnail <URL>      Thumbnail image URL (e.g., Unsplash URL)
 *   --instructor <NAME>    Narrator/instructor name (prompted if not provided)
 *   --delete-after         Delete local folder after successful upload
 *   --dry-run              Preview what would be uploaded without actually uploading
 *   --skip-normalize       Skip audio loudness normalization
 * 
 * Expected file naming convention:
 *   01_Course Intro.mp3
 *   02_Module 1 - lesson: [Title].mp3
 *   03_Module 1 - practice: [Title].mp3
 *   04_Module 2 - lesson: [Title].mp3
 *   ...
 * 
 * Prerequisites:
 * - FFmpeg installed (brew install ffmpeg)
 * - serviceAccountKey.json in the calmnest-headspace folder
 * - music-metadata package (npm install music-metadata)
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { getFirestore } = require('firebase-admin/firestore');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const TARGET_LUFS = -16;
const TOLERANCE = 3;

// Therapy colors from therapies.tsx
const THERAPY_COLORS = {
  cbt: '#2DD4BF',
  act: '#818CF8',
  dbt: '#F472B6',
  mbct: '#34D399',
  ifs: '#FB923C',
  somatic: '#A78BFA',
};

// Therapy icons from therapies.tsx
const THERAPY_ICONS = {
  cbt: 'bulb-outline',
  act: 'hand-left-outline',
  dbt: 'git-merge-outline',
  mbct: 'infinite-outline',
  ifs: 'people-outline',
  somatic: 'body-outline',
};

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
const db = getFirestore();

// ==================== PARSING FUNCTIONS ====================

/**
 * Parse filename to extract metadata
 * Input: "02_Module 1 - lesson: Emotions Make Sense: Biology + Environment.mp3"
 * Output: { order: 2, module: 1, type: "lesson", title: "Emotions Make Sense: Biology + Environment" }
 */
function parseFileName(filename) {
  // Remove .mp3 extension and clean up common artifacts
  let baseName = filename.replace(/\.mp3$/i, '');
  
  // Remove common suffixes like "(online-video-cutter.com)"
  baseName = baseName.replace(/\s*\([^)]*cutter[^)]*\)/gi, '');
  baseName = baseName.replace(/\s*\([^)]*online[^)]*\)/gi, '');
  
  // Extract order number (first digits before underscore)
  const orderMatch = baseName.match(/^(\d+)[_\s]/);
  const order = orderMatch ? parseInt(orderMatch[1], 10) : null;
  
  // Check if it's a course intro
  if (/course\s*intro/i.test(baseName)) {
    return {
      order,
      module: null,
      type: 'intro',
      title: 'Course Introduction',
    };
  }
  
  // Parse "Module X - lesson/practice: Title" pattern (standard format)
  const moduleMatch = baseName.match(/module\s*(\d+)\s*[-–_]\s*(lesson|practice)\s*[:\s_]+(.+)/i);
  
  if (moduleMatch) {
    // Clean up the title - remove any leading underscores or course code prefixes
    let title = moduleMatch[3].trim();
    title = title.replace(/^[_\s]+/, ''); // Remove leading underscores
    title = title.replace(/_/g, ' '); // Replace remaining underscores with spaces
    
    return {
      order,
      module: parseInt(moduleMatch[1], 10),
      type: moduleMatch[2].toLowerCase(),
      title: title,
    };
  }
  
  // Alternative pattern: "Module_X_-_lesson_Title" (underscores instead of spaces)
  const altModuleMatch = baseName.match(/Module[_\s]*(\d+)[_\s]*[-–][_\s]*(lesson|practice)[_\s]+(.+)/i);
  
  if (altModuleMatch) {
    let title = altModuleMatch[3].trim();
    title = title.replace(/^[_\s]+/, '');
    title = title.replace(/_/g, ' ');
    // Also clean up titles that might have the course name prefix
    title = title.replace(/^[A-Z]{2,}\d+[_\s—–-]+.*?[_\s—–-]+/i, '');
    
    return {
      order,
      module: parseInt(altModuleMatch[1], 10),
      type: altModuleMatch[2].toLowerCase(),
      title: title,
    };
  }
  
  // Fallback: try to extract title from after the first separator
  const fallbackMatch = baseName.match(/^\d+[_\s]+(.+)/);
  return {
    order,
    module: null,
    type: 'unknown',
    title: fallbackMatch ? fallbackMatch[1].trim() : baseName,
  };
}

/**
 * Generate session code from course code, module, and type
 * Examples:
 *   generateSessionCode("DBT101", null, "intro") → "DBT101INT"
 *   generateSessionCode("DBT101", 1, "lesson") → "DBT101M1L"
 *   generateSessionCode("DBT101", 1, "practice") → "DBT101M1P"
 */
function generateSessionCode(courseCode, module, type) {
  if (type === 'intro') {
    return `${courseCode}INT`;
  }
  
  const typeChar = type === 'lesson' ? 'L' : type === 'practice' ? 'P' : '';
  return `${courseCode}M${module}${typeChar}`;
}

/**
 * Get standard storage filename
 * Examples:
 *   getStandardFileName(null, "intro") → "course-intro.mp3"
 *   getStandardFileName(1, "lesson") → "module-1-lesson.mp3"
 *   getStandardFileName(2, "practice") → "module-2-practice.mp3"
 */
function getStandardFileName(module, type) {
  if (type === 'intro') {
    return 'course-intro.mp3';
  }
  return `module-${module}-${type}.mp3`;
}

/**
 * Generate Firestore document ID from course code and session info
 * Examples:
 *   generateDocId("DBT101", null, "intro") → "dbt_101_intro"
 *   generateDocId("DBT101", 1, "lesson") → "dbt_101_m1_lesson"
 */
function generateDocId(courseCode, module, type) {
  // Split course code into letters and numbers (e.g., "DBT101" → "dbt_101")
  const match = courseCode.match(/([A-Za-z]+)(\d+)/);
  if (!match) return courseCode.toLowerCase();
  
  const prefix = `${match[1].toLowerCase()}_${match[2]}`;
  
  if (type === 'intro') {
    return `${prefix}_intro`;
  }
  return `${prefix}_m${module}_${type}`;
}

/**
 * Generate course document ID from course code
 * Example: "DBT101" → "dbt-101"
 */
function generateCourseDocId(courseCode) {
  const match = courseCode.match(/([A-Za-z]+)(\d+)/);
  if (!match) return courseCode.toLowerCase();
  return `${match[1].toLowerCase()}-${match[2]}`;
}

/**
 * Extract therapy type from course code
 * Example: "DBT101" → "dbt"
 */
function getTherapyType(courseCode) {
  const match = courseCode.match(/^([A-Za-z]+)/);
  return match ? match[1].toLowerCase() : 'cbt';
}

// ==================== AUDIO FUNCTIONS ====================

async function getDuration(filePath) {
  try {
    const mm = require('music-metadata');
    const metadata = await mm.parseFile(filePath);
    return metadata.format.duration || 0;
  } catch (err) {
    // Fallback: estimate from file size (rough approximation for 128kbps MP3)
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes / (128 * 1024 / 8);
  }
}

function checkFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

// ==================== FIREBASE FUNCTIONS ====================

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

async function createCourseDocument(courseId, courseData) {
  try {
    await db.collection('courses').doc(courseId).set(courseData);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to create course document: ${error.message}`);
    return false;
  }
}

async function createSessionDocument(sessionId, sessionData) {
  try {
    await db.collection('course_sessions').doc(sessionId).set(sessionData);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to create session document: ${error.message}`);
    return false;
  }
}

// ==================== HELPER FUNCTIONS ====================

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function findMp3Files(dir) {
  if (!fs.existsSync(dir)) return [];
  
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp3') && !f.startsWith('.'))
    .map(f => path.join(dir, f))
    .sort();
}

// ==================== MAIN FUNCTION ====================

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const folderPath = args.find(arg => !arg.startsWith('--'));
  const courseCodeIndex = args.indexOf('--course-code');
  const courseCode = courseCodeIndex !== -1 ? args[courseCodeIndex + 1] : null;
  const titleIndex = args.indexOf('--title');
  const courseTitle = titleIndex !== -1 ? args[titleIndex + 1] : null;
  const thumbnailIndex = args.indexOf('--thumbnail');
  const thumbnailUrl = thumbnailIndex !== -1 ? args[thumbnailIndex + 1] : null;
  const instructorIndex = args.indexOf('--instructor');
  const instructorArg = instructorIndex !== -1 ? args[instructorIndex + 1] : null;
  const deleteAfter = args.includes('--delete-after');
  const dryRun = args.includes('--dry-run');
  const skipNormalize = args.includes('--skip-normalize');
  
  console.log('🎓 Course Upload Tool\n');
  console.log('='.repeat(70));
  
  // Validate arguments
  if (!folderPath) {
    console.log('Usage:');
    console.log('  node scripts/uploadCourse.js <folder-path> --course-code <CODE> [options]');
    console.log('\nOptions:');
    console.log('  --course-code <CODE>   Course code (e.g., DBT101) - REQUIRED');
    console.log('  --title <TITLE>        Course title (prompted if not provided)');
    console.log('  --thumbnail <URL>      Thumbnail image URL (find one on Unsplash)');
    console.log('  --instructor <NAME>    Narrator/instructor name (prompted if not provided)');
    console.log('  --delete-after         Delete local folder after upload');
    console.log('  --dry-run              Preview without uploading');
    console.log('  --skip-normalize       Skip audio normalization');
    process.exit(0);
  }
  
  if (!courseCode) {
    console.error('❌ Error: --course-code is required');
    console.log('Example: node scripts/uploadCourse.js ./DBT_folder --course-code DBT101');
    process.exit(1);
  }
  
  const fullPath = path.isAbsolute(folderPath) 
    ? folderPath 
    : path.join(process.cwd(), folderPath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Folder not found: ${fullPath}`);
    process.exit(1);
  }
  
  // Find MP3 files
  const mp3Files = findMp3Files(fullPath);
  
  if (mp3Files.length === 0) {
    console.error('❌ No MP3 files found in folder');
    process.exit(1);
  }
  
  // Parse all files
  console.log(`\n📁 Folder: ${fullPath}`);
  console.log(`📦 Course Code: ${courseCode}`);
  console.log(`📄 Files found: ${mp3Files.length}`);
  console.log(`🔧 Normalize audio: ${skipNormalize ? 'No' : 'Yes'}`);
  console.log(`🗑️  Delete after: ${deleteAfter ? 'Yes' : 'No'}`);
  console.log(`🧪 Dry run: ${dryRun ? 'Yes' : 'No'}`);
  console.log('\n' + '='.repeat(70));
  
  // Parse files and prepare session data
  const sessions = [];
  
  console.log('\n📋 Parsing files:\n');
  
  for (const filePath of mp3Files) {
    const fileName = path.basename(filePath);
    const parsed = parseFileName(fileName);
    
    if (!parsed.order) {
      console.log(`   ⚠️  Skipping (no order): ${fileName}`);
      continue;
    }
    
    const sessionCode = generateSessionCode(courseCode, parsed.module, parsed.type);
    const standardFileName = getStandardFileName(parsed.module, parsed.type);
    const docId = generateDocId(courseCode, parsed.module, parsed.type);
    
    console.log(`   ${parsed.order}. ${parsed.title}`);
    console.log(`      Code: ${sessionCode} | File: ${standardFileName}`);
    
    sessions.push({
      originalPath: filePath,
      originalName: fileName,
      parsed,
      sessionCode,
      standardFileName,
      docId,
    });
  }
  
  // Sort by order
  sessions.sort((a, b) => a.parsed.order - b.parsed.order);
  
  console.log('\n' + '='.repeat(70));
  
  if (dryRun) {
    console.log('\n🧪 DRY RUN - No changes made');
    console.log('\nWould create:');
    console.log(`   - Course document: courses/${generateCourseDocId(courseCode)}`);
    console.log(`   - ${sessions.length} session documents in course_sessions/`);
    console.log(`   - ${sessions.length} audio files in audio/meditate/courses/${generateCourseDocId(courseCode)}/`);
    process.exit(0);
  }
  
  // Check FFmpeg
  const hasFFmpeg = checkFFmpeg();
  if (!hasFFmpeg && !skipNormalize) {
    console.log('\n⚠️  FFmpeg not found - skipping audio normalization');
    console.log('   Install with: brew install ffmpeg');
  }
  
  // Get course title
  let finalTitle = courseTitle;
  if (!finalTitle) {
    // Try to extract from folder name or prompt
    const folderName = path.basename(fullPath);
    const titleMatch = folderName.match(/[A-Z]{2,}101[_\s—–-]+(.+)/i);
    if (titleMatch) {
      finalTitle = titleMatch[1].replace(/[_]/g, ' ').trim();
    } else {
      finalTitle = await prompt('\n📝 Enter course title: ');
    }
  }
  
  // Get instructor/narrator
  let finalInstructor = instructorArg;
  if (!finalInstructor) {
    finalInstructor = await prompt('👤 Enter narrator/instructor name: ');
    if (!finalInstructor || finalInstructor.trim() === '') {
      finalInstructor = 'Calmdemy'; // Default fallback
    }
  }
  
  const therapyType = getTherapyType(courseCode);
  const courseDocId = generateCourseDocId(courseCode);
  const storagePath = `audio/meditate/courses/${courseDocId}`;
  
  console.log(`\n📍 Storage path: ${storagePath}/`);
  console.log(`📄 Course ID: ${courseDocId}`);
  console.log(`🎨 Theme: ${therapyType.toUpperCase()} (${THERAPY_COLORS[therapyType] || '#6B7280'})`);
  
  // Process each session
  console.log('\n' + '='.repeat(70));
  console.log('\n🚀 Processing sessions:\n');
  
  const processedSessions = [];
  
  for (const session of sessions) {
    console.log(`\n📄 ${session.parsed.order}. ${session.parsed.title}`);
    
    // Step 1: Get duration
    process.stdout.write('   ⏱️  Getting duration... ');
    const durationSeconds = await getDuration(session.originalPath);
    const durationMinutes = Math.round(durationSeconds / 60);
    console.log(`${Math.floor(durationSeconds / 60)}:${Math.round(durationSeconds % 60).toString().padStart(2, '0')} (${durationMinutes} min)`);
    
    // Step 2: Normalize if needed
    if (hasFFmpeg && !skipNormalize) {
      process.stdout.write('   📊 Analyzing loudness... ');
      const loudness = analyzeLoudness(session.originalPath);
      
      if (loudness) {
        console.log(`${loudness.input_i.toFixed(1)} LUFS`);
        
        const diff = loudness.input_i - TARGET_LUFS;
        if (Math.abs(diff) > TOLERANCE) {
          process.stdout.write(`   🔧 Normalizing to ${TARGET_LUFS} LUFS... `);
          const normalized = normalizeFile(session.originalPath, loudness);
          console.log(normalized ? '✅' : '⚠️ Failed');
        } else {
          console.log('   ✅ Loudness OK');
        }
      } else {
        console.log('⚠️ Could not analyze');
      }
    }
    
    // Step 3: Upload to Storage
    const remoteFilePath = `${storagePath}/${session.standardFileName}`;
    process.stdout.write(`   ☁️  Uploading to ${session.standardFileName}... `);
    
    const uploaded = await uploadToStorage(session.originalPath, remoteFilePath);
    console.log(uploaded ? '✅' : '❌');
    
    if (uploaded) {
      processedSessions.push({
        ...session,
        durationMinutes,
        audioPath: remoteFilePath,
      });
    }
  }
  
  console.log('\n' + '='.repeat(70));
  
  // Create Firestore documents
  console.log('\n📝 Creating Firestore documents:\n');
  
  // Create course document
  const courseData = {
    code: courseCode,
    title: finalTitle,
    subtitle: `Foundations of ${therapyType.toUpperCase()}`,
    description: `Learn the core principles and practical skills of ${therapyType.toUpperCase()} through guided lessons and exercises.`,
    color: THERAPY_COLORS[therapyType] || '#6B7280',
    icon: THERAPY_ICONS[therapyType] || 'school-outline',
    instructor: finalInstructor,
    isFree: false,
    createdAt: new Date(),
  };
  
  // Add thumbnail if provided
  if (thumbnailUrl) {
    courseData.thumbnailUrl = thumbnailUrl;
  }
  
  process.stdout.write(`   📚 Creating course: courses/${courseDocId}... `);
  const courseCreated = await createCourseDocument(courseDocId, courseData);
  console.log(courseCreated ? '✅' : '❌');
  
  // Create session documents
  let sessionsCreated = 0;
  
  for (const session of processedSessions) {
    const sessionData = {
      courseId: courseDocId,
      code: session.sessionCode,
      title: session.parsed.title,
      description: `${session.parsed.type === 'lesson' ? 'Learn about' : 'Practice'} ${session.parsed.title.toLowerCase()}`,
      duration_minutes: session.durationMinutes,
      audioPath: session.audioPath,
      order: session.parsed.order,
      isFree: false,
    };
    
    process.stdout.write(`   📄 Creating session: ${session.docId}... `);
    const created = await createSessionDocument(session.docId, sessionData);
    console.log(created ? '✅' : '❌');
    
    if (created) sessionsCreated++;
  }
  
  console.log('\n' + '='.repeat(70));
  
  // Summary
  console.log('\n📊 Summary:');
  console.log(`   ✅ Course created: ${courseCreated ? 1 : 0}`);
  console.log(`   ✅ Sessions created: ${sessionsCreated}/${processedSessions.length}`);
  console.log(`   ☁️  Files uploaded: ${processedSessions.length}`);
  
  // Delete local folder if requested
  if (deleteAfter && processedSessions.length === sessions.length) {
    console.log(`\n🗑️  Deleting local folder: ${fullPath}`);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log('   ✅ Folder deleted');
    } catch (error) {
      console.log(`   ⚠️ Could not delete folder: ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n🎉 Done! Course is now available in the app.');
  console.log(`\n💡 View in Firebase Console:`);
  console.log(`   Firestore: https://console.firebase.google.com/project/calmnest-e910e/firestore/data/courses/${courseDocId}`);
  console.log(`   Storage: https://console.firebase.google.com/project/calmnest-e910e/storage/calmnest-e910e.firebasestorage.app/files/~2Faudio~2Fmeditate~2Fcourses~2F${courseDocId}`);
}

main().catch(console.error);
