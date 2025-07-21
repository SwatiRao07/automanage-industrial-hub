
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Package,
  ShoppingCart,
  Clock,
  Calculator,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: FolderOpen, label: 'Projects', path: '/projects' },
  { icon: Package, label: 'Inventory', path: '/inventory' },
  { icon: ShoppingCart, label: 'Purchase Orders', path: '/purchase-orders' },
  { icon: FileText, label: 'BOMs', path: '/bom' },
  { icon: Clock, label: 'Time Tracking', path: '/time-tracking' },
  { icon: Calculator, label: 'Cost Analysis', path: '/cost-analysis' },
  { icon: Activity, label: 'Reports', path: '/reports' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const Sidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const location = useLocation();

  return (
    <div className={cn(
      "bg-slate-900 text-white flex flex-col transition-all duration-300 ease-in-out relative",
      collapsed ? "w-16" : "w-64",
      "h-screen fixed top-0 left-0 z-40"
    )}>
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-blue-400">IAPMS</h1>
              <p className="text-xs text-slate-400">Industrial Automation</p>
            </div>
          )}
          <button
            onClick={onToggle}
            className="p-1 rounded-lg hover:bg-slate-700 transition-colors"
          >
            {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                {item.openInNewTab ? (
                  <a
                    href={item.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex items-center p-3 rounded-lg transition-all duration-200",
                      "hover:bg-slate-700 group",
                      isActive ? "bg-blue-600 text-white" : "text-slate-300",
                      collapsed ? "justify-center" : "justify-start"
                    )}
                    onClick={e => e.stopPropagation()}
                  >
                    <item.icon size={20} className="flex-shrink-0" />
                    {!collapsed && (
                      <span className="ml-3 font-medium">{item.label}</span>
                    )}
                    {collapsed && (
                      <div className="absolute left-16 bg-slate-800 text-white px-2 py-1 rounded-md text-sm opacity-0 group-hover:opacity-100 pointer-events-none z-50 whitespace-nowrap">
                        {item.label}
                      </div>
                    )}
                  </a>
                ) : (
                  <NavLink
                    to={item.path}
                    className={cn(
                      "flex items-center p-3 rounded-lg transition-all duration-200",
                      "hover:bg-slate-700 group",
                      isActive ? "bg-blue-600 text-white" : "text-slate-300",
                      collapsed ? "justify-center" : "justify-start"
                    )}
                  >
                    <item.icon size={20} className="flex-shrink-0" />
                    {!collapsed && (
                      <span className="ml-3 font-medium">{item.label}</span>
                    )}
                    {collapsed && (
                      <div className="absolute left-16 bg-slate-800 text-white px-2 py-1 rounded-md text-sm opacity-0 group-hover:opacity-100 pointer-events-none z-50 whitespace-nowrap">
                        {item.label}
                      </div>
                    )}
                  </NavLink>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700">
        {!collapsed && (
          <div className="text-xs text-slate-400 text-center">
            Version 1.0.0
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
