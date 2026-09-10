export interface DiscoveredContact {
  email: string;
  name: string;
  domain: string;
  messageCount: number;
  lastSeenAt: string; // ISO
}

export interface GmailContactDirectory {
  contacts: DiscoveredContact[];
  scannedFromDate: Date;
  lastScannedAt: Date;
}

export type ContactDiscoveryStatus = 'scanning' | 'ready' | 'failed';

export interface ContactDiscoveryJobState {
  status: ContactDiscoveryStatus;
  error?: string;
}

export type EmailBackfillStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EmailBackfillJobState {
  status: EmailBackfillStatus;
  contacts: string[];
  completedContacts: string[];
  processedCount: number;
  matchedCount: number;
  error?: string;
}
