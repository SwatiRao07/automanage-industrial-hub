import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Filter, Grid, List, Calendar, User, FileText, Edit, Archive, Wrench, ClipboardList, Target, Headphones } from "lucide-react";
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
import { addProject, subscribeToProjects, updateProject, archiveProject, updateBOMData } from "@/utils/projectFirestore";
import { getTemplate, subscribeToClients, Client } from "@/utils/settingsFirestore";
import type { EditableProjectInput, FirestoreProject, NewProjectFormData, ProjectViewMode } from "@/types/project";
import type { BOMCategory, BOMItem } from "@/types/bom";
import { TranscriptPasteDialog } from "@/components/Transcripts";
import { useAuth } from "@/hooks/useAuth";
import { isInternalUser } from "@/utils/accessControl";

/** An Archived project stays hidden from the list unless it has an active support profile (still reachable via Support). */
export const isProjectVisibleInList = (project: Pick<FirestoreProject, 'status' | 'supportProfile'>): boolean => {
  return project.status !== 'Archived' || !!project.supportProfile;
};

const Projects = () => {
  const { user, isAdmin } = useAuth();
  const isPartner = !!user && !isAdmin && !isInternalUser(user.email ?? '');
  const [viewMode, setViewMode] = useState<ProjectViewMode>("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddProjectDialogOpen, setIsAddProjectDialogOpen] = useState(false);
  const [isEditProjectDialogOpen, setIsEditProjectDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [transcriptPasteOpen, setTranscriptPasteOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<FirestoreProject | null>(null);
  const [projects, setProjects] = useState<FirestoreProject[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    // Subscribe to Firestore projects (filtered by membership for non-admins).
    // Re-run when auth state changes so the query gets the correct membership filter.
    const unsubscribeProjects = subscribeToProjects(
      (fetchedProjects) => { setProjects(fetchedProjects); },
      user ? { uid: user.uid, isAdmin } : undefined
    );
    // Subscribe to clients to get logos
    const unsubscribeClients = subscribeToClients((fetchedClients) => {
      setClients(fetchedClients);
    });
    return () => {
      unsubscribeProjects();
      unsubscribeClients();
    };
  }, [user?.uid, isAdmin]);

  // Get client logo by company name
  const getClientLogo = (clientName: string): string | undefined => {
    const client = clients.find(c => c.company === clientName);
    return client?.logo;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Planning":
        return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">📋 Planning</Badge>;
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

  const handleAddProject = async (newProject: NewProjectFormData, templateId?: string) => {
    // Map dialog fields to Firestore schema
    const project: FirestoreProject = {
      projectId: newProject.id,
      projectName: newProject.name,
      clientName: newProject.client,
      clientId: newProject.clientId,
      billingEntityId: newProject.billingEntityId,
      description: newProject.description,
      status: newProject.status,
      deadline: newProject.deadline,
      poValue: newProject.poValue,
    };
    await addProject(
      project,
      user ? { uid: user.uid, email: user.email || '', displayName: user.displayName || '' } : undefined
    );

    // If a template is selected, apply it to the BOM
    if (templateId) {
      try {
        const template = await getTemplate(templateId);
        if (template && template.items.length > 0) {
          // Group template items by category
          const categoryMap = new Map<string, BOMItem[]>();

          template.items.forEach((templateItem) => {
            const bomItem: BOMItem = {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              itemType: templateItem.itemType,
              name: templateItem.name,
              description: templateItem.description,
              category: templateItem.category,
              quantity: templateItem.quantity,
              price: templateItem.price,
              make: templateItem.make,
              sku: templateItem.sku,
              status: 'not-ordered',
              vendors: [],
            };

            const existingItems = categoryMap.get(templateItem.category) || [];
            existingItems.push(bomItem);
            categoryMap.set(templateItem.category, existingItems);
          });

          // Convert to BOMCategory array
          const categories: BOMCategory[] = Array.from(categoryMap.entries()).map(
            ([name, items]) => ({
              name,
              items,
              isExpanded: true,
            })
          );

          // Save to Firestore
          await updateBOMData(newProject.id, categories);
        }
      } catch (error) {
        console.error('Error applying template:', error);
        // Project is still created, just without template items
      }
    }
  };

  const handleUpdateProject = async (updatedProject: EditableProjectInput) => {
    const { projectId, poValue, ...updates } = updatedProject;
    // Only include poValue if it's defined
    const projectUpdates = poValue !== undefined ? { ...updates, poValue } : updates;
    await updateProject(projectId, projectUpdates);
  };

  const handleArchiveProject = async () => {
    if (selectedProject) {
      await archiveProject(selectedProject.projectId);
      setIsDeleteDialogOpen(false);
      setSelectedProject(null);
    }
  };

  const handleEditClick = (project: FirestoreProject) => {
    setSelectedProject(project);
    setIsEditProjectDialogOpen(true);
  };

  const handleArchiveClick = (project: FirestoreProject) => {
    setSelectedProject(project);
    setIsDeleteDialogOpen(true);
  };

  const formatDate = (dateString: string) => {
    const safeDate = new Date(dateString);
    if (Number.isNaN(safeDate.getTime())) {
      return "No deadline";
    }
    return safeDate.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Derive the filtered list only when data or filters change.
  // Archived projects are hidden by default, unless they're now in Support.
  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().trim();
    return projects.filter((project) => {
      if (!isProjectVisibleInList(project)) return false;

      const projectName = project.projectName?.toLowerCase() ?? "";
      const clientName = project.clientName?.toLowerCase() ?? "";
      const projectId = project.projectId?.toLowerCase() ?? "";

      const matchesSearch =
        projectName.includes(normalizedQuery) ||
        clientName.includes(normalizedQuery) ||
        projectId.includes(normalizedQuery);

      const matchesClient = clientFilter === "all" || project.clientName === clientFilter;
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      return matchesSearch && matchesClient && matchesStatus;
    });
  }, [clientFilter, projects, searchQuery, statusFilter]);

  // Build a deduplicated, sanitized client list for the filter dropdown.
  const clientOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.clientName?.trim()))].filter(
        (client): client is string => Boolean(client && client.length)
      ),
    [projects]
  );

  const ProjectCard = ({ project }: { project: FirestoreProject }) => (
    <Card className="hover:shadow-lg transition-shadow duration-200 relative group overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-3 mb-2">
          <div className="flex-1 min-w-0 pr-2">
            <CardTitle className="text-lg font-semibold leading-tight mb-1 break-words">
              {project.projectName}
            </CardTitle>
            {project.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {project.description}
              </p>
            )}
          </div>
          {!isPartner && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEditClick(project)}
                className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleArchiveClick(project)}
                className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                title="Archive project"
              >
                <Archive className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center">
          {getStatusBadge(project.status)}
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">ID:</span>
          <span className="text-muted-foreground">{project.projectId}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          {getClientLogo(project.clientName) ? (
            <img
              src={getClientLogo(project.clientName)}
              alt={project.clientName}
              className="h-5 w-5 rounded object-contain"
            />
          ) : (
            <User className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">Client:</span>
          <span className="text-muted-foreground">{project.clientName}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Deadline:</span>
          <span className="text-muted-foreground">{formatDate(project.deadline)}</span>
        </div>
      </CardContent>
      
      <CardFooter className="pt-0 px-4 pb-4 overflow-hidden">
        <div className="flex gap-1.5 sm:gap-2 w-full min-w-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="flex-1 min-w-0 px-2 sm:px-3 overflow-hidden"
          >
            <Link to={`/project/${project.projectId}/bom`} className="flex items-center justify-center gap-1.5 sm:gap-2 min-w-0">
              <Wrench className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 text-purple-600" />
              <span className="hidden sm:inline text-xs sm:text-sm">BOM</span>
            </Link>
          </Button>
          {["Ongoing", "Completed"].includes(project.status) && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="flex-1 min-w-0 px-2 sm:px-3 overflow-hidden"
            >
              <Link to={`/support?project=${encodeURIComponent(project.projectId)}`} className="flex items-center justify-center gap-1.5 sm:gap-2 min-w-0">
                <Headphones className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 text-cyan-700" />
                <span className="hidden sm:inline text-xs sm:text-sm">Support</span>
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant="outline"
            size="sm"
            className="flex-1 min-w-0 px-2 sm:px-3 overflow-hidden"
          >
            <Link to={`/project/${project.projectId}/bom?tab=milestones`} className="flex items-center justify-center gap-1.5 sm:gap-2 min-w-0">
              <Target className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 text-blue-600" />
              <span className="hidden sm:inline text-xs sm:text-sm">Milestones</span>
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
                {(isAdmin || isInternalUser(user?.email ?? '')) && (
                  <Button onClick={() => setIsAddProjectDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Project
                  </Button>
                )}
                <Button variant="outline" onClick={() => setTranscriptPasteOpen(true)}>
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Paste Transcript
                </Button>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="w-40">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by Client" />
                  </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clientOptions.map((client) => (
                    <SelectItem key={client} value={client}>
                      {client}
                    </SelectItem>
                  ))}
                </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="Planning">Planning</SelectItem>
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
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getClientLogo(project.clientName) ? (
                            <img
                              src={getClientLogo(project.clientName)}
                              alt={project.clientName}
                              className="h-6 w-6 rounded object-contain"
                            />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground" />
                          )}
                          {project.clientName}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(project.deadline)}</TableCell>
                      <TableCell>{getStatusBadge(project.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <Button asChild variant="outline" size="sm" title="BOM">
                            <Link to={`/project/${project.projectId}/bom`}>
                              <Wrench className="h-4 w-4 text-purple-600" />
                            </Link>
                          </Button>
                          <Button asChild variant="outline" size="sm" title="Milestones">
                            <Link to={`/project/${project.projectId}/bom?tab=milestones`}>
                              <Target className="h-4 w-4 text-blue-600" />
                            </Link>
                          </Button>
                          {["Ongoing", "Completed"].includes(project.status) && (
                            <Button asChild variant="outline" size="sm" title="Support">
                              <Link to={`/support?project=${encodeURIComponent(project.projectId)}`}>
                                <Headphones className="h-4 w-4 text-cyan-700" />
                              </Link>
                            </Button>
                          )}
                          {!isPartner && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEditClick(project)}
                                title="Edit"
                                className="text-blue-600 hover:text-blue-700"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleArchiveClick(project)}
                                title="Archive"
                                className="text-amber-600 hover:text-amber-700"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            </>
                          )}
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
        onConfirm={handleArchiveProject}
        projectName={selectedProject?.projectName || ""}
      />
      <TranscriptPasteDialog
        open={transcriptPasteOpen}
        onOpenChange={setTranscriptPasteOpen}
        onSuccess={() => {
          console.log('Transcript activities saved successfully');
        }}
      />
    </div>
  );
};

export default Projects;
