import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import TimeEntryTab from "@/components/TimeTracking/TimeEntryTab";
import Sidebar from '@/components/Sidebar';

const TimeTracking = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('project');
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string } | null>(null);

  useEffect(() => {
    const fetchProject = async () => {
      if (projectIdParam) {
        const projectRef = doc(db, 'projects', projectIdParam);
        const projectSnap = await getDoc(projectRef);
        if (projectSnap.exists()) {
          const data = projectSnap.data();
          setProjectDetails({
            projectName: data.projectName || '',
            projectId: data.projectId || '',
            clientName: data.clientName || '',
          });
        }
      }
    };
    fetchProject();
  }, [projectIdParam]);

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className={`flex-1 flex flex-col ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <main className="flex-1 p-6">
          <div className="max-w-7xl mx-auto">
            {/* Project Header */}
            <div className="rounded-2xl shadow-lg bg-blue-900 text-white p-8 mb-2 border border-blue-200">
              <h1 className="text-3xl font-bold mb-1">
                {projectDetails ? `${projectDetails.projectName} - Timesheet` : 'Employee Timesheet'}
              </h1>
              <div className="text-lg opacity-90 mb-2">
                {projectDetails ? projectDetails.projectId : ''}
              </div>
              <div className="flex flex-wrap gap-6 mt-2">
                <div className="flex items-center gap-2 text-base opacity-90">
                  <span role="img" aria-label="company">🏢</span> {projectDetails ? projectDetails.clientName : ''}
                </div>
                <div className="flex items-center gap-2 text-base opacity-90">
                  <span role="img" aria-label="calendar">📅</span> Started: July 1, 2025
                </div>
                <div className="flex items-center gap-2 text-base opacity-90">
                  <span role="img" aria-label="team">👥</span> 5 Team Members
                </div>
              </div>
            </div>
            <TimeEntryTab />
          </div>
        </main>
      </div>
    </div>
  );
};

export default TimeTracking;