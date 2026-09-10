// src/components/Project/ProjectCommunicationsTab.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Video, Mail, ExternalLink, Trash2, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { subscribeToMeetings, deleteProjectMeeting } from '@/utils/meetingFirestore';
import { subscribeToEmails, deleteProjectEmail } from '@/utils/emailFirestore';
import { mergeCommunications } from '@/utils/communicationsMerge';
import { addProjectBackfillStakeholders, subscribeToEmailBackfillJob } from '@/utils/communicationsBackfillFirestore';
import { BackfillCommunicationsDialog } from './BackfillCommunicationsDialog';
import type { ProjectMeeting } from '@/types/meeting';
import type { ProjectEmail } from '@/types/email';
import type { Project } from '@/utils/projectFirestore';
import type { EmailBackfillJobState } from '@/types/communicationsBackfill';

interface ProjectCommunicationsTabProps {
  projectId: string;
  project: Project;
  onProjectUpdated: (project: Project) => void;
}

export function ProjectCommunicationsTab({ projectId, project, onProjectUpdated }: ProjectCommunicationsTabProps) {
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [emails, setEmails] = useState<ProjectEmail[]>([]);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);
  const [emailsLoaded, setEmailsLoaded] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillJob, setBackfillJob] = useState<EmailBackfillJobState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'email' | 'meeting'; id: string } | null>(null);

  useEffect(() => {
    setMeetingsLoaded(false);
    setEmailsLoaded(false);
    const unsubscribeMeetings = subscribeToMeetings(projectId, (m) => {
      setMeetings(m);
      setMeetingsLoaded(true);
    });
    const unsubscribeEmails = subscribeToEmails(projectId, (e) => {
      setEmails(e);
      setEmailsLoaded(true);
    });
    const unsubscribeBackfillJob = subscribeToEmailBackfillJob(projectId, setBackfillJob);
    return () => {
      unsubscribeMeetings();
      unsubscribeEmails();
      unsubscribeBackfillJob();
    };
  }, [projectId]);

  const handleBackfillConfirm = async (contacts: { email: string; name?: string }[]) => {
    try {
      await addProjectBackfillStakeholders(projectId, contacts);
      onProjectUpdated({
        ...project,
        externalRecipients: [
          ...(project.externalRecipients || []),
          ...contacts
            .filter((c) => !(project.externalRecipients || []).some((r) => r.email.toLowerCase() === c.email))
            .map((c) => ({ email: c.email, name: c.name || '', notificationsEnabled: false })),
        ],
      });
      toast({ title: 'Backfill started', description: `Searching the last 12 months for ${contacts.length} contact(s).` });
    } catch (error) {
      toast({ title: 'Failed to start backfill', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBackfillOpen(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === 'email') {
        await deleteProjectEmail(projectId, pendingDelete.id);
      } else {
        await deleteProjectMeeting(projectId, pendingDelete.id);
      }
    } catch (error) {
      toast({ title: 'Failed to remove', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setPendingDelete(null);
    }
  };

  if (!meetingsLoaded || !emailsLoaded) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading communications...</div>;
  }

  const items = mergeCommunications(meetings, emails);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setBackfillOpen(true)}>
          <Users className="h-4 w-4 mr-2" /> Backfill Communications
        </Button>
        {backfillJob && backfillJob.status !== 'completed' && backfillJob.status !== 'failed' && (
          <p className="text-xs text-muted-foreground">
            Backfilling... {backfillJob.processedCount} messages scanned, {backfillJob.matchedCount} imported
          </p>
        )}
        {backfillJob && backfillJob.status === 'failed' && (
          <p className="text-xs text-destructive">Backfill failed: {backfillJob.error}</p>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Video className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No meetings or emails captured yet for this project.</p>
        </div>
      ) : (
        items.map((item) => (
          item.kind === 'meeting' ? (
            <Card key={`meeting-${item.meeting.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h4 className="font-medium truncate">{item.meeting.title || 'Untitled meeting'}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.meeting.startedAt.toLocaleString()}
                      {item.meeting.attendees.length > 0 && ' · '}
                      {item.meeting.attendees.map((a) => a.name || a.email).join(', ')}
                    </p>
                    {item.meeting.summary && (
                      <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{item.meeting.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.meeting.shareUrl && (
                      <a
                        href={item.meeting.shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        View recording <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingDelete({ kind: 'meeting', id: item.meeting.id })}
                      aria-label="Remove meeting"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card key={`email-${item.email.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h4 className="font-medium truncate">{item.email.subject || '(no subject)'}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.email.sentAt.toLocaleString()} · {item.email.from.name || item.email.from.email} to{' '}
                      {item.email.to.map((t) => t.name || t.email).join(', ')}
                    </p>
                    <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{item.email.body}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setPendingDelete({ kind: 'email', id: item.email.id })}
                    aria-label="Remove email"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        ))
      )}

      <BackfillCommunicationsDialog
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        projectId={projectId}
        clientId={project.clientId}
        alreadyBackfilledEmails={project.backfilledContactEmails || []}
        onConfirm={handleBackfillConfirm}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {pendingDelete?.kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from this project and won't be re-imported by future syncs or backfills.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
