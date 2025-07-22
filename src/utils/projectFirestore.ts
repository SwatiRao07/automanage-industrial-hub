import { db } from "@/firebase";
import {
  collection,
  addDoc,
  setDoc,
  doc,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  DocumentData,
  Unsubscribe
} from "firebase/firestore";

export interface Project {
  projectId: string;
  projectName: string;
  clientName: string;
  description: string;
  status: "Ongoing" | "Delayed" | "Completed";
  deadline: string; // ISO string
}

const projectsCol = collection(db, "projects");

// Add a new project (projectId as document ID)
export const addProject = async (project: Project) => {
  await setDoc(doc(projectsCol, project.projectId), project);
};

// Get all projects (real-time listener)
export const subscribeToProjects = (
  callback: (projects: Project[]) => void
): Unsubscribe => {
  const q = query(projectsCol);
  return onSnapshot(q, (snapshot) => {
    const projects: Project[] = snapshot.docs.map((doc) => doc.data() as Project);
    callback(projects);
  });
};

// Update a project
export const updateProject = async (projectId: string, updates: Partial<Project>) => {
  await updateDoc(doc(projectsCol, projectId), updates);
};

// Delete a project
export const deleteProject = async (projectId: string) => {
  await deleteDoc(doc(projectsCol, projectId));
}; 