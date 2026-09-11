// src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackfillCommunicationsDialog } from '../BackfillCommunicationsDialog';
import {
  startContactDiscovery,
  subscribeToContactDiscoveryJob,
  getGmailContactDirectory,
} from '@/utils/communicationsBackfillFirestore';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
vi.mock('@/utils/emailFirestore', () => ({
  getGmailConnectionStatus: vi.fn().mockResolvedValue({ connected: true, status: 'connected' }),
}));
vi.mock('@/utils/settingsFirestore', () => ({
  getClient: vi.fn().mockResolvedValue({ id: 'c1', company: 'Client Co', email: 'ops@clientco.com', contacts: [] }),
}));
vi.mock('@/utils/communicationsBackfillFirestore', () => ({
  startContactDiscovery: vi.fn(),
  subscribeToContactDiscoveryJob: vi.fn(),
  getGmailContactDirectory: vi.fn(),
}));

const DISCOVERED_CONTACTS = [
  { email: 'jane@clientco.com', name: 'Jane', domain: 'clientco.com', messageCount: 4, lastSeenAt: '2026-01-01T00:00:00.000Z' },
  { email: 'bob@vendorco.com', name: 'Bob', domain: 'vendorco.com', messageCount: 2, lastSeenAt: '2026-01-01T00:00:00.000Z' },
];

// Reset every mock to the "ready directory, happy path" default before each
// test, rather than relying on whatever a previous test happened to leave
// the mocks set to — several tests below need to override
// startContactDiscovery/subscribeToContactDiscoveryJob with persistent
// (non-"Once") implementations to simulate a stuck job doc, and those must
// not leak into later tests.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'ready' });
  vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
    cb({ status: 'ready' });
    return () => {};
  });
  vi.mocked(getGmailContactDirectory).mockResolvedValue({
    contacts: DISCOVERED_CONTACTS,
    scannedFromDate: new Date('2025-09-10'),
    lastScannedAt: new Date('2026-01-01'),
  });
});

describe('BackfillCommunicationsDialog', () => {
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

describe('BackfillCommunicationsDialog confirmation step', () => {
  it('requires a second explicit confirmation naming the count and window before calling onConfirm', async () => {
    const onConfirm = vi.fn();
    render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: /jane@clientco.com/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText(/12 months/i)).toBeInTheDocument();
    expect(screen.getByText(/1 contact/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /start backfill/i }));
    expect(onConfirm).toHaveBeenCalledWith([{ email: 'jane@clientco.com', name: 'Jane' }]);
  });
});

describe('BackfillCommunicationsDialog discovery dead-end states', () => {
  it('shows a retry affordance and the job error when the discovery job fails', async () => {
    vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'scanning' });
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb({ status: 'failed', error: 'Gmail account is no longer connected' });
      return () => {};
    });

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

    await waitFor(() => expect(screen.getByText(/gmail account is no longer connected/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // Never resolves to the contact picker.
    expect(screen.queryByText(/jane@clientco.com/i)).not.toBeInTheDocument();
  });

  it('shows a retry affordance when the job doc is missing (null)', async () => {
    vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'scanning' });
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb(null);
      return () => {};
    });

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

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
  });

  it('retry calls startContactDiscovery again and can recover to the picker', async () => {
    vi.mocked(startContactDiscovery)
      .mockResolvedValueOnce({ status: 'scanning' })
      .mockResolvedValueOnce({ status: 'ready' });
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb({ status: 'failed', error: 'transient error' });
      return () => {};
    });

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

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    expect(startContactDiscovery).toHaveBeenCalledTimes(2);
  });

  it('loads the directory immediately when startContactDiscovery short-circuits to ready, without waiting on a stale job doc', async () => {
    vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'ready' });
    // A stale job doc from a previous run sitting at 'failed' must not be
    // able to get in the way — the dialog must not even subscribe to it.
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb({ status: 'failed', error: 'stale failure from a previous run' });
      return () => {};
    });

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
    expect(subscribeToContactDiscoveryJob).not.toHaveBeenCalled();
    expect(getGmailContactDirectory).toHaveBeenCalled();
  });
});

describe('BackfillCommunicationsDialog discovery progress', () => {
  it('shows a "~" prefixed total while the count-only pass is still running', async () => {
    vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'scanning' });
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb({ status: 'scanning', processedCount: 150, totalMessageCount: 2000, countComplete: false, contactCount: 42 });
      return () => {};
    });

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

    await waitFor(() => expect(screen.getByText(/scanned 150 of ~2000 messages/i)).toBeInTheDocument());
    expect(screen.getByText(/42 contacts found so far/i)).toBeInTheDocument();
  });

  it('drops the "~" once the count-only pass completes, showing an exact total', async () => {
    vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'scanning' });
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb({ status: 'scanning', processedCount: 300, totalMessageCount: 11412, countComplete: true, contactCount: 533 });
      return () => {};
    });

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

    await waitFor(() => expect(screen.getByText(/scanned 300 of 11412 messages/i)).toBeInTheDocument());
    expect(screen.queryByText(/of ~11412/i)).not.toBeInTheDocument();
    expect(screen.getByText(/533 contacts found so far/i)).toBeInTheDocument();
  });

  it('hides the total entirely once processedCount has caught up to it (a live inbox growing the total)', async () => {
    vi.mocked(startContactDiscovery).mockResolvedValue({ status: 'scanning' });
    vi.mocked(subscribeToContactDiscoveryJob).mockImplementation((_uid, cb) => {
      cb({ status: 'scanning', processedCount: 300, totalMessageCount: 201, countComplete: true, contactCount: 533 });
      return () => {};
    });

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

    await waitFor(() => expect(screen.getByText(/scanned 300 messages/i)).toBeInTheDocument());
    expect(screen.queryByText(/of 201/i)).not.toBeInTheDocument();
    expect(screen.getByText(/533 contacts found so far/i)).toBeInTheDocument();
  });
});

describe('BackfillCommunicationsDialog starting-state reset', () => {
  it('resets the disabled Start backfill button after the dialog is closed and reopened', async () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: /jane@clientco.com/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await userEvent.click(screen.getByRole('button', { name: /start backfill/i }));
    expect(screen.getByRole('button', { name: /start backfill/i })).toBeDisabled();

    rerender(
      <BackfillCommunicationsDialog
        open={false}
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={onConfirm}
      />
    );
    rerender(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={onConfirm}
      />
    );

    // The `selected` set isn't reset on reopen (out of scope for this fix —
    // only `starting` is), so jane is still checked from before; no need to
    // click the checkbox again.
    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /jane@clientco.com/i })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('button', { name: /start backfill/i })).not.toBeDisabled();
  });
});
