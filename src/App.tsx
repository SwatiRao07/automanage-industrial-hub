
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import UserProfile from "./components/UserProfile";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import BOM from "./pages/BOM";
import TimeTracking from "./pages/TimeTracking";
import CostAnalysis from "./pages/CostAnalysis";
import NotFound from "./pages/NotFound";
import Vendors from "./pages/Vendors";
import React, { createContext, useContext, useState } from 'react';

const queryClient = new QueryClient();

// Sidebar context for global state
const SidebarContext = createContext<{ collapsed: boolean; toggle: () => void }>({ collapsed: false, toggle: () => {} });
export const useSidebar = () => useContext(SidebarContext);

const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed((c) => !c);
  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
};

// App Layout Component
const AppLayout: React.FC = () => {
  const { collapsed } = useSidebar();
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className={`bg-white shadow-sm border-b border-gray-200 px-6 py-4 transition-all duration-300 ${collapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <img 
              src="/qualitas-logo.png" 
              alt="Qualitas Technologies" 
              className="h-12 w-auto"
              style={{ minWidth: 120 }}
            />
            <h1 className="text-2xl font-semibold text-gray-900">
              Industrial AI Dashboard
            </h1>
          </div>
          <UserProfile />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/bom" element={<BOM />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/time-tracking" element={<TimeTracking />} />
          <Route path="/cost-analysis" element={<CostAnalysis />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <SidebarProvider>
        <BrowserRouter>
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        </BrowserRouter>
      </SidebarProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
