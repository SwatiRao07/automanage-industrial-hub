import { useState } from "react";
import { Search, Plus, Filter, Grid, List, Download, Calendar, User, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table as TableComponent, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import Sidebar from "@/components/Sidebar";
import AddProjectDialog from "@/components/Project/AddProjectDialog";

const Projects = () => {
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddProjectDialogOpen, setIsAddProjectDialogOpen] = useState(false);

  // Mock project data
  const [projects, setProjects] = useState([
    {
      id: "PRJ-001",
      name: "Vision AI System",
      client: "ABC Corporation",
      deadline: "2025-08-25",
      status: "ongoing",
      description: "AI-powered computer vision system for manufacturing quality control"
    },
    {
      id: "PRJ-002", 
      name: "Smart HMI Interface",
      client: "XYZ Industries",
      deadline: "2025-09-12",
      status: "delayed",
      description: "Touch-based human machine interface for industrial automation"
    },
    {
      id: "PRJ-003",
      name: "IoT Sensor Network",
      client: "TechFlow Ltd",
      deadline: "2025-07-30",
      status: "completed",
      description: "Wireless sensor network for environmental monitoring"
    },
    {
      id: "PRJ-004",
      name: "Robotic Arm Controller",
      client: "AutoMech Corp",
      deadline: "2025-10-15",
      status: "ongoing",
      description: "Precision control system for 6-DOF robotic arm"
    }
  ]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ongoing":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🟢 Ongoing</Badge>;
      case "delayed":
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Delayed</Badge>;
      case "completed":
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">✅ Complete</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleAddProject = (newProject: any) => {
    setProjects([newProject, ...projects]);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = clientFilter === "all" || project.client === clientFilter;
    const matchesStatus = statusFilter === "all" || project.status === statusFilter;
    
    return matchesSearch && matchesClient && matchesStatus;
  });

  const uniqueClients = [...new Set(projects.map(p => p.client))];

  const ProjectCard = ({ project }: { project: any }) => (
    <Card className="hover:shadow-lg transition-shadow duration-200">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg font-semibold">{project.name}</CardTitle>
          {getStatusBadge(project.status)}
        </div>
        <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">ID:</span>
          <span className="text-muted-foreground">{project.id}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Client:</span>
          <span className="text-muted-foreground">{project.client}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Deadline:</span>
          <span className="text-muted-foreground">{formatDate(project.deadline)}</span>
        </div>

      </CardContent>
      
      <CardFooter className="pt-0">
        <div className="flex gap-2 w-full">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/bom?project=${project.id}`}>
              🔧 BOM
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/time-tracking?project=${project.id}`}>
              ⏱️ Time
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/cost-analysis?project=${project.id}`}>
              💰 Cost
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        {/* Header */}
        <div className="bg-card border-b">
          <div className="container mx-auto px-6 py-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">📘 Projects</h1>
                <span className="text-muted-foreground">({filteredProjects.length} projects)</span>
              </div>
              
              <div className="flex items-center gap-3">
                <Button onClick={() => setIsAddProjectDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Project
                </Button>
                <Button variant="outline" onClick={() => {}}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col gap-4 mt-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search projects..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="w-40">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by Client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Clients</SelectItem>
                    {uniqueClients.map(client => (
                      <SelectItem key={client} value={client}>{client}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="ongoing">Ongoing</SelectItem>
                    <SelectItem value="delayed">Delayed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>

                <Separator orientation="vertical" className="h-6" />

                <div className="flex rounded-lg border">
                  <Button
                    variant={viewMode === "cards" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("cards")}
                    className="rounded-r-none"
                  >
                    <Grid className="h-4 w-4 mr-2" />
                    Cards
                  </Button>
                  <Button
                    variant={viewMode === "table" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("table")}
                    className="rounded-l-none"
                  >
                    <List className="h-4 w-4 mr-2" />
                    Table
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-6 py-8">
          {viewMode === "cards" ? (
            /* Card View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            /* Table View */
            <Card>
              <TableComponent>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project Name</TableHead>
                    <TableHead>Project ID</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow key={project.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <div className="font-medium">{project.name}</div>
                          <div className="text-sm text-muted-foreground">{project.description}</div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">{project.id}</TableCell>
                      <TableCell>{project.client}</TableCell>
                      <TableCell>{formatDate(project.deadline)}</TableCell>
                      <TableCell>{getStatusBadge(project.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/bom?project=${project.id}`}>🔧</Link>
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/time-tracking?project=${project.id}`}>⏱️</Link>
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/cost-analysis?project=${project.id}`}>💰</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableComponent>
            </Card>
          )}

          {filteredProjects.length === 0 && (
            <div className="text-center py-12">
              <div className="text-muted-foreground text-lg">No projects found matching your criteria.</div>
              <Button className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create New Project
              </Button>
            </div>
          )}
        </div>
      </div>
      <AddProjectDialog
        open={isAddProjectDialogOpen}
        onOpenChange={setIsAddProjectDialogOpen}
        onAddProject={handleAddProject}
      />
    </div>
  );
};

export default Projects;