import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface TimeEntry {
  hours: number;
  description: string;
}

interface Engineer {
  name: string;
  role: string;
  weeks: {
    [weekKey: string]: {
      total: number;
      entries: TimeEntry[];
      status?: 'not-updated' | 'future' | 'ok';
    };
  };
}

interface Week {
  key: string;
  label: string;
  dates: string;
  status: 'past' | 'current' | 'future';
}

function getNextWeek(startDate: Date, weekCount: number): { label: string; dates: string; status: 'future'; key: string } {
  const newWeekNum = weekCount + 1;
  const newWeekKey = `week${newWeekNum}`;
  const newWeekStart = new Date(startDate);
  newWeekStart.setDate(startDate.getDate() + (newWeekNum - 1) * 7);
  const newWeekEnd = new Date(newWeekStart);
  newWeekEnd.setDate(newWeekStart.getDate() + 6);
  const startStr = newWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = newWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    key: newWeekKey,
    label: `Week ${newWeekNum}`,
    dates: `${startStr}-${endStr}`,
    status: 'future',
  };
}

function getCurrentWeekIndex(startDate: Date, weeks: Week[]): number {
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const weekIdx = Math.floor(diffDays / 7);
  return Math.max(0, Math.min(weekIdx, weeks.length - 1));
}

function getWeekLabelAndDates(startDate: Date, weekIdx: number): { label: string; dates: string; key: string } {
  const newWeekKey = `week${weekIdx + 1}`;
  const newWeekStart = new Date(startDate);
  newWeekStart.setDate(startDate.getDate() + weekIdx * 7);
  const newWeekEnd = new Date(newWeekStart);
  newWeekEnd.setDate(newWeekStart.getDate() + 6);
  const startStr = newWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = newWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    key: newWeekKey,
    label: `Week ${weekIdx + 1}`,
    dates: `${startStr}-${endStr}`,
  };
}

const initialWeeks: Week[] = [
  { key: "week1", label: "Week 1", dates: "Jul 1-7", status: "past" },
  { key: "week2", label: "Week 2", dates: "Jul 8-14", status: "past" },
  { key: "week3", label: "Week 3", dates: "Jul 15-21", status: "current" },
  { key: "week4", label: "Week 4", dates: "Jul 22-28", status: "future" },
  { key: "week5", label: "Week 5", dates: "Jul 29-Aug 4", status: "future" },
  { key: "week6", label: "Week 6", dates: "Aug 5-11", status: "future" },
];

const initialEngineers: Engineer[] = [
  {
    name: "Sarah Johnson",
    role: "Frontend Developer",
    weeks: {
      week1: { total: 32, entries: [{ hours: 32, description: "UI work" }] },
      week2: { total: 28, entries: [{ hours: 28, description: "" }] }, // No note
      week3: { total: 0, entries: [], status: 'not-updated' },
      week4: { total: 0, entries: [], status: 'future' },
      week5: { total: 0, entries: [], status: 'future' },
      week6: { total: 0, entries: [], status: 'future' },
    },
  },
  {
    name: "Mike Chen",
    role: "Backend Developer",
    weeks: {
      week1: { total: 25, entries: [{ hours: 25, description: "API work" }] },
      week2: { total: 30, entries: [{ hours: 30, description: "" }] }, // No note
      week3: { total: 35, entries: [{ hours: 35, description: "" }] }, // No note property
      week4: { total: 0, entries: [], status: 'future' },
      week5: { total: 0, entries: [], status: 'future' },
      week6: { total: 0, entries: [], status: 'future' },
    },
  },
  {
    name: "Emma Davis",
    role: "UI/UX Designer",
    weeks: {
      week1: { total: 20, entries: [{ hours: 20, description: "Wireframes" }] },
      week2: { total: 15, entries: [{ hours: 15, description: "" }] }, // No note property
      week3: { total: 0, entries: [], status: 'not-updated' },
      week4: { total: 0, entries: [], status: 'future' },
      week5: { total: 0, entries: [], status: 'future' },
      week6: { total: 0, entries: [], status: 'future' },
    },
  },
  {
    name: "Alex Rodriguez",
    role: "Project Manager",
    weeks: {
      week1: { total: 15, entries: [{ hours: 15, description: "Planning" }] },
      week2: { total: 18, entries: [{ hours: 18, description: "" }] }, // No note
      week3: { total: 20, entries: [{ hours: 20, description: "Reporting" }] },
      week4: { total: 0, entries: [], status: 'future' },
      week5: { total: 0, entries: [], status: 'future' },
      week6: { total: 0, entries: [], status: 'future' },
    },
  },
  {
    name: "You",
    role: "Developer",
    weeks: {
      week1: { total: 8, entries: [ { hours: 4, description: "Frontend development - login page" }, { hours: 4, description: "" } ] }, // One with, one without note
      week2: { total: 12, entries: [ { hours: 12, description: "" } ] }, // No note
      week3: { total: 15, entries: [ { hours: 6, description: "UI components development" }, { hours: 5, description: "" }, { hours: 4, description: "" } ] }, // Mixed
      week4: { total: 0, entries: [], status: 'future' },
      week5: { total: 0, entries: [], status: 'future' },
      week6: { total: 0, entries: [], status: 'future' },
    },
  },
];

