import { useEffect, useState } from "react";
import { Search, Plus, Filter, Grid, List, Download, Calendar, User, FileText, Edit, X } from "lucide-react";
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
import EditProjectDialog from "@/components/Project/EditProjectDialog";
import DeleteProjectDialog from "@/components/Project/DeleteProjectDialog";
import { addProject, subscribeToProjects, updateProject, deleteProject, Project as FirestoreProject } from "@/utils/projectFirestore";

const Projects = () => {
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddProjectDialogOpen, setIsAddProjectDialogOpen] = useState(false);
  const [isEditProjectDialogOpen, setIsEditProjectDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [projects, setProjects] = useState<FirestoreProject[]>([]);

  useEffect(() => {
    // Subscribe to Firestore projects
    const unsubscribe = subscribeToProjects((fetchedProjects) => {
      setProjects(fetchedProjects);
    });
    return () => unsubscribe();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Ongoing":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🟢 Ongoing</Badge>;
      case "Delayed":
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Delayed</Badge>;
      case "Completed":
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">✅ Completed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleAddProject = async (newProject: any) => {
    // Map dialog fields to Firestore schema
    const project: FirestoreProject = {
      projectId: newProject.id,
      projectName: newProject.name,
      clientName: newProject.client,
      description: newProject.description,
      status: mapStatusToFirestore(newProject.status),
      deadline: newProject.deadline,
    };
    await addProject(project);
  };

  const handleUpdateProject = async (updatedProject: any) => {
    const projectId = updatedProject.projectId;
    const updates: Partial<FirestoreProject> = {
      projectName: updatedProject.projectName,
      clientName: updatedProject.clientName,
      description: updatedProject.description,
      status: mapStatusToFirestore(updatedProject.status),
      deadline: updatedProject.deadline,
    };
    await updateProject(projectId, updates);
  };

  const handleDeleteProject = async () => {
    if (selectedProject) {
      await deleteProject(selectedProject.projectId);
      setIsDeleteDialogOpen(false);
      setSelectedProject(null);
    }
  };

  const handleEditClick = (project: any) => {
    setSelectedProject(project);
    setIsEditProjectDialogOpen(true);
  };

  const handleDeleteClick = (project: any) => {
    setSelectedProject(project);
    setIsDeleteDialogOpen(true);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const filteredProjects = projects.filter(project => {
    const matchesSearch =
      (project.projectName ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (project.clientName ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (project.projectId ?? "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesClient = clientFilter === "all" || project.clientName === clientFilter;
    const matchesStatus = statusFilter === "all" || project.status === statusFilter;
    return matchesSearch && matchesClient && matchesStatus;
  });

  const uniqueClients = [...new Set(projects.map(p => p.clientName))];

  const ProjectCard = ({ project }: { project: any }) => (
    <Card className="hover:shadow-lg transition-shadow duration-200 relative group">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity !bg-transparent hover:!bg-transparent focus:!bg-transparent"
        onClick={() => handleDeleteClick(project)}
      >
        <X className="h-3 w-3 text-red-500" strokeWidth={1.5}/>
      </Button>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg font-semibold">{project.projectName}</CardTitle>
          <div className="flex items-center gap-2">
            {getStatusBadge(project.status)}
            <Button variant="ghost" size="sm" onClick={() => handleEditClick(project)}>
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">ID:</span>
          <span className="text-muted-foreground">{project.projectId}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Client:</span>
          <span className="text-muted-foreground">{project.clientName}</span>
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
            <Link to={`/bom?project=${project.projectId}`}>
              🔧 BOM
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/time-tracking?project=${project.projectId}`}>
              ⏱️ Time
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/cost-analysis?project=${project.projectId}`}>
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
                <h1 className="text-3xl font-bold">Projects</h1>
                <span className="text-muted-foreground">({filteredProjects.length} projects)</span>
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
                <Button onClick={() => setIsAddProjectDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Project
                </Button>
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
                    <SelectItem value="Ongoing">Ongoing</SelectItem>
                    <SelectItem value="Delayed">Delayed</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
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
                <ProjectCard key={project.projectId} project={project} />
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
                    <TableRow key={project.projectId} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <div className="font-medium">{project.projectName}</div>
                          <div className="text-sm text-muted-foreground">{project.description}</div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">{project.projectId}</TableCell>
                      <TableCell>{project.clientName}</TableCell>
                      <TableCell>{formatDate(project.deadline)}</TableCell>
                      <TableCell>{getStatusBadge(project.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/bom?project=${project.projectId}`}>🔧</Link>
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/time-tracking?project=${project.projectId}`}>⏱️</Link>
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/cost-analysis?project=${project.projectId}`}>💰</Link>
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
      <EditProjectDialog
        open={isEditProjectDialogOpen}
        onOpenChange={setIsEditProjectDialogOpen}
        onUpdateProject={handleUpdateProject}
        project={selectedProject}
      />
      <DeleteProjectDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDeleteProject}
        projectName={selectedProject?.projectName || ""}
      />
    </div>
  );
};

// Helper to map UI status to Firestore status
function mapStatusToFirestore(status: string): FirestoreProject["status"] {
  if (status === "ongoing") return "Ongoing";
  if (status === "delayed") return "Delayed";
  if (status === "completed") return "Completed";
  return "Ongoing";
}

export default Projects;