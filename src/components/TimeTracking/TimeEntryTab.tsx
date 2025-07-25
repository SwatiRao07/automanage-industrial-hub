import { useRef, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  Engineer,
  Week,
  TimeEntry,
  fetchEngineers,
  fetchWeeks,
  addTimeEntry,
  addEngineer,
  updateEngineer,
  addWeek
} from "@/utils/timeTrackingFirestore";

const departments = ["Engineer", "Data Science", "Full Stack", "Sales"];

const TimeEntryTab = () => {
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [engineers, setEngineers] = useState<(Engineer & { id: string })[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [modalWeek, setModalWeek] = useState<string>("");
  const [modalHours, setModalHours] = useState<number | ''>('');
  const [modalDesc, setModalDesc] = useState('');
  const [modalEmployee, setModalEmployee] = useState<string>('');
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpDept, setNewEmpDept] = useState(departments[0]);
  const [newEmpRole, setNewEmpRole] = useState('');
  const [notesPanel, setNotesPanel] = useState<{ employeeId: string; week: string } | null>(null);
  const weeksSectionRef = useRef<HTMLDivElement>(null);
  const [editingEmp, setEditingEmp] = useState<string | null>(null);
  const [editingEmpName, setEditingEmpName] = useState('');
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');

  // Fetch initial data
  useEffect(() => {
    const loadData = async () => {
      if (!projectId) return;
      
      try {
        const [fetchedEngineers, fetchedWeeks] = await Promise.all([
          fetchEngineers(projectId),
          fetchWeeks(projectId)
        ]);
        
        setEngineers(fetchedEngineers);
        setWeeks(fetchedWeeks);
        
        // Set default selected week to current week
        const currentWeek = fetchedWeeks.find(w => w.status === 'current');
        if (currentWeek) {
          setSelectedWeek(currentWeek.key);
          setModalWeek(currentWeek.key);
        }

        // Set default modal employee if engineers exist
        if (fetchedEngineers.length > 0) {
          setModalEmployee(fetchedEngineers[0].id);
        }
      } catch (error) {
        console.error('Error loading time tracking data:', error);
        // TODO: Show error toast
      }
    };

    loadData();
  }, [projectId]);

  // Project total hours
  const getTotalHours = () => {
    return engineers.reduce((sum, eng) => sum + Object.values(eng.weeks).reduce((s, w) => s + w.total, 0), 0);
  };

  // Add new week logic
  const handleAddWeek = async () => {
    if (!projectId) return;

    const lastWeek = weeks[weeks.length - 1];
    const newWeekStart = new Date(lastWeek.endDate);
    newWeekStart.setDate(newWeekStart.getDate() + 1);
    const newWeekEnd = new Date(newWeekStart);
    newWeekEnd.setDate(newWeekStart.getDate() + 6);

    const weekNum = weeks.length + 1;
    const newWeek: Week = {
      key: `week${weekNum}`,
      label: `Week ${weekNum}`,
      dates: `${newWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${newWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      status: 'future',
      startDate: newWeekStart,
      endDate: newWeekEnd
    };

    try {
      await addWeek(projectId, newWeek);
      setWeeks(prev => [...prev, newWeek]);
      setModalWeek(newWeek.key);
    } catch (error) {
      console.error('Error adding new week:', error);
      // TODO: Show error toast
    }
  };

  // Add new employee logic
  const handleAddEmployee = async () => {
    if (!projectId || !newEmpName || !newEmpDept || !newEmpRole) return;

    try {
      const newEngineer = await addEngineer(projectId, {
        name: newEmpName,
        role: newEmpRole,
        department: newEmpDept
      });

      setEngineers(prev => [...prev, newEngineer]);
      setModalEmployee(newEngineer.id);
      setShowAddEmployee(false);
      setNewEmpName('');
      setNewEmpDept(departments[0]);
      setNewEmpRole('');
    } catch (error) {
      console.error('Error adding new employee:', error);
      // TODO: Show error toast
    }
  };

  // Modal logic
  const openModal = () => {
    const currentWeek = weeks.find(w => w.status === 'current');
    if (currentWeek) {
      setModalWeek(currentWeek.key);
    }
    setModalHours('');
    setModalDesc('');
    setShowModal(true);
  };

  const closeModal = () => setShowModal(false);

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted', { modalWeek, modalHours, modalDesc, modalEmployee });

    if (!projectId) {
      console.error('No project ID provided');
      return;
    }

    if (!modalWeek) {
      console.error('No week selected');
      return;
    }

    if (!modalHours || modalHours <= 0) {
      console.error('Invalid hours');
      return;
    }

    if (!modalEmployee) {
      console.error('No employee selected');
      return;
    }

    try {
      if (modalWeek === 'addNewWeek') {
        await handleAddWeek();
        return;
      }

      const engineer = engineers.find(e => e.id === modalEmployee);
      if (!engineer) {
        console.error('Engineer not found:', modalEmployee);
        return;
      }

      console.log('Adding time entry for', engineer.name);

      const entry = {
        hours: Number(modalHours),
        description: modalDesc || 'No description provided'
      };

      const updatedWeekData = await addTimeEntry(projectId, engineer.id, modalWeek, entry);
      console.log('Time entry added successfully', updatedWeekData);

      // Update local state
      setEngineers(prev => prev.map(eng => {
        if (eng.id !== modalEmployee) return eng;
        return {
          ...eng,
          weeks: {
            ...eng.weeks,
            [modalWeek]: updatedWeekData
          }
        };
      }));

      // Reset form and close modal
      setModalHours('');
      setModalDesc('');
      setShowModal(false);
    } catch (error) {
      console.error('Error adding time entry:', error);
      // TODO: Show error toast
    }
  };

  // Inline employee name editing
  const handleEditEmp = (id: string) => {
    setEditingEmp(id);
    setEditingEmpName(engineers.find(e => e.id === id)?.name || '');
  };

  const handleSaveEmp = async (oldId: string) => {
    if (!projectId) return;

    try {
      await updateEngineer(projectId, oldId, { name: editingEmpName });

      setEngineers(prev => prev.map(emp =>
        emp.id === oldId ? { ...emp, name: editingEmpName } : emp
      ));
      setModalEmployee(editingEmpName === '' ? oldId : editingEmpName);
      setEditingEmp(null);
      setEditingEmpName('');
    } catch (error) {
      console.error('Error updating engineer name:', error);
      // TODO: Show error toast
    }
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

  // Always show current week in table
  const visibleWeeks = weeks.filter(week =>
    week.status === 'current' || engineers.some(eng => eng.weeks[week.key]?.total > 0)
  );

  // Pending updates for current week
  const currentWeek = weeks.find(w => w.status === 'current');
  const pendingUpdates = currentWeek
    ? engineers.filter(eng => (eng.weeks[currentWeek.key]?.total || 0) === 0).length
    : 0;

  if (!projectId) {
    return <div className="p-6 text-center text-gray-500">No project selected</div>;
  }

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
            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div className="mb-4">
                <label className="block mb-2 font-semibold text-gray-700">Select Employee:</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={modalEmployee}
                  onChange={e => {
                    if (e.target.value === 'addNewEmployee') {
                      setShowAddEmployee(true);
                      // Don't update modalEmployee when selecting "Add New Employee"
                    } else {
                      setModalEmployee(e.target.value);
                      setShowAddEmployee(false);
                    }
                  }}
                  required
                >
                  <option value="">Select an employee...</option>
                  {engineers.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
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
                  <Button 
                    type="button" 
                    className="mt-2 bg-gradient-to-r from-green-500 to-green-700 text-white font-semibold w-full" 
                    onClick={async () => {
                      await handleAddEmployee();
                      // After adding employee, close the add employee form
                      setShowAddEmployee(false);
                    }}
                  >
                    Add Employee
                  </Button>
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
                <Button type="button" variant="outline" className="px-6" onClick={closeModal}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="px-6 bg-gradient-to-r from-green-500 to-green-700 text-white font-semibold"
                >
                  Add Hours
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Notes Panel */}
      {notesPanel && (() => {
        const engineer = engineers.find(e => e.id === notesPanel.employeeId);
        const week = weeks.find(w => w.key === notesPanel.week);
        const weekData = engineer?.weeks[notesPanel.week];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
            <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md relative animate-fadeIn">
              <button className="absolute top-3 right-4 text-2xl text-gray-400 hover:text-red-500" onClick={() => setNotesPanel(null)}>&times;</button>
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold mb-1 text-gray-800">Time Entry Notes</h2>
                <p className="text-gray-500">{engineer?.name} - {week?.label}</p>
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
                {engineers.map((eng) => (
                  <tr key={eng.id} style={{ height: 80 }} className="border-b border-blue-100">
                    <td className="py-4 px-4">
                      {editingEmp === eng.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            className="border rounded px-2 py-1 text-base"
                            value={editingEmpName}
                            onChange={e => setEditingEmpName(e.target.value)}
                            onBlur={() => handleSaveEmp(eng.id)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveEmp(eng.id); }}
                            autoFocus
                          />
                          <button className="text-green-600 font-bold" onClick={() => handleSaveEmp(eng.id)} title="Save">✔️</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 text-base">{eng.name}</span>
                          <button className="text-blue-500 hover:text-blue-700" onClick={() => handleEditEmp(eng.id)} title="Edit Name">✏️</button>
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
                  <tr key={eng.id} style={{ height: 80 }} className="border-b border-blue-100">
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
                          onClick={() => setNotesPanel({ employeeId: eng.id, week: week.key })}
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
                  <tr key={eng.id} style={{ height: 80 }} className="border-b border-blue-100">
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