const projectStartDate = new Date(2025, 6, 1); // July 1, 2025
const departments = ["Engineer", "Data Science", "Full Stack", "Sales"];

const TimeEntryTab = () => {
  const [weeks, setWeeks] = useState<Week[]>(initialWeeks);
  const [engineers, setEngineers] = useState<Engineer[]>(initialEngineers);
  const [selectedWeek, setSelectedWeek] = useState<string>(weeks[2].key); // Default to current week
  const [showModal, setShowModal] = useState(false);
  const [modalWeek, setModalWeek] = useState<string>(weeks[2].key);
  const [modalHours, setModalHours] = useState<number | ''>('');
  const [modalDesc, setModalDesc] = useState('');
  const [modalEmployee, setModalEmployee] = useState<string>('You');
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpDept, setNewEmpDept] = useState(departments[0]);
  const [newEmpRole, setNewEmpRole] = useState('');
  const [notesPanel, setNotesPanel] = useState<{ employee: string; week: string } | null>(null);
  const weeksSectionRef = useRef<HTMLDivElement>(null);
  const [editingEmp, setEditingEmp] = useState<string | null>(null);
  const [editingEmpName, setEditingEmpName] = useState('');

  // Project total hours
  const getTotalHours = () => {
    return engineers.reduce((sum, eng) => sum + Object.values(eng.weeks).reduce((s, w) => s + w.total, 0), 0);
  };

  // Add new week logic
  const handleAddWeek = () => {
    const newWeek = getNextWeek(projectStartDate, weeks.length);
    setWeeks((prev) => [...prev, newWeek]);
    setEngineers((prev) =>
      prev.map((eng) => ({
        ...eng,
        weeks: {
          ...eng.weeks,
          [newWeek.key]: { total: 0, entries: [], status: 'future' },
        },
      }))
    );
    setModalWeek(newWeek.key);
  };

  // Add new employee logic
  const handleAddEmployee = () => {
    if (!newEmpName || !newEmpDept || !newEmpRole) return;
    setEngineers(prev => [
      ...prev,
      {
        name: newEmpName,
        role: newEmpRole,
        weeks: weeks.reduce((acc, w) => {
          acc[w.key] = { total: 0, entries: [], status: w.status === 'future' ? 'future' : undefined };
          return acc;
        }, {} as Engineer['weeks'])
      }
    ]);
    setModalEmployee(newEmpName);
    setShowAddEmployee(false);
    setNewEmpName('');
    setNewEmpDept(departments[0]);
    setNewEmpRole('');
  };

  // Modal logic
  const openModal = () => {
    setModalWeek(currentWeekKey);
    setModalHours('');
    setModalDesc('');
    setShowModal(true);
  };
  const closeModal = () => setShowModal(false);

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalWeek || !modalHours || modalHours <= 0 || !modalEmployee) return;
    if (modalWeek === 'addNewWeek') {
      handleAddWeek();
      return;
    }
    setEngineers(prev => prev.map(eng => {
      if (eng.name !== modalEmployee) return eng;
      const weekData = eng.weeks[modalWeek] || { total: 0, entries: [], status: undefined };
      const newEntry = { hours: Number(modalHours), description: modalDesc || 'No description provided' };
      return {
        ...eng,
        weeks: {
          ...eng.weeks,
          [modalWeek]: {
            ...weekData,
            total: (weekData.total || 0) + Number(modalHours),
            entries: [...(weekData.entries || []), newEntry],
            status: weekData.status === 'future' ? undefined : weekData.status,
          }
        }
      };
    }));
    setShowModal(false);
  };

  // Inline employee name editing
  const handleEditEmp = (name: string) => {
    setEditingEmp(name);
    setEditingEmpName(name);
  };
  const handleSaveEmp = (oldName: string) => {
    setEngineers(prev => prev.map(emp =>
      emp.name === oldName ? { ...emp, name: editingEmpName } : emp
    ));
    setModalEmployee(editingEmpName === '' ? oldName : editingEmpName);
    setEditingEmp(null);
    setEditingEmpName('');
  };

  // Scroll controls
  const scrollWeeks = (direction: 'left' | 'right') => {
    if (weeksSectionRef.current) {
      const scrollAmount = 240;
      if (direction === 'left') {
        weeksSectionRef.current.scrollLeft -= scrollAmount;
      } else {
        weeksSectionRef.current.scrollLeft += scrollAmount;
      }
    }
  };

  // Dynamically determine current week
  const currentWeekIdx = getCurrentWeekIndex(projectStartDate, weeks);
  const { key: currentWeekKey, label: currentWeekLabel, dates: currentWeekDates } = getWeekLabelAndDates(projectStartDate, currentWeekIdx);

  // Ensure current week is present and update week statuses
  useEffect(() => {
    let updated = false;
    let newWeeks = weeks;
    // Ensure current week is present
    if (!weeks.some(w => w.key === currentWeekKey)) {
      newWeeks = [
        ...weeks,
        {
          key: currentWeekKey,
          label: currentWeekLabel,
          dates: currentWeekDates,
          status: 'current',
        },
      ];
      setEngineers(prev => prev.map(eng => ({
        ...eng,
        weeks: {
          ...eng.weeks,
          [currentWeekKey]: { total: 0, entries: [], status: undefined },
        },
      })));
      updated = true;
    }
    // Update week statuses
    const today = new Date();
    newWeeks = newWeeks.map((w, idx) => {
      const weekStart = new Date(projectStartDate);
      weekStart.setDate(projectStartDate.getDate() + idx * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      let status: 'past' | 'current' | 'future';
      if (today >= weekStart && today <= weekEnd) {
        status = 'current';
      } else if (today < weekStart) {
        status = 'future';
      } else {
        status = 'past';
      }
      if (w.status !== status) updated = true;
      return { ...w, status };
    });
    if (updated) setWeeks(newWeeks);
  }, [weeks, currentWeekKey, currentWeekLabel, currentWeekDates]);

  // Always show current week in table
  const visibleWeeks = weeks.filter(week =>
    week.key === currentWeekKey || engineers.some(eng => eng.weeks[week.key]?.total > 0)
  );

  // Pending updates for current week
  const pendingUpdates = engineers.filter(eng => (eng.weeks[currentWeekKey]?.total || 0) === 0).length;

  return (
    <div className="space-y-6">
      {/* Header Section */}

      {/* Controls - flex row, project hours to right (remove Add New Week button) */}
      <div className="flex flex-wrap gap-4 items-center mb-4 justify-between">
        <div className="flex gap-4 items-center">
          <Button className="bg-gradient-to-r from-red-500 to-red-700 text-white font-semibold px-4 py-2 rounded-full shadow" onClick={openModal}>
            ➕ Add My Hours
          </Button>
          <div className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-white px-4 py-2 rounded-full font-semibold shadow flex items-center">
            {pendingUpdates > 0 ? `⚠️ ${pendingUpdates} pending updates this week` : '✅ All updates complete'}
          </div>
        </div>
        <div className="bg-gradient-to-r from-green-500 to-green-700 text-white px-6 py-2 rounded-xl text-center shadow">
          <div className="text-base font-medium">Total Project Hours</div>
          <div className="text-2xl font-bold">{getTotalHours()}</div>
        </div>
      </div>

      {/* Add My Hours Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md relative animate-fadeIn">
            <button className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-red-500" onClick={closeModal}>&times;</button>
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold mb-1 text-gray-800">Add Your Hours</h2>
              <p className="text-gray-500">Log time spent on ABC OCR Project</p>
            </div>
            <form onSubmit={handleModalSubmit}>
              <div className="mb-4">
                <label className="block mb-2 font-semibold text-gray-700">Select Employee:</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={modalEmployee}
                  onChange={e => {
                    if (e.target.value === 'addNewEmployee') setShowAddEmployee(true);
                    setModalEmployee(e.target.value);
                  }}
                  required
                >
                  {engineers.map(emp => (
                    <option key={emp.name} value={emp.name}>{emp.name}</option>
                  ))}
                  <option value="addNewEmployee">➕ Add New Employee</option>
                </select>
              </div>
              {showAddEmployee && (
                <div className="mb-4 p-4 border rounded-lg bg-gray-50">
                  <div className="mb-2">
                    <label className="block mb-1 font-semibold text-gray-700">Employee Name:</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2" value={newEmpName} onChange={e => setNewEmpName(e.target.value)} required />
                  </div>
                  <div className="mb-2">
                    <label className="block mb-1 font-semibold text-gray-700">Department:</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2" value={newEmpDept} onChange={e => setNewEmpDept(e.target.value)}>
                      {departments.map(dep => <option key={dep} value={dep}>{dep}</option>)}
                    </select>
                  </div>
                  <div className="mb-2">
                    <label className="block mb-1 font-semibold text-gray-700">Position/Role:</label>
                    <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2" value={newEmpRole} onChange={e => setNewEmpRole(e.target.value)} required />
                  </div>
                  <Button type="button" className="mt-2 bg-gradient-to-r from-green-500 to-green-700 text-white font-semibold" onClick={handleAddEmployee}>Add Employee</Button>
                </div>
              )}
              <div className="mb-4">
                <label className="block mb-2 font-semibold text-gray-700">Select Week:</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={modalWeek}
                  onChange={e => setModalWeek(e.target.value)}
                  required
                >
                  <option value="">Choose a week...</option>
                  {weeks.map(week => (
                    <option key={week.key} value={week.key} className={week.status === 'current' ? 'bg-green-100 font-bold' : ''}>
                      {week.label} ({week.dates}) {week.status === 'current' ? ' - CURRENT WEEK' : week.status === 'future' ? ' - Future' : ' - Past'}
                    </option>
                  ))}
                  <option value="addNewWeek" style={{ background: '#e8f5e8', fontWeight: 'bold' }}>➕ Add New Week</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block mb-2 font-semibold text-gray-700">Hours Worked:</label>
                <input
                  type="number"
                  min={0}
                  max={168}
                  step={0.5}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={modalHours}
                  onChange={e => setModalHours(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Enter hours (e.g., 8.5)"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block mb-2 font-semibold text-gray-700">Task Description:</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={modalDesc}
                  onChange={e => setModalDesc(e.target.value)}
                  placeholder="What did you work on?"
                  required
                />
              </div>
              <div className="flex gap-4 justify-center mt-6">
                <Button type="button" variant="outline" className="px-6" onClick={closeModal}>Cancel</Button>
                <Button type="submit" className="px-6 bg-gradient-to-r from-green-500 to-green-700 text-white font-semibold">Add Hours</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Notes Panel */}
      {notesPanel && (() => {
        const emp = engineers.find(e => e.name === notesPanel.employee);
        const week = notesPanel.week;
        const weekData = emp?.weeks[week];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
            <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md relative animate-fadeIn">
              <button className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-red-500" onClick={() => setNotesPanel(null)}>&times;</button>
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold mb-1 text-gray-800">Time Entry Notes</h2>
                <p className="text-gray-500">{emp?.name} - {weeks.find(w => w.key === week)?.label}</p>
              </div>
              <div className="space-y-4">
                {weekData?.entries?.length ? weekData.entries.map((entry, idx) => (
                  <div key={idx} className="note-entry bg-blue-50 p-4 rounded-lg border-l-4 border-blue-400">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-gray-700">{entry.hours} hours</span>
                    </div>
                    <div className="text-gray-600 italic">{entry.description}</div>
                  </div>
                )) : <div className="text-gray-400 italic">No entries for this week.</div>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Timesheet Table */}
      <div className="timesheet-wrapper bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="flex">
          {/* Fixed Employee Names Column */}
          <div className="min-w-[250px] bg-blue-50 border-r border-blue-200 z-10">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="py-5 px-4 text-left font-bold text-white text-base bg-blue-900">Team Member</th>
                </tr>
              </thead>
              <tbody>
                {engineers.map((eng, idx) => (
                  <tr key={eng.name} style={{ height: 80 }} className="border-b border-blue-100">
                    <td className="py-4 px-4">
                      {editingEmp === eng.name ? (
                        <div className="flex items-center gap-2">
                          <input
                            className="border rounded px-2 py-1 text-base"
                            value={editingEmpName}
                            onChange={e => setEditingEmpName(e.target.value)}
                            onBlur={() => handleSaveEmp(eng.name)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveEmp(eng.name); }}
                            autoFocus
                          />
                          <button className="text-green-600 font-bold" onClick={() => handleSaveEmp(eng.name)} title="Save">✔️</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 text-base">{eng.name}</span>
                          <button className="text-blue-500 hover:text-blue-700" onClick={() => handleEditEmp(eng.name)} title="Edit Name">✏️</button>
                        </div>
                      )}
                      <div className="text-sm text-gray-500 mt-1">{eng.role}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Scrollable Weeks Section */}
          <div className="flex-1 relative overflow-x-auto" ref={weeksSectionRef} id="weeksSection">
            {/* Scroll Controls */}
            <button className="scroll-controls scroll-left absolute left-2 top-1/2 -translate-y-1/2 bg-white border shadow rounded-full w-10 h-10 flex items-center justify-center z-20" onClick={() => scrollWeeks('left')}>
              &#x2039;
            </button>
            <button className="scroll-controls scroll-right absolute right-2 top-1/2 -translate-y-1/2 bg-white border shadow rounded-full w-10 h-10 flex items-center justify-center z-20" onClick={() => scrollWeeks('right')}>
              &#x203A;
            </button>
            <table className="weeks-table min-w-[600px] w-full">
              <thead>
                <tr>
                  {visibleWeeks.map((week, idx) => (
                    <th key={week.key} className="week-header py-5 px-4 text-center font-bold text-white text-base bg-blue-900">
                      {week.label}
                      <span className="block text-xs text-blue-100 mt-1">{week.dates}</span>
                      {week.status === 'current' && (
                        <span className="absolute top-1 right-1 bg-yellow-400 text-white text-xs px-2 py-1 rounded-full font-bold">CURRENT</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {engineers.map((eng, rowIdx) => (
                  <tr key={eng.name} style={{ height: 80 }} className="border-b border-blue-100">
                    {visibleWeeks.map((week, colIdx) => {
                      const weekData = eng.weeks[week.key];
                      if (weekData.status === 'future') {
                        return <td key={week.key} className="hours-cell text-center text-gray-400">-</td>;
                      }
                      if (weekData.status === 'not-updated' || weekData.total === 0) {
                        return <td key={week.key} className="hours-cell text-center text-red-500 italic bg-red-50">Not updated</td>;
                      }
                      return (
                        <td
                          key={week.key}
                          className="hours-cell text-center font-semibold text-gray-800 cursor-pointer hover:bg-blue-50"
                          onClick={() => setNotesPanel({ employee: eng.name, week: week.key })}
                        >
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-blue-400">
                            {weekData.total}
                          </span>
                          {weekData.entries.length > 1 && (
                            <div className="text-xs text-gray-500 mt-1">{weekData.entries.length} entries</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fixed Total Hours Column */}
          <div className="min-w-[150px] bg-blue-50 border-l border-blue-200">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="week-header py-5 px-4 text-center font-bold text-white text-base bg-blue-900">Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {engineers.map((eng) => (
                  <tr key={eng.name} style={{ height: 80 }} className="border-b border-blue-100">
                    <td>
                      <div className="total-hours bg-blue-500 text-white rounded-lg px-4 py-2 font-bold text-center shadow">
                        {Object.values(eng.weeks).reduce((sum, w) => sum + w.total, 0)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimeEntryTab;