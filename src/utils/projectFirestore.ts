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
  Unsubscribe,
  getDoc
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

// BOM Types
export interface BOMItem {
  id: string;
  name: string;
  partId: string;
  description: string;
  category: string;
  quantity: number;
  vendors: Array<{
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  }>;
  status: 'not-ordered' | 'ordered' | 'received' | 'approved';
  expectedDelivery?: string;
  poNumber?: string;
  finalizedVendor?: {
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  };
}

export interface BOMCategory {
  name: string;
  items: BOMItem[];
  isExpanded: boolean;
}

// BOM Functions
export const getBOMData = async (projectId: string) => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  const bomSnap = await getDoc(bomRef);
  if (bomSnap.exists()) {
    return bomSnap.data().categories as BOMCategory[];
  }
  return [];
};

export const subscribeToBOM = (projectId: string, callback: (categories: BOMCategory[]) => void) => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  return onSnapshot(bomRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data().categories as BOMCategory[]);
    } else {
      callback([]);
    }
  });
};

export const updateBOMData = async (projectId: string, categories: BOMCategory[]) => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  await setDoc(bomRef, { categories }, { merge: true });
};

export const updateBOMItem = async (projectId: string, categories: BOMCategory[], itemId: string, updates: Partial<BOMItem>) => {
  const updatedCategories = categories.map(category => ({
    ...category,
    items: category.items.map(item =>
      item.id === itemId ? { ...item, ...updates } : item
    )
  }));
  await updateBOMData(projectId, updatedCategories);
};

export const deleteBOMItem = async (projectId: string, categories: BOMCategory[], itemId: string) => {
  const updatedCategories = categories.map(category => ({
    ...category,
    items: category.items.filter(item => item.id !== itemId)
  }));
  await updateBOMData(projectId, updatedCategories);
}; 