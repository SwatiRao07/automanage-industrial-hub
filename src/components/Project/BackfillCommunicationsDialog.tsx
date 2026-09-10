// src/components/Project/BackfillCommunicationsDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getGmailConnectionStatus } from '@/utils/emailFirestore';
import { getClient } from '@/utils/settingsFirestore';
import {
  startContactDiscovery,
  subscribeToContactDiscoveryJob,
  getGmailContactDirectory,
} from '@/utils/communicationsBackfillFirestore';
import { getClientDomains, groupContactsForPicker } from '@/utils/communicationsBackfill';
import type { ContactDiscoveryJobState, DiscoveredContact } from '@/types/communicationsBackfill';

interface BackfillCommunicationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientId?: string;
  alreadyBackfilledEmails: string[];
  onConfirm: (contacts: { email: string; name?: string }[]) => void;
}

type Phase = 'checking-connection' | 'not-connected' | 'discovering' | 'selecting' | 'confirming' | 'failed';

export function BackfillCommunicationsDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  alreadyBackfilledEmails,
  onConfirm,
}: BackfillCommunicationsDialogProps) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('checking-connection');
  const [clientDomains, setClientDomains] = useState<string[]>([]);
  const [contacts, setContacts] = useState<DiscoveredContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(alreadyBackfilledEmails));
  const [otherOpen, setOtherOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | undefined>(undefined);
  const [discoveryProgress, setDiscoveryProgress] = useState<ContactDiscoveryJobState | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const uid = user?.uid;

  useEffect(() => {
    if (!open || !uid) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const loadDirectory = async () => {
      const directory = await getGmailContactDirectory(uid);
      if (!cancelled) {
        setContacts(directory?.contacts || []);
        setPhase('selecting');
      }
    };

    // Kick off (or resume) discovery and drive the dialog off its outcome.
    // startContactDiscovery's own return value tells us the immediate next
    // step: 'ready' means a fresh directory already exists and the callable
    // short-circuited without touching the job doc at all, so we must not
    // wait on a job-doc transition (a stale 'failed' doc from a previous run
    // could sit there forever and get misread as this attempt failing).
    // Only when it returns 'scanning' do we subscribe to the job doc for
    // progress, and that subscription itself must treat both a 'failed'
    // status and a missing/deleted job doc as a dead end requiring retry
    // rather than a silent no-op (the forever-spinner this fixes).
    const runDiscovery = async () => {
      setPhase('discovering');
      setDiscoveryError(undefined);
      setDiscoveryProgress(null);
      const { status } = await startContactDiscovery();
      if (cancelled) return;
      if (status === 'ready') {
        await loadDirectory();
        return;
      }

      unsubscribe = subscribeToContactDiscoveryJob(uid, async (job) => {
        if (cancelled) return;
        if (job === null || job.status === 'failed') {
          setDiscoveryError(job?.error);
          setPhase('failed');
          return;
        }
        if (job.status === 'ready') {
          await loadDirectory();
          return;
        }
        // status === 'scanning': stay on the 'discovering' phase, more
        // progress updates will follow.
        setDiscoveryProgress(job);
      });
    };

    (async () => {
      setPhase('checking-connection');
      setStarting(false);
      const connection = await getGmailConnectionStatus();
      if (cancelled) return;
      if (!connection.connected || connection.status === 'needs_reconnect') {
        setPhase('not-connected');
        return;
      }

      if (clientId) {
        const client = await getClient(clientId);
        if (!cancelled) setClientDomains(getClientDomains(client));
      }
      if (cancelled) return;

      await runDiscovery();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [open, uid, clientId, retryToken]);

  const grouped = useMemo(() => groupContactsForPicker(contacts, clientDomains), [contacts, clientDomains]);

  const toggle = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const renderContactRow = (contact: DiscoveredContact) => (
    <label key={contact.email} className="flex items-center gap-2 py-1 text-sm">
      <Checkbox
        checked={selected.has(contact.email)}
        onCheckedChange={() => toggle(contact.email)}
        aria-label={contact.email}
      />
      <span className="font-medium">{contact.name || contact.email}</span>
      <span className="text-muted-foreground">{contact.email}</span>
      <span className="text-xs text-muted-foreground ml-auto">{contact.messageCount} messages</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Backfill Communications</DialogTitle>
        </DialogHeader>

        {phase === 'checking-connection' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your Gmail connection...
          </div>
        )}

        {phase === 'not-connected' && (
          <p className="text-sm text-muted-foreground py-6">
            Connect Gmail in Settings before backfilling communications for this project.
          </p>
        )}

        {phase === 'discovering' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>
              {discoveryProgress?.processedCount != null ? (
                <>
                  Scanned {discoveryProgress.processedCount}
                  {discoveryProgress.estimatedTotal ? ` of ~${discoveryProgress.estimatedTotal}` : ''} messages
                  {discoveryProgress.contactCount ? ` — ${discoveryProgress.contactCount} contacts found so far` : ''}
                </>
              ) : (
                'Scanning your mailbox for contacts (this can take a few minutes)...'
              )}
            </span>
          </div>
        )}

        {phase === 'selecting' && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <p className="text-sm font-medium mb-1">Matches this project's client</p>
              {grouped.matching.length > 0
                ? grouped.matching.map(renderContactRow)
                : <p className="text-sm text-muted-foreground">No contacts found on this client's domain.</p>}
            </div>
            <Collapsible open={otherOpen} onOpenChange={setOtherOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium">
                <ChevronDown className={`h-4 w-4 transition-transform ${otherOpen ? 'rotate-180' : ''}`} />
                Other domains
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 mt-2">
                {Object.entries(grouped.otherByDomain).map(([domain, domainContacts]) => (
                  <div key={domain}>
                    <p className="text-xs uppercase text-muted-foreground">{domain}</p>
                    {domainContacts.map(renderContactRow)}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {phase === 'confirming' && (
          <div className="py-4 space-y-2 text-sm">
            <p>
              This will search the last <strong>12 months</strong> of your mailbox for messages
              involving <strong>{selected.size} contact{selected.size === 1 ? '' : 's'}</strong> and
              import any matches into this project.
            </p>
            <p className="text-muted-foreground">This can't be easily undone.</p>
          </div>
        )}

        {phase === 'failed' && (
          <div className="py-6 space-y-2 text-sm">
            <p className="text-destructive">
              {discoveryError || "We couldn't scan your mailbox for contacts."}
            </p>
            <p className="text-muted-foreground">You can try again.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {phase === 'failed' && (
            <Button onClick={() => setRetryToken((t) => t + 1)}>Retry</Button>
          )}
          {phase === 'selecting' && (
            <Button disabled={selected.size === 0} onClick={() => setPhase('confirming')}>
              Continue ({selected.size} selected)
            </Button>
          )}
          {phase === 'confirming' && (
            <Button
              disabled={starting}
              onClick={() => {
                setStarting(true);
                const chosen = contacts
                  .filter((c) => selected.has(c.email))
                  .map((c) => ({ email: c.email, name: c.name || undefined }));
                onConfirm(chosen);
              }}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Start backfill
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
