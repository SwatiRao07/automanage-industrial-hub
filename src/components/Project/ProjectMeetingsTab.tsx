import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Video, ExternalLink } from 'lucide-react';
import { subscribeToMeetings } from '@/utils/meetingFirestore';
import type { ProjectMeeting } from '@/types/meeting';

interface ProjectMeetingsTabProps {
  projectId: string;
}

export function ProjectMeetingsTab({ projectId }: ProjectMeetingsTabProps) {
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToMeetings(projectId, (m) => {
      setMeetings(m);
      setLoading(false);
    });
    return unsubscribe;
  }, [projectId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading meetings...</div>;
  }

  if (meetings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Video className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No meetings captured yet for this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {meetings.map((meeting) => (
        <Card key={meeting.id}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h4 className="font-medium truncate">{meeting.title || 'Untitled meeting'}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {meeting.startedAt.toLocaleString()}
                  {meeting.attendees.length > 0 && ' · '}
                  {meeting.attendees.map((a) => a.name || a.email).join(', ')}
                </p>
                {meeting.summary && (
                  <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{meeting.summary}</p>
                )}
              </div>
              {meeting.shareUrl && (
                <a
                  href={meeting.shareUrl}
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
      ))}
    </div>
  );
}
