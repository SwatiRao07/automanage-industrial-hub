import type { ProjectMeeting, UnassignedMeeting } from "@/types/meeting";
import type { ProjectEmail, UnassignedEmail } from "@/types/email";

export type CommunicationItem =
  | { kind: 'meeting'; timestamp: Date; meeting: ProjectMeeting }
  | { kind: 'email'; timestamp: Date; email: ProjectEmail };

/** Merge a project's captured meetings and emails into one newest-first list. */
export const mergeCommunications = (
  meetings: ProjectMeeting[],
  emails: ProjectEmail[]
): CommunicationItem[] => {
  const items: CommunicationItem[] = [
    ...meetings.map((meeting): CommunicationItem => ({ kind: 'meeting', timestamp: meeting.startedAt, meeting })),
    ...emails.map((email): CommunicationItem => ({ kind: 'email', timestamp: email.sentAt, email })),
  ];
  return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};

export type UnassignedCommunicationItem =
  | { kind: 'meeting'; timestamp: Date; item: UnassignedMeeting }
  | { kind: 'email'; timestamp: Date; item: UnassignedEmail };

/** Merge unassigned meetings and emails into one newest-first triage list. */
export const mergeUnassignedCommunications = (
  meetings: UnassignedMeeting[],
  emails: UnassignedEmail[]
): UnassignedCommunicationItem[] => {
  const items: UnassignedCommunicationItem[] = [
    ...meetings.map((item): UnassignedCommunicationItem => ({ kind: 'meeting', timestamp: item.createdAt, item })),
    ...emails.map((item): UnassignedCommunicationItem => ({ kind: 'email', timestamp: item.createdAt, item })),
  ];
  return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};
