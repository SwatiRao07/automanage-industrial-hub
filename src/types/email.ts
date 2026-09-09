// src/types/email.ts
export interface EmailParticipant {
  email: string;
  name?: string;
}

export interface ProjectEmail {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  from: EmailParticipant;
  to: EmailParticipant[];
  cc: EmailParticipant[];
  sentAt: Date;
  direction: 'inbound' | 'outbound';
  body: string;
  sanitizeFailed: boolean;
  matchedStakeholderEmails: string[];
  createdAt: Date;
}

/** An email with zero or multiple stakeholder matches, awaiting manual triage. */
export interface UnassignedEmail extends Omit<ProjectEmail, 'matchedStakeholderEmails'> {
  candidateProjectIds: string[];
}

export type GmailConnectionStatus = 'connected' | 'needs_reconnect';
