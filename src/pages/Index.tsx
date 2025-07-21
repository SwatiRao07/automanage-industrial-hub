
import { useState } from 'react';
import { 
  DollarSign, 
  FolderOpen, 
  Package, 
  TrendingUp,
  Clock,
  ShoppingCart
} from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import DashboardHeader from '@/components/DashboardHeader';
import MetricCard from '@/components/MetricCard';
import ProjectCard from '@/components/ProjectCard';
import RecentActivity from '@/components/RecentActivity';

const Index = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const mockProjects = [
    {
      id: '1',
      name: 'Vision System Alpha',
      client: 'Manufacturing Corp',
      status: 'active' as const,
      progress: 75,
      budget: 250000,
      spent: 187500,
      dueDate: 'Mar 15, 2024',
      teamSize: 5,
      materialsCount: 23
    },
    {
      id: '2',
      name: 'Automation Line Beta',
      client: 'Tech Industries',
      status: 'planning' as const,
      progress: 25,
      budget: 180000,
      spent: 45000,
      dueDate: 'Apr 20, 2024',
      teamSize: 3,
      materialsCount: 18
    },
    {
      id: '3',
      name: 'Quality Control Gamma',
      client: 'Precision Ltd',
      status: 'delayed' as const,
      progress: 60,
      budget: 120000,
      spent: 95000,
      dueDate: 'Feb 28, 2024',
      teamSize: 4,
      materialsCount: 15
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <div className={`flex-1 flex flex-col ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <DashboardHeader />
        
        <main className="flex-1 p-6">
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <MetricCard
              title="Total Revenue"
              value="$2.4M"
              change="+12.5% from last month"
              changeType="positive"
              icon={DollarSign}
              color="green"
            />
            <MetricCard
              title="Active Projects"
              value="12"
              change="3 starting this week"
              changeType="positive"
              icon={FolderOpen}
              color="blue"
            />
            <MetricCard
              title="Pending Orders"
              value="24"
              change="5 urgent deliveries"
              changeType="neutral"
              icon={ShoppingCart}
              color="amber"
            />
            <MetricCard
              title="Profit Margin"
              value="28.4%"
              change="+2.1% improvement"
              changeType="positive"
              icon={TrendingUp}
              color="green"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Projects Section */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Active Projects</h2>
                <button className="text-blue-600 hover:text-blue-700 font-medium">
                  View All Projects
                </button>
              </div>
              
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {mockProjects.map((project) => (
                  <ProjectCard key={project.id} {...project} />
                ))}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="lg:col-span-1">
              <RecentActivity />
            </div>
          </div>

          {/* Additional Statistics */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Engineering Hours</h3>
                <Clock className="text-blue-500" size={24} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">This Week</span>
                  <span className="font-medium">248 hrs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Billable</span>
                  <span className="font-medium text-green-600">92%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg. Cost/Hour</span>
                  <span className="font-medium">$85</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Inventory Status</h3>
                <Package className="text-amber-500" size={24} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Items</span>
                  <span className="font-medium">1,247</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Low Stock</span>
                  <span className="font-medium text-amber-600">23</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Value</span>
                  <span className="font-medium">$485K</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Purchase Orders</h3>
                <ShoppingCart className="text-purple-500" size={24} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">This Month</span>
                  <span className="font-medium">42</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Pending</span>
                  <span className="font-medium text-orange-600">8</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Value</span>
                  <span className="font-medium">$125K</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Index;
