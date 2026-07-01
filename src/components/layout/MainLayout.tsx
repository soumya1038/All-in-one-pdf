import { FileText } from 'lucide-react';
import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

function MainLayout({ children }: MainLayoutProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  // Track maximize/restore state for the toggle icon
  useEffect(() => {
    const handleResize = () => {
      // screen.availWidth is a reasonable proxy; Electron's ipc could be more accurate
      // but this avoids an extra IPC round-trip
      setIsMaximized(window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-base overflow-hidden">
      {/* Custom Titlebar */}
      <div className="h-8 bg-bg-surface border-b border-border flex items-center justify-between px-4 select-none drag-region flex-shrink-0">
        <div className="flex items-center gap-2 no-drag">
          <FileText size={16} className="text-accent" />
          <span className="text-sm font-semibold text-text-primary">DocuFlow</span>
        </div>

        {/* Window controls — must be no-drag so clicks register */}
        <div className="flex items-center no-drag h-full">
          <button
            onClick={() => window.electron.minimizeWindow()}
            className="w-[46px] h-8 flex items-center justify-center hover:bg-bg-sunken transition-fast"
            aria-label="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary">
              <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            onClick={() => { window.electron.maximizeWindow(); setIsMaximized((p) => !p); }}
            className="w-[46px] h-8 flex items-center justify-center hover:bg-bg-sunken transition-fast"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary">
                <path d="M2.5,1.5 H8.5 V7.5" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="1.5" y="2.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary">
                <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            onClick={() => window.electron.closeWindow()}
            className="w-[46px] h-8 flex items-center justify-center hover:bg-[#E81123] hover:text-white group transition-fast"
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary group-hover:text-white">
              <path d="M1.5,1.5 L8.5,8.5 M8.5,1.5 L1.5,8.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
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
