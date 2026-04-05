import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/firebase";
import { RatingType } from "@/types";

const contentRatingsCollection = collection(db, "content_ratings");

export async function getUserRating(
  userId: string,
  contentId: string
): Promise<RatingType | null> {
  try {
    const q = query(
      contentRatingsCollection,
      where("user_id", "==", userId),
      where("content_id", "==", contentId)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    return snapshot.docs[0].data().rating as RatingType;
  } catch (error) {
    console.error("Error getting user rating:", error);
    return null;
  }
}

export async function setContentRating(
  userId: string,
  contentId: string,
  contentType: string,
  rating: RatingType
): Promise<RatingType | null> {
  try {
    const q = query(
      contentRatingsCollection,
      where("user_id", "==", userId),
      where("content_id", "==", contentId)
    );
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const existingDoc = snapshot.docs[0];
      const existingRating = existingDoc.data().rating as RatingType;

      if (existingRating === rating) {
        await deleteDoc(existingDoc.ref);
        return null;
      }

      await setDoc(existingDoc.ref, {
        user_id: userId,
        content_id: contentId,
        content_type: contentType,
        rating,
        rated_at: serverTimestamp(),
      });
      return rating;
    }

    await addDoc(contentRatingsCollection, {
      user_id: userId,
      content_id: contentId,
      content_type: contentType,
      rating,
      rated_at: serverTimestamp(),
    });
    return rating;
  } catch (error) {
    console.error("Error setting content rating:", error);
    return null;
  }
}
