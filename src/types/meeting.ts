export interface MeetingAttendee {
  email: string;
  name?: string;
}

export interface ProjectMeeting {
  id: string;
  fathomRecordingId: string;
  title: string;
  shareUrl: string;
  startedAt: Date;
  endedAt: Date;
  hostEmail: string;
  attendees: MeetingAttendee[];
  summary: string;
  actionItems: string[];
  matchedStakeholderEmails: string[];
  createdAt: Date;
}

/** A meeting with zero or multiple stakeholder matches, awaiting manual triage. */
export interface UnassignedMeeting extends Omit<ProjectMeeting, 'matchedStakeholderEmails'> {
  candidateProjectIds: string[];
}
