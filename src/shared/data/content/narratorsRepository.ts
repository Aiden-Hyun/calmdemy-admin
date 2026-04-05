import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";

export interface FirestoreNarrator {
  id: string;
  name: string;
  bio?: string;
  photoUrl: string;
}

const narratorCache: Map<string, FirestoreNarrator> = new Map();

export async function getNarrators(): Promise<FirestoreNarrator[]> {
  try {
    const snapshot = await getDocs(collection(db, "narrators"));
    const narrators = snapshot.docs.map(
      (docSnapshot) =>
        ({ id: docSnapshot.id, ...docSnapshot.data() } as FirestoreNarrator)
    );
    narrators.forEach((n) => narratorCache.set(n.name.toLowerCase(), n));
    return narrators;
  } catch (error) {
    console.error("Error fetching narrators:", error);
    return [];
  }
}

export async function getNarratorByName(
  name: string
): Promise<FirestoreNarrator | null> {
  const cached = narratorCache.get(name.toLowerCase());
  if (cached) return cached;

  try {
    const q = query(collection(db, "narrators"), where("name", "==", name));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const narrator = {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data(),
    } as FirestoreNarrator;

    narratorCache.set(name.toLowerCase(), narrator);
    return narrator;
  } catch (error) {
    console.error("Error fetching narrator by name:", error);
    return null;
  }
}

export function getNarratorProfileUrl(name: string): string | null {
  const cached = narratorCache.get(name.toLowerCase());
  return cached?.photoUrl || null;
}
