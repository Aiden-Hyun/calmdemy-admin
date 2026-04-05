# Course Upload Guide

Complete guide for uploading therapy courses to Calmdemy using `uploadCourse.js`.

---

## Quick Start

```bash
cd apps/calmnest-headspace
node scripts/uploadCourse.js "./YourCourseFolder" \
  --course-code DBT101 \
  --title "Course Title" \
  --instructor "Narrator Name" \
  --thumbnail "https://images.unsplash.com/photo-xxx?w=800&q=80" \
  --delete-after
```

---

## Prerequisites

1. **Service Account Key**: `serviceAccountKey.json` must exist in the `calmnest-headspace` folder
   - Get from: Firebase Console → Project Settings → Service Accounts → Generate new private key

2. **FFmpeg** (for audio normalization): `brew install ffmpeg`

3. **music-metadata package**: `npm install music-metadata`

---

## Input File Naming Convention

The script parses filenames to extract metadata. Files must follow this naming pattern:

### Standard Pattern

```
{ORDER}_{TYPE}: {TITLE}.mp3
```

### Examples

| Original Filename | Parsed As |
|-------------------|-----------|
| `01_Course Intro.mp3` | Order: 1, Type: intro, Title: "Course Introduction" |
| `02_Module 1 - lesson: Emotions Make Sense.mp3` | Order: 2, Module: 1, Type: lesson, Title: "Emotions Make Sense" |
| `03_Module 1 - practice: Gentle Emotion Scan.mp3` | Order: 3, Module: 1, Type: practice, Title: "Gentle Emotion Scan" |
| `04_Module 2 - lesson: Skills Overview.mp3` | Order: 4, Module: 2, Type: lesson, Title: "Skills Overview" |
| `05_Module 2 - practice: Build Your Map.mp3` | Order: 5, Module: 2, Type: practice, Title: "Build Your Map" |

### Supported Variations

The parser handles these variations:
- Underscores or spaces: `Module 1` or `Module_1`
- Dashes or em-dashes: `Module 1 - lesson` or `Module 1 – lesson`
- Colons or spaces after type: `lesson: Title` or `lesson Title`
- Artifact suffixes like `(online-video-cutter.com)` are automatically removed

---

## Output: Firebase Storage

Audio files are uploaded to:

```
gs://calmnest-e910e.firebasestorage.app/audio/meditate/courses/{course-id}/
```

### File Renaming

| Input Type | Output Filename |
|------------|-----------------|
| Course Intro | `course-intro.mp3` |
| Module 1 Lesson | `module-1-lesson.mp3` |
| Module 1 Practice | `module-1-practice.mp3` |
| Module 2 Lesson | `module-2-lesson.mp3` |
| Module 2 Practice | `module-2-practice.mp3` |
| ... | ... |

### Course ID Generation

The course code is converted to a lowercase hyphenated ID:

| Course Code | Course ID |
|-------------|-----------|
| `DBT101` | `dbt-101` |
| `CBT102` | `cbt-102` |
| `ACT201` | `act-201` |

---

## Output: Firestore Documents

### 1. Course Document

**Collection**: `courses`  
**Document ID**: `{course-id}` (e.g., `dbt-101`)

```javascript
{
  code: "DBT101",                                    // Course code
  title: "The DBT Model (Biosocial Theory + Skills)", // From --title flag or prompt
  subtitle: "Foundations of DBT",                    // Auto-generated
  description: "Learn the core principles...",       // Auto-generated
  thumbnailUrl: "https://images.unsplash.com/...",   // From --thumbnail flag
  color: "#F472B6",                                  // Based on therapy type
  icon: "git-merge-outline",                         // Based on therapy type
  instructor: "Britney",                             // From --instructor flag or prompt
  isFree: false,                                     // Default (premium)
  createdAt: Timestamp                               // Server timestamp
}
```

### 2. Session Documents

**Collection**: `course_sessions`  
**Document ID**: `{course-code-lowercase}_{session-suffix}` (e.g., `dbt_101_m1_lesson`)

```javascript
{
  courseId: "dbt-101",                               // References course document
  code: "DBT101M1L",                                 // Session code for UI display
  title: "Emotions Make Sense: Biology + Environment", // Extracted from filename
  description: "Learn about emotions make sense...", // Auto-generated
  duration_minutes: 8,                               // Calculated from audio file
  audioPath: "audio/meditate/courses/dbt-101/module-1-lesson.mp3",
  order: 2,                                          // Display order
  isFree: false                                      // Default (premium)
}
```

---

## Session Code System

Session codes are used for UI display and are parsed by `src/utils/courseCodeParser.ts`.

### Code Format

```
{COURSE_CODE}{SUFFIX}
```

