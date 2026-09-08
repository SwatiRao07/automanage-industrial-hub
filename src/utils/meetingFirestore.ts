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
import type { ProjectMeeting, UnassignedMeeting, MeetingAttendee } from "@/types/meeting";

const toDate = (value: Timestamp | Date | undefined): Date | undefined => {
  if (!value) return undefined;
  return value instanceof Timestamp ? value.toDate() : value;
};

const mapMeetingDocument = (id: string, data: Record<string, unknown>): ProjectMeeting => ({
  id,
  fathomRecordingId: (data.fathomRecordingId as string) || '',
  title: (data.title as string) || '',
  shareUrl: (data.shareUrl as string) || '',
  startedAt: toDate(data.startedAt as Timestamp | Date | undefined) || new Date(),
  endedAt: toDate(data.endedAt as Timestamp | Date | undefined) || new Date(),
  hostEmail: (data.hostEmail as string) || '',
  attendees: (data.attendees as MeetingAttendee[]) || [],
  summary: (data.summary as string) || '',
  actionItems: (data.actionItems as string[]) || [],
  matchedStakeholderEmails: (data.matchedStakeholderEmails as string[]) || [],
  createdAt: toDate(data.createdAt as Timestamp | Date | undefined) || new Date(),
});

/** Live-subscribe to a project's captured meetings, newest first. */
export const subscribeToMeetings = (
  projectId: string,
  callback: (meetings: ProjectMeeting[]) => void
): Unsubscribe => {
  const q = query(collection(db, "projects", projectId, "meetings"), orderBy("startedAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => mapMeetingDocument(d.id, d.data())));
  });
};

/** One-shot fetch of meetings awaiting manual project assignment. */
export const getUnassignedMeetings = async (): Promise<UnassignedMeeting[]> => {
  const snapshot = await getDocs(collection(db, "unassignedMeetings"));
  return snapshot.docs.map((d) => {
    const data = d.data();
    const { matchedStakeholderEmails: _omit, ...rest } = mapMeetingDocument(d.id, data);
    return {
      ...rest,
      candidateProjectIds: (data.candidateProjectIds as string[]) || [],
    };
  });
};

/** Admin-only: move an unassigned meeting into a project. */
export const assignUnassignedMeeting = async (meetingId: string, projectId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'assignUnassignedMeeting');
  await fn({ meetingId, projectId });
};

/** Admin-only: discard an unassigned meeting that isn't project-related. */
export const discardUnassignedMeeting = async (meetingId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'discardUnassignedMeeting');
  await fn({ meetingId });
};
