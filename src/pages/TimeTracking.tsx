import { useState } from "react";
import TimeEntryTab from "@/components/TimeTracking/TimeEntryTab";
import Sidebar from '@/components/Sidebar';

const TimeTracking = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className={`flex-1 flex flex-col ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <main className="flex-1 p-6">
          <div className="max-w-7xl mx-auto">
            <TimeEntryTab />
          </div>
        </main>
      </div>
    </div>
  );
};

export default TimeTracking;