### Suffix Types

| Suffix | Meaning | Example Code | Displayed As |
|--------|---------|--------------|--------------|
| `INT` | Course Intro | `DBT101INT` | "Course Intro" |
| `M{n}L` | Module n Lesson | `DBT101M1L` | "Module 1 Lesson" |
| `M{n}P` | Module n Practice | `DBT101M1P` | "Module 1 Practice" |

### Document ID Format

Document IDs use underscores and lowercase:

| Session Code | Document ID |
|--------------|-------------|
| `DBT101INT` | `dbt_101_intro` |
| `DBT101M1L` | `dbt_101_m1_lesson` |
| `DBT101M1P` | `dbt_101_m1_practice` |
| `DBT101M2L` | `dbt_101_m2_lesson` |

---

## Therapy Types and Colors

The script auto-detects therapy type from the course code prefix and applies appropriate styling:

| Code Prefix | Therapy | Color | Icon |
|-------------|---------|-------|------|
| `CBT` | Cognitive Behavioral Therapy | `#2DD4BF` (teal) | `bulb-outline` |
| `ACT` | Acceptance & Commitment | `#818CF8` (purple) | `hand-left-outline` |
| `DBT` | Dialectical Behavior Therapy | `#F472B6` (pink) | `git-merge-outline` |
| `MBCT` | Mindfulness-Based CBT | `#34D399` (green) | `infinite-outline` |
| `IFS` | Internal Family Systems | `#FB923C` (orange) | `people-outline` |
| `Somatic` | Body-Based Therapy | `#A78BFA` (violet) | `body-outline` |

---

## Course Thumbnail Images

Each course should have a thumbnail image. Use Unsplash for free, high-quality images.

### How to Get a Thumbnail URL

