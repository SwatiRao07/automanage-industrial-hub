// src/components/settings/GmailConnectionsTab.tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mail, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { connectGmailAccount, getGmailConnectionStatus, type GmailConnectionState } from '@/utils/emailFirestore';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export default function GmailConnectionsTab() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<GmailConnectionState>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      setConnection(await getGmailConnectionStatus());
    } catch (error) {
      console.error('Error loading Gmail connection status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) return;

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    setConnecting(true);
    connectGmailAccount(code, redirectUri)
      .then(({ email }) => {
        toast({ title: `Gmail connected: ${email}` });
        return loadStatus();
      })
      .catch((error) => {
        console.error('Error connecting Gmail:', error);
        toast({ title: 'Failed to connect Gmail', description: error.message, variant: 'destructive' });
      })
      .finally(() => {
        setConnecting(false);
        const next = new URLSearchParams(searchParams);
        next.delete('code');
        setSearchParams(next, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startConnect = () => {
    const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string;
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    window.location.href = url.toString();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Gmail Connection
        </CardTitle>
        <CardDescription>
          Connect your Gmail account so emails involving project stakeholders are captured automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || connecting ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {connecting ? 'Connecting Gmail...' : 'Loading connection status...'}
          </div>
        ) : connection.connected ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{connection.email}</p>
              {connection.status === 'needs_reconnect' ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 mt-1">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Needs reconnect
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-50 text-green-700 mt-1">Connected</Badge>
              )}
            </div>
            <Button variant="outline" onClick={startConnect}>
              {connection.status === 'needs_reconnect' ? 'Reconnect Gmail' : 'Reconnect'}
            </Button>
          </div>
        ) : (
          <Button onClick={startConnect}>Connect Gmail</Button>
        )}
      </CardContent>
    </Card>
  );
}
