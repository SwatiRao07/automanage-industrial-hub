// src/utils/communicationsBackfillFirestore.ts
import { db, functions } from "@/firebase";
import { doc, getDoc, onSnapshot, Timestamp, Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type {
  ContactDiscoveryJobState,
  EmailBackfillJobState,
  GmailContactDirectory,
} from "@/types/communicationsBackfill";

/** Kick off (or resume) a one-time scan of the caller's own Gmail mailbox. Idempotent. */
export const startContactDiscovery = async (): Promise<{ status: 'scanning' | 'ready' }> => {
  const fn = httpsCallable(functions, 'startContactDiscovery');
  const result = await fn({});
  return result.data as { status: 'scanning' | 'ready' };
};

/** Live-subscribe to the caller's own contact-discovery job progress. */
export const subscribeToContactDiscoveryJob = (
  uid: string,
  callback: (job: ContactDiscoveryJobState | null) => void
): Unsubscribe => {
  return onSnapshot(doc(db, 'gmailContactDiscoveryJobs', uid), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const data = snap.data();
    callback({
      status: data.status,
      error: data.error,
      processedCount: data.processedCount,
      totalMessageCount: data.totalMessageCount ?? undefined,
      countComplete: data.countComplete ?? undefined,
      contactCount: data.accumulated ? Object.keys(data.accumulated).length : undefined,
    });
  });
};

/** One-shot fetch of the caller's own contact directory (built by the discovery job). */
export const getGmailContactDirectory = async (uid: string): Promise<GmailContactDirectory | null> => {
  const snap = await getDoc(doc(db, 'gmailContactDirectory', uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  const toDate = (value: Timestamp | undefined) => (value ? value.toDate() : new Date());
  return {
    contacts: data.contacts || [],
    scannedFromDate: toDate(data.scannedFromDate),
    lastScannedAt: toDate(data.lastScannedAt),
  };
};

/** Add selected contacts as project stakeholders and queue their email backfill. */
export const addProjectBackfillStakeholders = async (
  projectId: string,
  contacts: { email: string; name?: string }[]
): Promise<{ queuedContactCount: number }> => {
  const fn = httpsCallable(functions, 'addProjectBackfillStakeholders');
  const result = await fn({ projectId, contacts });
  return result.data as { queuedContactCount: number };
};

/** Live-subscribe to a project's email backfill job progress. */
export const subscribeToEmailBackfillJob = (
  projectId: string,
  callback: (job: EmailBackfillJobState | null) => void
): Unsubscribe => {
  return onSnapshot(doc(db, 'emailBackfillJobs', projectId), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const data = snap.data();
    callback({
      status: data.status,
      contacts: data.contacts || [],
      completedContacts: data.completedContacts || [],
      processedCount: data.processedCount || 0,
      matchedCount: data.matchedCount || 0,
      error: data.error,
    });
  });
};