1. Go to [unsplash.com](https://unsplash.com)
2. Search for relevant terms: "meditation", "mindfulness", "therapy", "calm", "zen"
3. Click on an image you like
4. Right-click the image → "Copy Image Address"
5. Add `?w=800&q=80` to the URL for optimized size

### Recommended URL Format

```
https://images.unsplash.com/photo-XXXXX?w=800&q=80
```

- `w=800` - Width 800px (good for mobile)
- `q=80` - Quality 80% (good balance of size/quality)

### Example Thumbnail URLs by Therapy Type

| Therapy | Suggested Search | Example URL |
|---------|------------------|-------------|
| DBT | "balance", "zen stones", "calm water" | `https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80` |
| CBT | "thinking", "lightbulb", "clarity" | `https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=800&q=80` |
| ACT | "nature path", "acceptance", "open hands" | `https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=800&q=80` |
| MBCT | "meditation", "mindfulness", "present moment" | `https://images.unsplash.com/photo-1545389336-cf090694435e?w=800&q=80` |
| IFS | "reflection", "mirror", "inner self" | `https://images.unsplash.com/photo-1499728603263-13571697eb3b?w=800&q=80` |
| Somatic | "body", "yoga", "movement" | `https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80` |

---

## Command Line Options

| Flag | Required | Description |
|------|----------|-------------|
| `<folder-path>` | Yes | Path to folder containing MP3 files |
| `--course-code <CODE>` | Yes | Course code (e.g., `DBT101`, `CBT102`) |
| `--title "<TITLE>"` | No | Course title (prompted interactively if omitted) |
| `--thumbnail "<URL>"` | No | Thumbnail image URL (recommended: use Unsplash) |
| `--instructor "<NAME>"` | No | Narrator/instructor name (prompted interactively if omitted) |
| `--delete-after` | No | Delete local folder after successful upload |
| `--dry-run` | No | Preview what would be uploaded without making changes |
| `--skip-normalize` | No | Skip audio loudness normalization |

### Interactive Prompts

If not provided via command line, the script will prompt for:
1. **Course title** - The display name of the course
2. **Narrator/instructor** - Who narrates the audio (e.g., "Britney", "Alex", "Calmdemy")

---

## What the Script Does (Step by Step)

1. **Validate Arguments**
   - Check folder exists
   - Verify `--course-code` is provided
   - Check `serviceAccountKey.json` exists

2. **Scan Folder**
   - Find all `.mp3` files (ignores hidden files starting with `.`)
   - Sort by filename

3. **Parse Each File**
   - Extract order number from filename prefix
   - Detect type (intro, lesson, practice)
   - Extract module number
   - Extract session title
   - Generate session code (e.g., `DBT101M1L`)
   - Generate standard filename (e.g., `module-1-lesson.mp3`)
   - Generate document ID (e.g., `dbt_101_m1_lesson`)

4. **Get Audio Duration**
   - Uses `music-metadata` library for accurate duration
   - Falls back to file size estimation if library unavailable

5. **Normalize Audio (if FFmpeg available)**
   - Analyzes loudness using FFmpeg `loudnorm` filter
   - Target: -16 LUFS (industry standard for streaming)
   - Tolerance: ±3 LUFS (files within range are left unchanged)
   - Normalizes in-place if needed

6. **Upload to Firebase Storage**
   - Destination: `audio/meditate/courses/{course-id}/{filename}.mp3`
   - Sets `contentType: audio/mpeg`
   - Sets `cacheControl: public, max-age=31536000` (1 year)

7. **Create Firestore Course Document**
   - Collection: `courses`
   - Document ID: `{course-id}` (e.g., `dbt-101`)

8. **Create Firestore Session Documents**
   - Collection: `course_sessions`
   - One document per audio file
   - Links to course via `courseId` field

9. **Delete Local Folder (if `--delete-after`)**
   - Only deletes if all uploads succeeded
   - Uses `fs.rmSync` with `recursive: true`

10. **Print Summary**
    - Shows counts of created documents
    - Provides Firebase Console links

---

## Example: Full Upload Session

```bash
$ node scripts/uploadCourse.js "./DBT101_Course" \
  --course-code DBT101 \
  --title "The DBT Model" \
  --instructor "Britney" \
  --thumbnail "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80" \
  --delete-after

🎓 Course Upload Tool

======================================================================

📁 Folder: /Users/you/app-spree/apps/calmnest-headspace/DBT101_Course
📦 Course Code: DBT101
📄 Files found: 9
🔧 Normalize audio: Yes
🗑️  Delete after: Yes
🧪 Dry run: No

======================================================================

📋 Parsing files:

   1. Course Introduction
      Code: DBT101INT | File: course-intro.mp3
   2. Emotions Make Sense: Biology + Environment
      Code: DBT101M1L | File: module-1-lesson.mp3
   ...

======================================================================

🚀 Processing sessions:

📄 1. Course Introduction
   ⏱️  Getting duration... 2:02 (2 min)
   📊 Analyzing loudness... -13.7 LUFS
   ✅ Loudness OK
   ☁️  Uploading to course-intro.mp3... ✅
...

======================================================================

📝 Creating Firestore documents:

   📚 Creating course: courses/dbt-101... ✅
   📄 Creating session: dbt_101_intro... ✅
   📄 Creating session: dbt_101_m1_lesson... ✅
   ...

======================================================================

📊 Summary:
   ✅ Course created: 1
   ✅ Sessions created: 9/9
   ☁️  Files uploaded: 9

🗑️  Deleting local folder...
   ✅ Folder deleted

======================================================================

🎉 Done! Course is now available in the app.
```

---

## Verification

After upload, verify in Firebase Console:

1. **Firestore Course Document**:
   ```
   https://console.firebase.google.com/project/calmnest-e910e/firestore/data/courses/{course-id}
   ```

2. **Firestore Session Documents**:
   ```
   https://console.firebase.google.com/project/calmnest-e910e/firestore/data/course_sessions
   ```
   Filter by `courseId == "{course-id}"`

3. **Storage Files**:
   ```
   https://console.firebase.google.com/project/calmnest-e910e/storage/calmnest-e910e.firebasestorage.app/files/~2Faudio~2Fmeditate~2Fcourses~2F{course-id}
   ```

4. **In App**: Open the app → Meditate tab → Therapies → Filter by therapy type

---

## Troubleshooting

### "serviceAccountKey.json not found"
Download from Firebase Console → Project Settings → Service Accounts → Generate new private key

### "FFmpeg not found"
Install with `brew install ffmpeg`. Audio will still upload without normalization.

### File not parsed correctly
Check filename follows pattern: `{ORDER}_{TYPE}: {TITLE}.mp3`
- Order must be 2 digits: `01`, `02`, etc.
- Type must be `Course Intro`, `Module X - lesson`, or `Module X - practice`
- Title comes after the colon

### Upload failed
- Check internet connection
- Verify service account has Storage Admin and Firestore Admin permissions
- Check Firebase project quota

---

## Related Files

| File | Purpose |
|------|---------|
| `scripts/uploadCourse.js` | Main upload script |
| `scripts/uploadAudio.js` | Single file upload (used for non-course content) |
| `scripts/getAudioDuration.js` | Standalone duration checker |
| `src/services/firestoreService.ts` | App's Firestore queries (getCourses, getCourseById) |
| `src/utils/courseCodeParser.ts` | Parses session codes for UI display |
| `app/meditations/therapies.tsx` | Displays courses filtered by therapy type |
| `app/course/[id].tsx` | Course detail page showing sessions |
| `app/course/session/[id].tsx` | Session player page |
