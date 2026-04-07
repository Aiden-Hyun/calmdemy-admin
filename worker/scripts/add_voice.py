#!/usr/bin/env python3
"""
Add a new TTS voice/narrator to the Calmdemy content factory.

This script automates ALL the steps needed to register a new cloned voice:

  1. Trims a source audio file to a sample clip (wav, 16-bit PCM)
  2. Creates a transcript file for the sample
  3. Prints the code snippets you need to paste into:
       - src/features/admin/constants/models.ts   (admin UI voice option)
       - worker/factory_v2/shared/voice_utils.py   (worker narrator mapping)
  4. Optionally creates the narrator doc in Firestore via sync_narrators.py

------------------------------------------------------------------------
HOW VOICES WORK END-TO-END
------------------------------------------------------------------------

  Admin UI (models.ts)
    - TTS_VOICES array: each entry has an id, label, ttsModel, description,
      and a sampleAsset (require() to the local wav for in-browser preview).
    - The `id` is stored in Firestore on the content job as `ttsVoice`.
    - The `label` is what the admin sees in the radio button picker.

  Worker (voice_utils.py)
    - DEFAULT_VOICE_NAME_OVERRIDES maps voice id -> display name.
    - When the worker publishes content, it writes this display name as the
      `instructor` or `narrator` field on the Firestore content document.
    - The calmdemy-working app shows this name to end users.

  Narrator docs (Firestore `narrators` collection)
    - Each narrator has a doc with name, bio, photoUrl.
    - The calmdemy-working app looks up narrator metadata by name.
    - sync_narrators.py ensures these docs exist for every voice in
      DEFAULT_VOICE_NAME_OVERRIDES.

  Sample voice files (sample_voices/)
    - The Qwen3 Base TTS model clones a voice from a reference wav + transcript.
    - Files: sample_voices/<voice_id>.wav + sample_voices/<voice_id>_script.txt
    - The wav should be 7-20 seconds of clean speech, 16-bit PCM, any sample rate.
    - The transcript must match the spoken words exactly.

------------------------------------------------------------------------
USAGE
------------------------------------------------------------------------

  # Basic: trim 0:00-0:16 from source, create voice "Daniel"
  python3 scripts/add_voice.py \\
      --source ./Daniel.mp3 \\
      --name Daniel \\
      --start 0 --end 16 \\
      --transcript "Good morning, Welcome. My name is Manoj..."

  # Custom voice id (defaults to lowercase name)
  python3 scripts/add_voice.py \\
      --source ./recording.wav \\
      --name "Sarah" \\
      --voice-id sarah_calm_20s \\
      --start 5 --end 25 \\
      --transcript "Let's begin by finding a comfortable position..."

  # Also sync narrator to Firestore
  python3 scripts/add_voice.py \\
      --source ./Daniel.mp3 \\
      --name Daniel \\
      --start 0 --end 16 \\
      --transcript "Good morning..." \\
      --sync-firestore

------------------------------------------------------------------------
AFTER RUNNING THIS SCRIPT
------------------------------------------------------------------------

  You still need to manually:

  1. Add the TTS_VOICES entry to models.ts (the script prints the snippet).
  2. Add the voice_utils.py entry (the script prints the snippet).
  3. Commit the new files + code changes.
  4. Run sync_narrators.py --apply if you didn't use --sync-firestore.

------------------------------------------------------------------------
"""

import argparse
import os
import subprocess
import sys
import wave

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
PROJECT_DIR = os.path.abspath(os.path.join(WORKER_DIR, ".."))
SAMPLE_VOICES_DIR = os.path.join(PROJECT_DIR, "sample_voices")


def convert_to_wav(source: str, dest: str) -> None:
    """
    Convert any audio format to 16-bit PCM wav using macOS afconvert.
    Falls back to ffmpeg if afconvert is not available.
    """
    # Try afconvert (built into macOS)
    try:
        subprocess.run(
            ["afconvert", "-f", "WAVE", "-d", "LEI16", source, dest],
            check=True,
            capture_output=True,
        )
        return
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    # Try ffmpeg
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", source, "-acodec", "pcm_s16le", dest],
            check=True,
            capture_output=True,
        )
        return
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    raise RuntimeError(
        "Neither afconvert (macOS) nor ffmpeg found. "
        "Install ffmpeg or run on macOS."
    )


