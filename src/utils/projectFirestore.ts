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
  where,
  DocumentData,
  Unsubscribe,
  getDoc
} from "firebase/firestore";
import type { BOMItem, BOMCategory, BOMStatus } from "@/types/bom";
import { sanitizeBOMItemForFirestore } from "@/types/bom";
import type { SupportProjectProfile } from "@/types/support";

export type { BOMItem, BOMCategory, BOMStatus };

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  addedAt: string;      // ISO date YYYY-MM-DD
  addedBy: string;      // UID of admin who added them (or 'migration' / 'self')
  categoryScope?: string[]; // undefined = all categories (internal); [] = none; ['Mech'] = scoped
  notificationsEnabled?: boolean; // default true — receives BOM change emails
}

/** Email-only contact: not a registered app user, receives BOM notification emails only */
export interface ExternalRecipient {
  email: string;
  name: string;
  notificationsEnabled: boolean;
}

/** Resolved notification target used by Firebase functions and tests */
export interface NotificationRecipient {
  email: string;
  name: string;
}

export interface Project {
  projectId: string;
  projectName: string;
  clientName: string;
  clientId?: string;
  billingEntityId?: string;
  description: string;
  status: "Planning" | "Procurement" | "Ongoing" | "Delayed" | "Completed" | "Archived";
  deadline: string; // ISO string - treated as CURRENT deadline
  poValue?: number;          // Purchase Order value from customer
  internalBudget?: number;   // Internal cost budget for the project
  bomSnapshot?: any[]; // Snapshot of BOM when status changed to 'Ongoing' (order won)
  bomSnapshotDate?: string; // ISO string - when snapshot was taken
  archivedAt?: string; // ISO string - when project was archived

  // CRM Integration Fields
  sourceDealId?: string;           // Link back to originating deal (if converted from CRM)
  driveFolderUrl?: string;         // Google Drive folder (inherited from deal)

  // Pulse Integration (unified cost tracking)
  // Numeric Pulse SQLite project id. Stable across name changes.
  // When set, BOM Tracker pulls live time data from Pulse instead of
  // the manual engineers/weeks subcollection.
  pulseProjectId?: number;

  // CEO Dashboard Fields (Phase 2)
  category?: 'internal' | 'customer';  // Project classification
  projectOwnerId?: string;             // User ID of project owner
  kickoffDate?: string;                // ISO string - when project actually started

  // Baseline Tracking (Phase 2)
  originalDeadline?: string;           // Immutable once baselined
  isBaselined?: boolean;               // false until owner locks baseline
  baselinedAt?: string;                // ISO string - when baseline was locked
  baselinedBy?: string;                // User ID who locked the baseline

  // Membership — used in Firestore security rules and client queries
  memberIds?: string[];    // UIDs of all members (optional for backward compat during migration)
  members?: ProjectMember[]; // Full member records for UI display

  // Notification recipients who are not registered app users
  externalRecipients?: ExternalRecipient[];

  // Contacts already backfilled for this project (Communications Backfill) — see docs/superpowers/specs/2026-09-10-communications-backfill-design.md
  backfilledContactEmails?: string[];

  // Post-commissioning service and support configuration
  supportProfile?: SupportProjectProfile;
}

const projectsCol = collection(db, "projects");

// Add a new project (projectId as document ID)
export const addProject = async (
  project: Project,
  creator?: { uid: string; email: string; displayName: string }
) => {
  const today = new Date().toISOString().split('T')[0];
  const projectWithMembership: Project = creator
    ? {
        ...project,
        memberIds: [creator.uid],
        members: [{
          userId: creator.uid,
          email: creator.email,
          displayName: creator.displayName || creator.email,
          addedAt: today,
          addedBy: creator.uid,
          notificationsEnabled: true,
        }],
      }
    : project;

  const cleanProject = Object.fromEntries(
    Object.entries(projectWithMembership).filter(([_, value]) => value !== undefined)
  );
  await setDoc(doc(projectsCol, project.projectId), cleanProject);
};

// Get all projects (real-time listener)
export const subscribeToProjects = (
  callback: (projects: Project[]) => void,
  userInfo?: { uid: string; isAdmin: boolean }
): Unsubscribe => {
  const q =
    userInfo && !userInfo.isAdmin
      ? query(projectsCol, where('memberIds', 'array-contains', userInfo.uid))
      : query(projectsCol);
  return onSnapshot(q, (snapshot) => {
    const projects: Project[] = snapshot.docs.map((doc) => doc.data() as Project);
    callback(projects);
  });
};

// Get all projects (one-time fetch)
export const getProjects = async (
  userInfo?: { uid: string; isAdmin: boolean }
): Promise<(Project & { id: string })[]> => {
  const q =
    userInfo && !userInfo.isAdmin
      ? query(projectsCol, where('memberIds', 'array-contains', userInfo.uid))
      : query(projectsCol);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Project),
  }));
};

// Update a project
export const updateProject = async (projectId: string, updates: Partial<Project>) => {
  // Filter out undefined values to prevent Firestore errors
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, value]) => value !== undefined)
  );
  await updateDoc(doc(projectsCol, projectId), cleanUpdates);
};

// Archive a project (soft delete - sets status to Archived)
export const archiveProject = async (projectId: string) => {
  await updateDoc(doc(projectsCol, projectId), {
    status: "Archived",
    archivedAt: new Date().toISOString()
  });
};

// Restore an archived project
export const restoreProject = async (projectId: string, previousStatus: Project["status"] = "Planning") => {
  const cleanUpdates = {
    status: previousStatus === "Archived" ? "Planning" : previousStatus,
    archivedAt: null // Remove the archived timestamp
  };
  await updateDoc(doc(projectsCol, projectId), cleanUpdates);
};

// Lock baseline for a project (CEO Dashboard Phase 2)
// Once locked, originalDeadline becomes immutable and delay tracking is active
export const lockProjectBaseline = async (projectId: string, userId: string): Promise<void> => {
  const projectRef = doc(projectsCol, projectId);
  const projectSnap = await getDoc(projectRef);

  if (!projectSnap.exists()) {
    throw new Error('Project not found');
  }

  const project = projectSnap.data() as Project;

  if (project.isBaselined) {
    throw new Error('Project baseline is already locked');
  }

  await updateDoc(projectRef, {
    originalDeadline: project.deadline, // Capture current deadline as baseline
    isBaselined: true,
    baselinedAt: new Date().toISOString(),
    baselinedBy: userId
  });
};

// Get a single project by ID
export const getProject = async (projectId: string): Promise<Project | null> => {
  const projectRef = doc(projectsCol, projectId);
  const projectSnap = await getDoc(projectRef);
  if (projectSnap.exists()) {
    return projectSnap.data() as Project;
  }
  return null;
};

// Permanently delete a project (use with caution - data cannot be recovered)
export const deleteProject = async (projectId: string) => {
  await deleteDoc(doc(projectsCol, projectId));
};

// Member management functions
export const addProjectMember = async (
  projectId: string,
  project: Project,
  newMember: ProjectMember
): Promise<void> => {
  const updatedMemberIds = [...(project.memberIds || []), newMember.userId];
  const updatedMembers = [...(project.members || []), newMember];
  await updateDoc(doc(projectsCol, projectId), {
    memberIds: updatedMemberIds,
    members: updatedMembers,
  });
};

export const removeProjectMember = async (
  projectId: string,
  project: Project,
  userId: string
): Promise<void> => {
  const updatedMemberIds = (project.memberIds || []).filter(id => id !== userId);
  const updatedMembers = (project.members || []).filter(m => m.userId !== userId);
  await updateDoc(doc(projectsCol, projectId), {
    memberIds: updatedMemberIds,
    members: updatedMembers,
  });
};

export const updateProjectMemberScope = async (
  projectId: string,
  project: Project,
  userId: string,
  categoryScope: string[]
): Promise<void> => {
  // Spread existing member fields (including notificationsEnabled) before overwriting scope
  const updatedMembers = (project.members || []).map(m =>
    m.userId === userId ? { ...m, categoryScope } : m
  );
  await updateDoc(doc(projectsCol, projectId), { members: updatedMembers });
};

export const toggleMemberNotifications = async (
  projectId: string,
  project: Project,
  userId: string,
  enabled: boolean
): Promise<void> => {
  const updatedMembers = (project.members || []).map(m =>
    m.userId === userId ? { ...m, notificationsEnabled: enabled } : m
  );
  await updateDoc(doc(projectsCol, projectId), { members: updatedMembers });
};

export const addExternalRecipient = async (
  projectId: string,
  project: Project,
  recipient: Omit<ExternalRecipient, 'notificationsEnabled'>
): Promise<void> => {
  const existing = project.externalRecipients || [];
  const normalizedEmail = recipient.email.toLowerCase();
  const already = existing.some(r => r.email.toLowerCase() === normalizedEmail);
  if (already) throw new Error('This email is already a recipient');
  const updated = [...existing, { ...recipient, email: normalizedEmail, notificationsEnabled: true }];
  await updateDoc(doc(projectsCol, projectId), { externalRecipients: updated });
};

