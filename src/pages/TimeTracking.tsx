import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";
import { db } from "@/firebase";
import TimeEntryTab from "@/components/TimeTracking/TimeEntryTab";
import Sidebar from '@/components/Sidebar';
import { Week, addWeek } from "@/utils/timeTrackingFirestore";

interface ProjectDetails {
  projectName: string;
  projectId: string;
  clientName: string;
  startDate?: Date;
}

const TimeTracking = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    const initializeProject = async () => {
      if (!projectId) return;

      try {
        setIsInitializing(true);
        const projectRef = doc(db, 'projects', projectId);
        const projectSnap = await getDoc(projectRef);

        if (projectSnap.exists()) {
          const data = projectSnap.data();
          setProjectDetails({
            projectName: data.projectName || '',
            projectId: data.projectId || '',
            clientName: data.clientName || '',
          });

          // Check if time tracking is initialized
          const weeksRef = collection(db, 'projects', projectId, 'weeks');
          const weeksSnap = await getDoc(doc(weeksRef, 'week1'));

          if (!weeksSnap.exists()) {
            // Initialize first 4 weeks
            const today = new Date();
            const projectStartDate = data.startDate?.toDate() || today;
            
            for (let i = 0; i < 4; i++) {
              const weekStart = new Date(projectStartDate);
              weekStart.setDate(projectStartDate.getDate() + i * 7);
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekStart.getDate() + 6);

              const weekNum = i + 1;
              const week: Week = {
                key: `week${weekNum}`,
                label: `Week ${weekNum}`,
                dates: `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                status: i === 0 ? 'current' : 'future',
                startDate: weekStart,
                endDate: weekEnd
              };

              await addWeek(projectId, week);
            }
          }
        }
      } catch (error) {
        console.error('Error initializing project:', error);
        // TODO: Show error toast
      } finally {
        setIsInitializing(false);
      }
    };

    initializeProject();
  }, [projectId]);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-background flex">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div className={`flex-1 flex flex-col ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
          <main className="flex-1 p-6">
            <div className="max-w-7xl mx-auto text-center">
              <div className="animate-pulse">Initializing time tracking...</div>
            </div>
          </main>
        </div>
      </div>
    );
  }

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
                  <span role="img" aria-label="calendar">📅</span> Started: {projectDetails?.startDate?.toLocaleDateString() || 'Not set'}
                </div>
                <div className="flex items-center gap-2 text-base opacity-90">
                  <span role="img" aria-label="team">👥</span> Team Members
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