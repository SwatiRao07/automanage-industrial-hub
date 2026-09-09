import { db, functions } from "@/firebase";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { ProjectEmail, UnassignedEmail, EmailParticipant, GmailConnectionStatus } from "@/types/email";

const toDate = (value: Timestamp | Date | undefined): Date | undefined => {
  if (!value) return undefined;
  return value instanceof Timestamp ? value.toDate() : value;
};

const mapEmailDocument = (id: string, data: Record<string, unknown>): ProjectEmail => ({
  id,
  gmailMessageId: (data.gmailMessageId as string) || '',
  gmailThreadId: (data.gmailThreadId as string) || '',
  subject: (data.subject as string) || '',
  from: (data.from as EmailParticipant) || { email: '' },
  to: (data.to as EmailParticipant[]) || [],
  cc: (data.cc as EmailParticipant[]) || [],
  sentAt: toDate(data.sentAt as Timestamp | Date | undefined) || new Date(),
  direction: (data.direction as 'inbound' | 'outbound') || 'inbound',
  body: (data.body as string) || '',
  sanitizeFailed: Boolean(data.sanitizeFailed),
  matchedStakeholderEmails: (data.matchedStakeholderEmails as string[]) || [],
  createdAt: toDate(data.createdAt as Timestamp | Date | undefined) || new Date(),
});

/** Live-subscribe to a project's captured emails, newest first. */
export const subscribeToEmails = (
  projectId: string,
  callback: (emails: ProjectEmail[]) => void
): Unsubscribe => {
  const q = query(collection(db, "projects", projectId, "emails"), orderBy("sentAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => mapEmailDocument(d.id, d.data())));
  });
};

/** One-shot fetch of emails awaiting manual project assignment. */
export const getUnassignedEmails = async (): Promise<UnassignedEmail[]> => {
  const snapshot = await getDocs(collection(db, "unassignedEmails"));
  return snapshot.docs.map((d) => {
    const data = d.data();
    const { matchedStakeholderEmails: _omit, ...rest } = mapEmailDocument(d.id, data);
    return {
      ...rest,
      candidateProjectIds: (data.candidateProjectIds as string[]) || [],
    };
  });
};

/** Admin-only: move an unassigned email into a project. */
export const assignUnassignedEmail = async (emailId: string, projectId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'assignUnassignedEmail');
  await fn({ emailId, projectId });
};

/** Admin-only: discard an unassigned email that isn't project-related. */
export const discardUnassignedEmail = async (emailId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'discardUnassignedEmail');
  await fn({ emailId });
};

export interface GmailConnectionState {
  connected: boolean;
  email?: string;
  status?: GmailConnectionStatus;
  lastSyncedAt?: Date;
}

/** Read back the caller's own Gmail connection state. */
export const getGmailConnectionStatus = async (): Promise<GmailConnectionState> => {
  const fn = httpsCallable(functions, 'getGmailConnectionStatus');
  const result = await fn({});
  const data = result.data as { connected: boolean; email?: string; status?: GmailConnectionStatus; lastSyncedAt?: string | null };
  return {
    connected: data.connected,
    email: data.email,
    status: data.status,
    lastSyncedAt: data.lastSyncedAt ? new Date(data.lastSyncedAt) : undefined,
  };
};

/** Exchange an OAuth code (from the Google consent redirect) for a connected Gmail account. */
export const connectGmailAccount = async (code: string, redirectUri: string): Promise<{ email: string }> => {
  const fn = httpsCallable(functions, 'connectGmailAccount');
  const result = await fn({ code, redirectUri });
  return result.data as { email: string };
};
