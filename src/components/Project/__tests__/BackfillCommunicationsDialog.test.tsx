// src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackfillCommunicationsDialog } from '../BackfillCommunicationsDialog';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
vi.mock('@/utils/emailFirestore', () => ({
  getGmailConnectionStatus: vi.fn().mockResolvedValue({ connected: true, status: 'connected' }),
}));
vi.mock('@/utils/settingsFirestore', () => ({
  getClient: vi.fn().mockResolvedValue({ id: 'c1', company: 'Client Co', email: 'ops@clientco.com', contacts: [] }),
}));
vi.mock('@/utils/communicationsBackfillFirestore', () => ({
  startContactDiscovery: vi.fn().mockResolvedValue({ status: 'ready' }),
  subscribeToContactDiscoveryJob: vi.fn((_uid, cb) => {
    cb({ status: 'ready' });
    return () => {};
  }),
  getGmailContactDirectory: vi.fn().mockResolvedValue({
    contacts: [
      { email: 'jane@clientco.com', name: 'Jane', domain: 'clientco.com', messageCount: 4, lastSeenAt: '2026-01-01T00:00:00.000Z' },
      { email: 'bob@vendorco.com', name: 'Bob', domain: 'vendorco.com', messageCount: 2, lastSeenAt: '2026-01-01T00:00:00.000Z' },
    ],
    scannedFromDate: new Date('2025-09-10'),
    lastScannedAt: new Date('2026-01-01'),
  }),
}));

describe('BackfillCommunicationsDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the client-domain match checked by default section and lets the admin expand other domains', async () => {
    render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    expect(screen.queryByText(/bob@vendorco.com/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText(/other domains/i));
    expect(screen.getByText(/bob@vendorco.com/i)).toBeInTheDocument();
  });

  it('pre-checks contacts already in alreadyBackfilledEmails', async () => {
    render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={['jane@clientco.com']}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /jane@clientco.com/i })).toBeChecked();
  });
});
