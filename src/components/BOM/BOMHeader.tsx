
import { Calendar, User, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface BOMHeaderProps {
  projectName: string;
  projectId: string;
  clientName: string;
}

const BOMHeader = ({ projectName, projectId, clientName }: BOMHeaderProps) => {
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">47</div>
            <div className="text-sm text-gray-600">Total Parts</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">23</div>
            <div className="text-sm text-gray-600">Received</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">15</div>
            <div className="text-sm text-gray-600">Ordered</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">9</div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BOMHeader;