export const removeExternalRecipient = async (
  projectId: string,
  project: Project,
  email: string
): Promise<void> => {
  const updated = (project.externalRecipients || []).filter(
    r => r.email.toLowerCase() !== email.toLowerCase()
  );
  await updateDoc(doc(projectsCol, projectId), { externalRecipients: updated });
};

export const toggleExternalRecipientNotifications = async (
  projectId: string,
  project: Project,
  email: string,
  enabled: boolean
): Promise<void> => {
  const updated = (project.externalRecipients || []).map(r =>
    r.email.toLowerCase() === email.toLowerCase() ? { ...r, notificationsEnabled: enabled } : r
  );
  await updateDoc(doc(projectsCol, projectId), { externalRecipients: updated });
};

/**
 * Pure function: collect all email recipients that should receive BOM notifications.
 * Exported so it can be unit tested without Firebase.
 */
export const getNotificationRecipients = (project: Project): NotificationRecipient[] => {
  const recipients: NotificationRecipient[] = [];

  for (const m of project.members || []) {
    if (m.notificationsEnabled !== false && m.email) {
      recipients.push({ email: m.email, name: m.displayName || m.email });
    }
  }

  for (const r of project.externalRecipients || []) {
    if (r.notificationsEnabled !== false) {
      recipients.push({ email: r.email, name: r.name });
    }
  }

  return recipients;
};

// BOM Functions
export const getBOMData = async (projectId: string): Promise<BOMCategory[]> => {
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

/**
 * Recursively remove undefined values from an object/array to prevent Firestore errors
 */
const deepCleanUndefined = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(item => deepCleanUndefined(item)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => [key, deepCleanUndefined(value)])
    ) as T;
  }
  return obj;
};

export const updateBOMData = async (projectId: string, categories: BOMCategory[]) => {
  const bomRef = doc(db, 'projects', projectId, 'bom', 'data');
  // Sanitize items then deep clean to remove any undefined values in nested objects/arrays
  const sanitizedCategories = categories.map(category => ({
    ...category,
    items: category.items.map(item => sanitizeBOMItemForFirestore(item) as BOMItem)
  }));
  const cleanedCategories = deepCleanUndefined(sanitizedCategories);
  await setDoc(bomRef, { categories: cleanedCategories }, { merge: true });
};

export const updateBOMItem = async (projectId: string, categories: BOMCategory[], itemId: string, updates: Partial<BOMItem>) => {
  // Filter out undefined values from updates to prevent Firestore errors
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, value]) => value !== undefined)
  );

  const updatedCategories = categories.map(category => ({
    ...category,
    items: category.items.map(item =>
      item.id === itemId ? { ...item, ...cleanUpdates } : item
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

/**
 * Pure function to update multiple BOM items' status in a single transformation.
 * This prevents the race condition that occurs when updating items one-by-one
 * in a loop (where each update overwrites the previous one).
 *
 * @param categories - Current BOM categories
 * @param itemIds - Array of item IDs to update
 * @param newStatus - The new status to set
 * @returns Updated categories with all specified items' status changed
 */
export const batchUpdateItemStatus = (
  categories: BOMCategory[],
  itemIds: string[],
  newStatus: BOMStatus
): BOMCategory[] => {
  return categories.map(category => ({
    ...category,
    items: category.items.map(item =>
      itemIds.includes(item.id)
        ? { ...item, status: newStatus }
        : item
    )
  }));
};

/**
 * Update multiple BOM items to a new status in a single Firestore write.
 * Use this instead of calling updateBOMItem in a loop to avoid race conditions.
 */
export const updateMultipleBOMItemsStatus = async (
  projectId: string,
  categories: BOMCategory[],
  itemIds: string[],
  newStatus: BOMStatus
): Promise<void> => {
  const updatedCategories = batchUpdateItemStatus(categories, itemIds, newStatus);
  await updateBOMData(projectId, updatedCategories);
};

// Utility to calculate total BOM material cost for a project
export const getTotalBOMCost = (categories: BOMCategory[]): number => {
  return categories.reduce((total, category) => {
    return (
      total +
      category.items.reduce((catSum, item) => {
        // Use item.price (same as BOM page calculation)
        if (item.price && item.price > 0) {
          return catSum + item.price * (item.quantity || 1);
        }
        return catSum;
      }, 0)
    );
  }, 0);
};
