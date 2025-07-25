
import { Calendar, User, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface BOMHeaderProps {
  projectName: string;
  projectId: string;
  clientName: string;
  stats: {
    totalParts: number;
    receivedParts: number;
    orderedParts: number;
    notOrderedParts: number;
    approvedParts: number;
  };
}

const BOMHeader = ({ projectName, projectId, clientName, stats }: BOMHeaderProps) => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              {projectName} - BOM
            </CardTitle>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <span className="font-medium">Project ID:</span>
                <Badge variant="outline">{projectId}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Building2 size={16} />
                <span>{clientName}</span>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.totalParts}</div>
            <div className="text-sm text-gray-600">Total Parts</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{stats.receivedParts}</div>
            <div className="text-sm text-gray-600">Received</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.orderedParts}</div>
            <div className="text-sm text-gray-600">Ordered</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-700">{stats.approvedParts}</div>
            <div className="text-sm text-gray-600">Approved</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{stats.notOrderedParts}</div>
            <div className="text-sm text-gray-600">Not Ordered</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BOMHeader;
