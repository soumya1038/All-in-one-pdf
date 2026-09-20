import { useState } from 'react';
import { X, BarChart3, TrendingUp, PieChart, Circle, AreaChart, ScatterChart } from 'lucide-react';
import { ChartConfig } from '../../types/Excel.types';
import { v4 as uuidv4 } from 'uuid';

interface ExcelChartDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertChart: (chart: ChartConfig) => void;
  defaultRange?: string;
  sheetIndex: number;
}

type ChartType = ChartConfig['type'];

interface ChartTypeOption {
  type: ChartType;
  label: string;
  icon: React.ReactNode;
}

const chartTypes: ChartTypeOption[] = [
  { type: 'bar', label: 'Bar Chart', icon: <BarChart3 size={24} /> },
  { type: 'line', label: 'Line Chart', icon: <TrendingUp size={24} /> },
  { type: 'pie', label: 'Pie Chart', icon: <PieChart size={24} /> },
  { type: 'doughnut', label: 'Doughnut', icon: <Circle size={24} /> },
  { type: 'area', label: 'Area Chart', icon: <AreaChart size={24} /> },
  { type: 'scatter', label: 'Scatter Plot', icon: <ScatterChart size={24} /> },
];

function ExcelChartDialog({ isOpen, onClose, onInsertChart, defaultRange, sheetIndex }: ExcelChartDialogProps) {
  const [selectedType, setSelectedType] = useState<ChartType>('bar');
  const [title, setTitle] = useState('Chart');
  const [dataRange, setDataRange] = useState(defaultRange || 'A1:D10');

  if (!isOpen) return null;

  const handleInsert = () => {
    const chart: ChartConfig = {
      id: uuidv4(),
      type: selectedType,
      title,
      dataRange,
      sheetIndex,
      position: {
        left: 100,
        top: 100,
        width: 400,
        height: 300,
      },
    };

    onInsertChart(chart);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-bg-surface rounded-xl shadow-lg border border-border w-full max-w-md animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-text-primary">Insert Chart</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-sunken text-text-muted hover:text-text-primary transition-fast"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Chart Type Selection */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">
              Chart Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {chartTypes.map((ct) => (
                <button
                  key={ct.type}
                  onClick={() => setSelectedType(ct.type)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-fast ${
                    selectedType === ct.type
                      ? 'border-accent bg-accent-light text-accent'
                      : 'border-border text-text-secondary hover:border-accent/50 hover:bg-bg-sunken'
                  }`}
                >
                  {ct.icon}
                  <span className="text-xs font-medium">{ct.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Chart Title */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Chart Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-bg-base border border-border rounded-md outline-none focus:border-accent focus:shadow-sm transition-fast text-text-primary"
              placeholder="Enter chart title..."
            />
          </div>

          {/* Data Range */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
              Data Range
            </label>
            <input
              type="text"
              value={dataRange}
              onChange={(e) => setDataRange(e.target.value)}
              className="w-full h-9 px-3 text-sm font-mono bg-bg-base border border-border rounded-md outline-none focus:border-accent focus:shadow-sm transition-fast text-text-primary"
              placeholder="e.g., A1:D10"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-sunken rounded-md transition-fast"
          >
            Cancel
          </button>
          <button
            onClick={handleInsert}
            disabled={!dataRange.trim()}
            className="px-4 py-2 text-sm font-medium bg-accent text-text-on-accent rounded-md hover:bg-accent-hover transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Insert Chart
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExcelChartDialog;
