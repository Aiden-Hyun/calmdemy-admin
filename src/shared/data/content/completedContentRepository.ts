import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/firebase";

const completedContentCollection = collection(db, "completed_content");

export async function markContentCompleted(
  userId: string,
  contentId: string,
  contentType: string
): Promise<void> {
  try {
    const docId = `${userId}_${contentId}`;
    await setDoc(doc(completedContentCollection, docId), {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      completed_at: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error marking content as completed:", error);
  }
}

export async function getCompletedContentIds(
  userId: string,
  contentType: string
): Promise<Set<string>> {
  try {
    const q = query(
      completedContentCollection,
      where("user_id", "==", userId),
      where("content_type", "==", contentType)
    );
    const snapshot = await getDocs(q);
    const completedIds = new Set<string>();
    snapshot.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      completedIds.add(data.content_id);
    });
    return completedIds;
  } catch (error) {
    console.error("Error getting completed content:", error);
    return new Set<string>();
  }
}

export async function isContentCompleted(
  userId: string,
  contentId: string
): Promise<boolean> {
  try {
    const docId = `${userId}_${contentId}`;
    const docSnap = await getDoc(doc(completedContentCollection, docId));
    return docSnap.exists();
  } catch (error) {
    console.error("Error checking content completion:", error);
    return false;
  }
}
