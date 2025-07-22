
import { useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getDoc, doc } from "firebase/firestore";
import { db } from "@/firebase";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddProject: (project: any) => void;
}

const AddProjectDialog = ({ open, onOpenChange, onAddProject }: AddProjectDialogProps) => {
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");
  const [deadline, setDeadline] = useState<Date | undefined>();
  const [status, setStatus] = useState("Ongoing");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!projectName || !projectId || !clientName || !deadline) {
      setError("Please fill all required fields.");
      return;
    }
    // Check uniqueness of Project ID
    const projectRef = doc(db, "projects", projectId);
    const projectSnap = await getDoc(projectRef);
    if (projectSnap.exists()) {
      setError("Project ID already exists. Please choose a different ID.");
      return;
    }
    onAddProject({
      id: projectId,
      name: projectName,
      client: clientName,
      deadline: format(deadline, "yyyy-MM-dd"),
      status,
      description,
    });
    // Reset form
    setProjectName("");
    setProjectId("");
    setDescription("");
    setClientName("");
    setDeadline(undefined);
    setStatus("Ongoing");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {error && <div className="text-red-500 text-sm">{error}</div>}
          <div className="grid gap-2">
            <Label htmlFor="projectName">Project Name</Label>
            <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Enter Project Name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="projectId">Project ID</Label>
            <Input id="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Enter ID" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Enter Description" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="clientName">Client Name</Label>
            <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Enter Client Name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Ongoing">🟢 Ongoing</SelectItem>
                <SelectItem value="Delayed">🔴 Delayed</SelectItem>
                <SelectItem value="Completed">✅ Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="deadline">Deadline</Label>
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
            Add Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddProjectDialog; 