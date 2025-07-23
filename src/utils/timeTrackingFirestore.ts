import { db } from '@/firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where } from 'firebase/firestore';

export interface TimeEntry {
  hours: number;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeekData {
  total: number;
  entries: TimeEntry[];
  status?: 'not-updated' | 'future' | 'ok';
}

export interface Engineer {
  name: string;
  role: string;
  department: string;
  weeks: {
    [weekKey: string]: WeekData;
  };
}

export interface Week {
  key: string;
  label: string;
  dates: string;
  status: 'past' | 'current' | 'future';
  startDate: Date;
  endDate: Date;
}

// Fetch all engineers for a project
export const fetchEngineers = async (projectId: string): Promise<(Engineer & { id: string })[]> => {
  const engineersRef = collection(db, 'projects', projectId, 'engineers');
  const snapshot = await getDocs(engineersRef);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Engineer & { id: string }));
};

// Fetch all weeks for a project
export const fetchWeeks = async (projectId: string): Promise<Week[]> => {
  const weeksRef = collection(db, 'projects', projectId, 'weeks');
  const snapshot = await getDocs(weeksRef);
  return snapshot.docs.map(doc => ({
    ...doc.data(),
    startDate: doc.data().startDate.toDate(),
    endDate: doc.data().endDate.toDate()
  } as Week));
};

// Add a new time entry
export const addTimeEntry = async (
  projectId: string,
  engineerId: string,
  weekKey: string,
  entry: Omit<TimeEntry, 'createdAt' | 'updatedAt'>
) => {
  try {
    console.log('Adding time entry:', { projectId, engineerId, weekKey, entry });
    
    const engineerRef = doc(db, 'projects', projectId, 'engineers', engineerId);
    const engineerDoc = await getDoc(engineerRef);
    
    if (!engineerDoc.exists()) {
      console.error('Engineer document not found:', engineerId);
      throw new Error('Engineer not found');
    }

    const engineer = engineerDoc.data() as Engineer;
    console.log('Found engineer:', engineer);
    
    const weekData = engineer.weeks[weekKey] || { total: 0, entries: [] };
    
    const newEntry: TimeEntry = {
      ...entry,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const updatedWeekData: WeekData = {
      total: (weekData.total || 0) + entry.hours,
      entries: [...(weekData.entries || []), newEntry],
      status: 'ok'
    };

    console.log('Updating week data:', updatedWeekData);

    await updateDoc(engineerRef, {
      [`weeks.${weekKey}`]: updatedWeekData
    });

    return updatedWeekData;
  } catch (error) {
    console.error('Error in addTimeEntry:', error);
    throw error;
  }
};

// Add a new engineer
export const addEngineer = async (
  projectId: string,
  engineer: Omit<Engineer, 'weeks'>
) => {
  const weeksSnapshot = await getDocs(collection(db, 'projects', projectId, 'weeks'));
  const weeks = weeksSnapshot.docs.reduce((acc, doc) => {
    acc[doc.id] = { total: 0, entries: [], status: 'not-updated' };
    return acc;
  }, {} as Engineer['weeks']);

  const engineerWithWeeks: Engineer = {
    ...engineer,
    weeks
  };

  const engineersRef = collection(db, 'projects', projectId, 'engineers');
  const newEngineerRef = doc(engineersRef);
  await setDoc(newEngineerRef, engineerWithWeeks);

  return { id: newEngineerRef.id, ...engineerWithWeeks };
};

// Update engineer details
export const updateEngineer = async (
  projectId: string,
  engineerId: string,
  updates: Partial<Omit<Engineer, 'weeks'>>
) => {
  const engineerRef = doc(db, 'projects', projectId, 'engineers', engineerId);
  await updateDoc(engineerRef, updates);
};

// Add a new week
export const addWeek = async (projectId: string, week: Week) => {
  const weekRef = doc(db, 'projects', projectId, 'weeks', week.key);
  await setDoc(weekRef, week);

  // Update all engineers to include the new week
  const engineersSnapshot = await getDocs(collection(db, 'projects', projectId, 'engineers'));
  const updatePromises = engineersSnapshot.docs.map(doc => 
    updateDoc(doc.ref, {
      [`weeks.${week.key}`]: { total: 0, entries: [], status: 'future' }
    })
  );

  await Promise.all(updatePromises);
  return week;
}; 