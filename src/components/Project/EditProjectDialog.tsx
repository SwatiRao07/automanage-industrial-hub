
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { getDoc, setDoc, doc, deleteDoc } from "firebase/firestore";
import { db } from "@/firebase";

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
  const [status, setStatus] = useState("Ongoing");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setProjectName(project.projectName || "");
      setProjectId(project.projectId || "");
      setDescription(project.description || "");
      setClientName(project.clientName || "");
      if (project.deadline) {
        setDeadline(parseISO(project.deadline));
      }
      setStatus(project.status || "Ongoing");
      setError(null);
    }
  }, [project]);

  const handleSubmit = async () => {
    setError(null);
    if (!projectName || !projectId || !clientName || !deadline) {
      setError("Please fill all required fields.");
      return;
    }
    const oldProjectId = project?.projectId;
    if (projectId !== oldProjectId) {
      // Check uniqueness for new Project ID
      const newDocRef = doc(db, "projects", projectId);
      const newDocSnap = await getDoc(newDocRef);
      if (newDocSnap.exists()) {
        setError("Project ID already exists. Please choose a different ID.");
        return;
      }
      // Copy data to new doc, delete old doc
      const updatedData = {
        projectId,
        projectName,
        clientName,
        description,
        status,
        deadline: format(deadline, "yyyy-MM-dd"),
      };
      await setDoc(newDocRef, updatedData);
      if (oldProjectId) {
        await deleteDoc(doc(db, "projects", oldProjectId));
      }
      onUpdateProject(updatedData);
      onOpenChange(false); // Only close on success
    } else {
      // Just update existing doc
      onUpdateProject({
        ...project,
        projectId,
        projectName,
        clientName,
        description,
        status,
        deadline: format(deadline, "yyyy-MM-dd"),
      });
      onOpenChange(false); // Only close on success
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        {error && <div className="text-red-500 text-sm mb-2">{error}</div>}
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="editProjectName">Project Name</Label>
            <Input id="editProjectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Enter Project Name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="editProjectId">Project ID</Label>
            <Input id="editProjectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Enter ID" />
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
            <Label htmlFor="editStatus">Status</Label>
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