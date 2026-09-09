import { describe, expect, it } from 'vitest';
import { mergeCommunications, mergeUnassignedCommunications } from '../communicationsMerge';
import type { ProjectMeeting, UnassignedMeeting } from '@/types/meeting';
import type { ProjectEmail, UnassignedEmail } from '@/types/email';

const baseMeeting: ProjectMeeting = {
  id: 'm1',
  fathomRecordingId: 'rec-1',
  title: 'Weekly Sync',
  shareUrl: 'https://fathom.video/share/1',
  startedAt: new Date('2026-01-02T10:00:00Z'),
  endedAt: new Date('2026-01-02T10:30:00Z'),
  hostEmail: 'host@qualitastech.com',
  attendees: [],
  summary: '',
  actionItems: [],
  matchedStakeholderEmails: [],
  createdAt: new Date('2026-01-02T10:31:00Z'),
};

const baseEmail: ProjectEmail = {
  id: 'e1',
  gmailMessageId: 'msg-1',
  gmailThreadId: 'thread-1',
  subject: 'Quote request',
  from: { email: 'jane@clientco.com' },
  to: [{ email: 'host@qualitastech.com' }],
  cc: [],
  sentAt: new Date('2026-01-03T09:00:00Z'),
  direction: 'inbound',
  body: 'Please send an updated quote.',
  sanitizeFailed: false,
  matchedStakeholderEmails: [],
  createdAt: new Date('2026-01-03T09:01:00Z'),
};

describe('mergeCommunications', () => {
  it('interleaves meetings and emails sorted newest-first by their own timestamp', () => {
    const result = mergeCommunications([baseMeeting], [baseEmail]);
    expect(result.map((item) => item.kind)).toEqual(['email', 'meeting']);
    expect(result[0].timestamp).toEqual(baseEmail.sentAt);
    expect(result[1].timestamp).toEqual(baseMeeting.startedAt);
  });

  it('returns an empty array when there is nothing captured', () => {
    expect(mergeCommunications([], [])).toEqual([]);
  });
});

describe('mergeUnassignedCommunications', () => {
  it('sorts unassigned meetings and emails by createdAt, newest first', () => {
    const olderMeeting: UnassignedMeeting = {
      ...baseMeeting,
      candidateProjectIds: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const newerEmail: UnassignedEmail = {
      ...baseEmail,
      candidateProjectIds: ['proj-1', 'proj-2'],
      createdAt: new Date('2026-01-05T00:00:00Z'),
    };

    const result = mergeUnassignedCommunications([olderMeeting], [newerEmail]);
    expect(result.map((item) => item.kind)).toEqual(['email', 'meeting']);
  });
});
