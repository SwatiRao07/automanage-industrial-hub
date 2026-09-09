// src/components/Project/ProjectCommunicationsTab.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Video, Mail, ExternalLink } from 'lucide-react';
import { subscribeToMeetings } from '@/utils/meetingFirestore';
import { subscribeToEmails } from '@/utils/emailFirestore';
import { mergeCommunications } from '@/utils/communicationsMerge';
import type { ProjectMeeting } from '@/types/meeting';
import type { ProjectEmail } from '@/types/email';

interface ProjectCommunicationsTabProps {
  projectId: string;
}

export function ProjectCommunicationsTab({ projectId }: ProjectCommunicationsTabProps) {
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [emails, setEmails] = useState<ProjectEmail[]>([]);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);
  const [emailsLoaded, setEmailsLoaded] = useState(false);

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
    return () => {
      unsubscribeMeetings();
      unsubscribeEmails();
    };
  }, [projectId]);

  if (!meetingsLoaded || !emailsLoaded) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading communications...</div>;
  }

  const items = mergeCommunications(meetings, emails);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Video className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No meetings or emails captured yet for this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
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
                {item.meeting.shareUrl && (
                  <a
                    href={item.meeting.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    View recording <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card key={`email-${item.email.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <h4 className="font-medium truncate">{item.email.subject || '(no subject)'}</h4>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.email.sentAt.toLocaleString()} · {item.email.from.name || item.email.from.email} to{' '}
                {item.email.to.map((t) => t.name || t.email).join(', ')}
              </p>
              <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{item.email.body}</p>
            </CardContent>
          </Card>
        )
      ))}
    </div>
  );
}
