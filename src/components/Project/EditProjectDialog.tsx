
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateProject: (project: any) => void;
  project: any | null;
}

const EditProjectDialog = ({ open, onOpenChange, onUpdateProject, project }: EditProjectDialogProps) => {
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");
  const [deadline, setDeadline] = useState<Date | undefined>();

  useEffect(() => {
    if (project) {
      setProjectName(project.name);
      setProjectId(project.id);
      setDescription(project.description);
      setClientName(project.client);
      if (project.deadline) {
        setDeadline(parseISO(project.deadline));
      }
    }
  }, [project]);

  const handleSubmit = () => {
    if (!projectName || !projectId || !clientName || !deadline) {
      alert("Please fill all required fields.");
      return;
    }
    onUpdateProject({
      ...project,
      id: projectId,
      name: projectName,
      client: clientName,
      deadline: format(deadline, "yyyy-MM-dd"),
      description,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="editProjectName">Project Name</Label>
            <Input id="editProjectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Enter Project Name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="editProjectId">Project ID</Label>
            <Input id="editProjectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Enter ID" disabled />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="editDescription">Description</Label>
            <Textarea id="editDescription" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Enter Description" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="editClientName">Client Name</Label>
            <Input id="editClientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Enter Client Name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="editDeadline">Deadline</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !deadline && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {deadline ? format(deadline, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={deadline}
                  onSelect={setDeadline}
                  initialFocus
                  disabled={(date) => date < new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" onClick={handleSubmit}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectDialog; 