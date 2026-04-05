/**
 * Script to get audio file durations
 * Usage: node scripts/getAudioDuration.js <path-to-audio-file-or-directory>
 */

const fs = require('fs');
const path = require('path');

// Try to use music-metadata if available, otherwise use a simpler approach
async function getDuration(filePath) {
  try {
    // Try music-metadata first
    const mm = require('music-metadata');
    const metadata = await mm.parseFile(filePath);
    return metadata.format.duration;
  } catch (err) {
    // Fallback: estimate from file size (rough approximation for 128kbps MP3)
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;
    // Assuming 128kbps bitrate: duration = fileSize / (bitrate/8)
    const estimatedDuration = fileSizeInBytes / (128 * 1024 / 8);
    return estimatedDuration;
  }
}

async function processPath(inputPath) {
  const stats = fs.statSync(inputPath);
  
  if (stats.isDirectory()) {
    const files = fs.readdirSync(inputPath)
      .filter(f => f.endsWith('.mp3'))
      .map(f => path.join(inputPath, f));
    
    console.log(`\nAudio durations for files in: ${inputPath}\n`);
    console.log('='.repeat(60));
    
    let totalDuration = 0;
    
    for (const file of files) {
      const duration = await getDuration(file);
      const minutes = Math.floor(duration / 60);
      const seconds = Math.round(duration % 60);
      const durationMinutes = Math.round(duration / 60);
      
      console.log(`\nFile: ${path.basename(file)}`);
      console.log(`  Duration: ${minutes}:${seconds.toString().padStart(2, '0')} (${duration.toFixed(1)} seconds)`);
      console.log(`  Duration (minutes): ${durationMinutes}`);
      
      totalDuration += duration;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`Total: ${Math.floor(totalDuration / 60)}:${Math.round(totalDuration % 60).toString().padStart(2, '0')}`);
    console.log(`Total (minutes): ${Math.round(totalDuration / 60)}`);
    
  } else if (stats.isFile() && inputPath.endsWith('.mp3')) {
    const duration = await getDuration(inputPath);
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    
    console.log(`\nFile: ${path.basename(inputPath)}`);
    console.log(`Duration: ${minutes}:${seconds.toString().padStart(2, '0')} (${duration.toFixed(1)} seconds)`);
    console.log(`Duration (minutes): ${Math.round(duration / 60)}`);
  } else {
    console.error('Please provide a valid MP3 file or directory path');
    process.exit(1);
  }
}

const inputPath = process.argv[2] || 'assets/audio/meditate/courses/foundational-series';

if (!fs.existsSync(inputPath)) {
  console.error(`Path not found: ${inputPath}`);
  process.exit(1);
}

processPath(inputPath).catch(console.error);

