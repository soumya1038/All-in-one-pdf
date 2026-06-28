import { FileText, Minimize2, X } from 'lucide-react';
import Sidebar from './Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="h-screen w-screen flex flex-col bg-bg-base overflow-hidden">
      {/* Custom Titlebar */}
      <div className="h-8 bg-bg-surface border-b border-border flex items-center justify-between px-4 select-none drag-region">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-accent" />
          <span className="text-sm font-semibold text-text-primary">DocuFlow</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-1 hover:bg-bg-sunken rounded transition-fast"
            aria-label="Minimize"
          >
            <Minimize2 size={14} />
          </button>
          <button
            className="p-1 hover:bg-error-light rounded transition-fast"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export default MainLayout;
