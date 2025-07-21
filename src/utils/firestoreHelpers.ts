import { doc, setDoc, getDoc } from "firebase/firestore";
import { db, auth } from "../firebase";

export const saveManHours = async (engineers: any[], selectedWeek: string) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  await setDoc(doc(db, "manHours", uid), {
    engineers,
    selectedWeek,
    updatedAt: new Date().toISOString()
  });
};

export const loadManHours = async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const docRef = doc(db, "manHours", uid);
  const docSnap = await getDoc(docRef);

  return docSnap.exists() ? docSnap.data() : null;
};
