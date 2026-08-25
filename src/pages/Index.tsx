import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Package,
  Clock,
  Users,
  AlertTriangle,
  CheckCircle,
  Activity,
  BarChart3,
  Calendar,
  FileText,
  Receipt,
  UserCheck,
  ShoppingCart,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/firebase";
import { getBOMData, type ProjectMember } from "@/utils/projectFirestore";
import { getProjectCosts } from "@/utils/pulseProxyFirestore";
import { computeDashboardCostTotals, type DashboardCostTotals } from "@/utils/dashboardCostTotals";
import { extractPendingClaims, type PendingClaimsSummary, type ProjectVisits } from "@/utils/pendingApprovals";
import { extractPendingPOApprovals, type PendingPOApprovalsSummary, type ProjectPOs } from "@/utils/pendingPOApprovals";
import { getOverheads } from "@/utils/overheadFirestore";
import { getPurchaseOrders } from "@/utils/poFirestore";
import { weekRangeFromDate } from "@/components/CostAnalysis/WeekNavigator";
import { fetchPendingUsers } from "@/utils/userService";

const KPI = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [activeProjects, setActiveProjects] = useState(0);
  const [completedProjects, setCompletedProjects] = useState(0);
  const [overdueProjects, setOverdueProjects] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const [vendorCount, setVendorCount] = useState(0);
  const [dashboardCosts, setDashboardCosts] = useState<DashboardCostTotals>({
    totalMaterialCost: 0,
    totalTimeCost: 0,
    totalTimeHours: 0,
    totalCost: 0,
  });
  const [costsError, setCostsError] = useState<string | null>(null);
  const [pendingClaims, setPendingClaims] = useState<PendingClaimsSummary>({
    claims: [],
    count: 0,
    totalAmount: 0,
  });
  const [pendingPOApprovals, setPendingPOApprovals] = useState<PendingPOApprovalsSummary>({
    approvals: [],
    count: 0,
    totalAmount: 0,
  });
  const [pendingUsers, setPendingUsers] = useState<{ id?: string; uid?: string; email?: string; displayName?: string }[]>([]);

  useEffect(() => {
    const fetchKPIData = async () => {
      if (!user) return;

      try {
        // Fetch projects
        const projectsRef = collection(db, 'projects');
        const projectsQuery = query(projectsRef, orderBy('createdAt', 'desc'));
        const projectsSnapshot = await getDocs(projectsQuery);

        const projectsData = [];
        let totalBOMParts = 0;
        const projectVisits: ProjectVisits[] = [];
        const projectPOs: ProjectPOs[] = [];

        for (const projectDoc of projectsSnapshot.docs) {
          const projectData = { id: projectDoc.id, ...projectDoc.data() } as {
            id: string;
            projectName?: string;
            members?: ProjectMember[];
            [key: string]: unknown;
          };
          projectsData.push(projectData);

          // Get BOM data for part count
          try {
            const bomData = await getBOMData(projectDoc.id);
            bomData.forEach(category => {
              totalBOMParts += category.parts.length;
            });
          } catch (error) {
            console.log(`No BOM data for project ${projectDoc.id}`);
          }

          // Get overheads for pending expense-claim detection
          try {
            const overheads = await getOverheads(projectDoc.id);
            projectVisits.push({
              projectId: projectDoc.id,
              projectName: projectData.projectName || projectDoc.id,
              members: projectData.members ?? [],
              visits: overheads.travelVisits,
            });
          } catch (error) {
            console.log(`No overheads data for project ${projectDoc.id}`);
          }

          // Get purchase orders for pending-approval detection
          try {
            const purchaseOrders = await getPurchaseOrders(projectDoc.id);
            projectPOs.push({
              projectId: projectDoc.id,
              projectName: projectData.projectName || projectDoc.id,
              purchaseOrders,
            });
          } catch (error) {
            console.log(`No purchase orders for project ${projectDoc.id}`);
          }
        }

        setProjects(projectsData);
        setTotalProjects(projectsData.length);
        setActiveProjects(projectsData.filter(p => p.status === 'Ongoing').length);
        setCompletedProjects(projectsData.filter(p => p.status === 'Completed').length);

        // Calculate overdue projects (simplified logic)
        const today = new Date();
        const overdue = projectsData.filter(p => {
          if (p.status === 'Completed') return false;
          if (!p.deadline) return false;
          return new Date(p.deadline) < today;
        }).length;
        setOverdueProjects(overdue);

        // Calculate total budget
        const totalBudgetAmount = projectsData.reduce((sum, p) => sum + (p.estimatedBudget || 0), 0);
        setTotalBudget(totalBudgetAmount);
        setTotalParts(totalBOMParts);

        setPendingClaims(extractPendingClaims(projectVisits));
        setPendingPOApprovals(extractPendingPOApprovals(projectPOs));

        // Fetch vendor count
        const vendorsRef = collection(db, 'vendors');
        const vendorsSnapshot = await getDocs(vendorsRef);
        setVendorCount(vendorsSnapshot.size);

        // Real hours/cost data from Pulse (via getProjectCosts roll-up)
        try {
          const range = weekRangeFromDate(new Date());
          const costsRes = await getProjectCosts(range.start, range.end);
          setDashboardCosts(computeDashboardCostTotals(costsRes.projects));
          setCostsError(null);
        } catch (error) {
          console.error('Error fetching project costs from Pulse:', error);
          setCostsError('Could not load hours/cost data from Pulse.');
        }

        // Pending user account approvals
        try {
          const pendingRes = await fetchPendingUsers() as { users: { id?: string; uid?: string; email?: string; displayName?: string }[] };
          setPendingUsers(pendingRes.users ?? []);
        } catch (error) {
          console.error('Error fetching pending users:', error);
        }

      } catch (error) {
        console.error('Error fetching KPI data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchKPIData();
  }, [user]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  };

  // Check admin access
  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You need admin privileges to access the KPI dashboard.</p>
            <Button 
              onClick={() => navigate('/projects')} 
              className="mt-4"
              variant="outline"
            >
              Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Activity className="h-12 w-12 text-blue-500 mx-auto mb-4 animate-pulse" />
            <p className="text-gray-600">Loading KPI data...</p>
          </div>
        </div>
      </div>
    );
  }

  // Chart data
  const projectStatusData = [
    { name: 'Active', value: activeProjects, color: '#10B981' },
    { name: 'Completed', value: completedProjects, color: '#3B82F6' },
    { name: 'Overdue', value: overdueProjects, color: '#EF4444' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">KPI Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                Real-time project metrics and business intelligence
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/projects')}>
                <FileText className="h-4 w-4 mr-2" />
                View Projects
              </Button>
              <Button variant="outline" onClick={() => navigate('/cost-analysis')}>
                <DollarSign className="h-4 w-4 mr-2" />
                Cost Analysis
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Total Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalProjects}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeProjects} active, {completedProjects} completed
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Total Budget
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCurrency(totalBudget)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(dashboardCosts.totalCost)} spent
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{Math.round(dashboardCosts.totalTimeHours).toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {costsError ? costsError : 'Logged in Pulse, all projects'}
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" />
                Total Parts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalParts}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all BOMs
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Project Status Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Project Status Distribution
              </CardTitle>
              <CardDescription>
                Current status of all projects
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={projectStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {projectStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Needs Attention
              </CardTitle>
              <CardDescription>
                Items waiting on your approval
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingClaims.count === 0 && pendingPOApprovals.count === 0 && pendingUsers.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  All caught up
                </div>
              ) : (
                <>
                  {pendingClaims.count > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Receipt className="h-4 w-4 text-amber-600" />
                          Pending Expense Claims
                        </div>
                        <Badge variant="outline" className="bg-amber-50 text-amber-700">
                          {pendingClaims.count} · {formatCurrency(pendingClaims.totalAmount)}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {pendingClaims.claims.map(claim => (
                          <button
                            key={claim.visitId}
                            onClick={() => navigate(`/project/${claim.projectId}/bom`)}
                            className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-muted/50 text-left"
                          >
                            <span className="truncate">{claim.projectName} — {claim.claimantName}</span>
                            <span className="font-medium ml-2 shrink-0">{formatCurrency(claim.amount)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {pendingPOApprovals.count > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ShoppingCart className="h-4 w-4 text-amber-600" />
                          POs Pending Approval
                        </div>
                        <Badge variant="outline" className="bg-amber-50 text-amber-700">
                          {pendingPOApprovals.count} · {formatCurrency(pendingPOApprovals.totalAmount)}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {pendingPOApprovals.approvals.map(approval => (
                          <button
                            key={approval.poId}
                            onClick={() => navigate(`/project/${approval.projectId}/bom`)}
                            className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-muted/50 text-left"
                          >
                            <span className="truncate">{approval.projectName} — {approval.poNumber} ({approval.vendorName})</span>
                            <span className="font-medium ml-2 shrink-0">{formatCurrency(approval.amount)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {pendingUsers.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <UserCheck className="h-4 w-4 text-blue-600" />
                          Pending User Approvals
                        </div>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700">
                          {pendingUsers.length}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {pendingUsers.map(u => (
                          <button
                            key={u.id ?? u.uid ?? u.email}
                            onClick={() => navigate('/settings')}
                            className="w-full flex items-center text-sm px-2 py-1.5 rounded hover:bg-muted/50 text-left truncate"
                          >
                            {u.displayName || u.email}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Productivity & Performance */}
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Project Health Summary
              </CardTitle>
              <CardDescription>
                Key performance indicators
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm">Projects On Time</span>
                </div>
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  {totalProjects > 0 ? Math.round(((totalProjects - overdueProjects) / totalProjects) * 100) : 0}%
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                  <span className="text-sm">Budget Utilization</span>
                </div>
                <Badge variant="outline" className="bg-blue-50 text-blue-700">
                  {totalBudget > 0 ? Math.round((dashboardCosts.totalCost / totalBudget) * 100) : 0}%
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-500" />
                  <span className="text-sm">Parts per Project</span>
                </div>
                <Badge variant="outline" className="bg-purple-50 text-purple-700">
                  {totalProjects > 0 ? Math.round(totalParts / totalProjects) : 0}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-orange-500" />
                  <span className="text-sm">Avg Hours per Project</span>
                </div>
                <Badge variant="outline" className="bg-orange-50 text-orange-700">
                  {totalProjects > 0 ? Math.round(dashboardCosts.totalTimeHours / totalProjects) : 0}h
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Navigate to key areas of the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button 
                variant="outline" 
                className="h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/projects')}
              >
                <FileText className="h-6 w-6" />
                <span>View Projects</span>
              </Button>
              
              <Button 
                variant="outline" 
                className="h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/cost-analysis')}
              >
                <DollarSign className="h-6 w-6" />
                <span>Cost Analysis</span>
              </Button>
              
              <Button 
                variant="outline" 
                className="h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/settings')}
              >
                <Users className="h-6 w-6" />
                <span>Manage Vendors</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default KPI;