import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/firebase";

export interface PlaybackProgress {
  user_id: string;
  content_id: string;
  content_type: string;
  position_seconds: number;
  duration_seconds: number;
  updated_at: Timestamp;
}

const playbackProgressCollection = collection(db, "playback_progress");

export async function savePlaybackProgress(
  userId: string,
  contentId: string,
  contentType: string,
  positionSeconds: number,
  durationSeconds: number
): Promise<void> {
  if (positionSeconds < 5) return;
  if (durationSeconds > 0 && positionSeconds / durationSeconds >= 0.95) return;

  try {
    const docId = `${userId}_${contentId}`;
    await setDoc(doc(playbackProgressCollection, docId), {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      position_seconds: positionSeconds,
      duration_seconds: durationSeconds,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error saving playback progress:", error);
  }
}

export async function getPlaybackProgress(
  userId: string,
  contentId: string
): Promise<PlaybackProgress | null> {
  try {
    const docId = `${userId}_${contentId}`;
    const docSnap = await getDoc(doc(playbackProgressCollection, docId));
    if (!docSnap.exists()) return null;
    return docSnap.data() as PlaybackProgress;
  } catch (error) {
    console.error("Error getting playback progress:", error);
    return null;
  }
}

export async function clearPlaybackProgress(
  userId: string,
  contentId: string
): Promise<void> {
  try {
    const docId = `${userId}_${contentId}`;
    await deleteDoc(doc(playbackProgressCollection, docId));
  } catch (error) {
    console.error("Error clearing playback progress:", error);
  }
}