def trim_wav(input_path: str, output_path: str, start_sec: float, end_sec: float) -> None:
    """
    Trim a wav file to [start_sec, end_sec] using Python's wave module.
    No external dependencies needed.
    """
    with wave.open(input_path, "rb") as inp:
        params = inp.getparams()
        sample_rate = params.framerate

        start_frame = int(start_sec * sample_rate)
        end_frame = int(end_sec * sample_rate)

        inp.setpos(start_frame)
        frames = inp.readframes(end_frame - start_frame)

    with wave.open(output_path, "wb") as out:
        out.setparams(params)
        out.writeframes(frames)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add a new TTS voice/narrator to the content factory.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--source", required=True, help="Path to source audio file (mp3, wav, etc.)")
    parser.add_argument("--name", required=True, help="Display name for the narrator (e.g. 'Daniel')")
    parser.add_argument("--voice-id", help="Voice ID (defaults to lowercase name + duration, e.g. 'daniel_16s')")
    parser.add_argument("--start", type=float, default=0, help="Trim start in seconds (default: 0)")
    parser.add_argument("--end", type=float, required=True, help="Trim end in seconds")
    parser.add_argument("--transcript", required=True, help="Exact transcript of the trimmed audio")
    parser.add_argument("--sync-firestore", action="store_true", help="Also run sync_narrators.py --apply")
    args = parser.parse_args()

    duration = int(args.end - args.start)
    voice_id = args.voice_id or f"{args.name.lower()}_{duration}s"

    wav_filename = f"{voice_id}.wav"
    script_filename = f"{voice_id}_script.txt"
    wav_path = os.path.join(SAMPLE_VOICES_DIR, wav_filename)
    script_path = os.path.join(SAMPLE_VOICES_DIR, script_filename)

    # Ensure sample_voices/ dir exists
    os.makedirs(SAMPLE_VOICES_DIR, exist_ok=True)

    # --- Step 1: Convert source to wav if needed, then trim ---
    print(f"Processing {args.source} -> {wav_path}")
    source_ext = os.path.splitext(args.source)[1].lower()

    if source_ext == ".wav":
        temp_wav = args.source
    else:
        temp_wav = os.path.join("/tmp", f"_add_voice_full_{voice_id}.wav")
        print(f"  Converting {source_ext} to wav...")
        convert_to_wav(args.source, temp_wav)

    print(f"  Trimming {args.start}s - {args.end}s ({duration}s)...")
    trim_wav(temp_wav, wav_path, args.start, args.end)

    file_size = os.path.getsize(wav_path)
    print(f"  Created: {wav_path} ({file_size:,} bytes)")

    # --- Step 2: Write transcript ---
    with open(script_path, "w") as f:
        f.write(args.transcript)
    print(f"  Created: {script_path}")

    # --- Step 3: Print code snippets ---
    # Relative path from models.ts to sample_voices/
    relative_require = f"../../../../sample_voices/{wav_filename}"

    print("\n" + "=" * 60)
    print("CODE CHANGES NEEDED")
    print("=" * 60)

    print(f"""
1. src/features/admin/constants/models.ts
   Add to TTS_VOICES array:

  {{
    id: '{voice_id}',
    label: '{args.name}',
    ttsModel: 'qwen3-base',
    description: 'Clone voice from sample_voices/{wav_filename}',
    sampleAsset: require('{relative_require}'),
  }},
""")

    print(f"""2. worker/factory_v2/shared/voice_utils.py
   Add to DEFAULT_VOICE_NAME_OVERRIDES:

    "{voice_id}": "{args.name}",
""")

    # --- Step 4: Optionally sync Firestore ---
    if args.sync_firestore:
        print("Syncing narrator to Firestore...")
        sync_script = os.path.join(BASE_DIR, "sync_narrators.py")
        venv_python = os.path.join(WORKER_DIR, ".venv", "bin", "python3")
        python = venv_python if os.path.exists(venv_python) else sys.executable
        result = subprocess.run(
            [python, sync_script, "--apply"],
            cwd=WORKER_DIR,
        )
        if result.returncode != 0:
            print("  WARNING: sync_narrators.py failed. Run it manually.")
    else:
        print("3. Run: cd worker && .venv/bin/python3 scripts/sync_narrators.py --apply")

    print("\n4. Commit: git add sample_voices/ src/ worker/ && git commit")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
