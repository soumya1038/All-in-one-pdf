import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView, WorkflowType } from '../types/UI.types';
import { OutputFormat, PdfPageSize } from '../types/Output.types';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

function OutputScreen() {
  const documents = useAppStore((state) => state.documents);
  const outputOptions = useAppStore((state) => state.outputOptions);
  const updateOutputOptions = useAppStore((state) => state.updateOutputOptions);
  const setView = useAppStore((state) => state.setView);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);

  const [filename, setFilename] = useState(outputOptions.filename);
  const [format, setFormat] = useState(() => {
    if (activeWorkflow === WorkflowType.CONVERT) {
      return OutputFormat.JPEG; // Default export format for conversion
    }
    return OutputFormat.PDF;
  });
  const [targetSize, setTargetSize] = useState<string>('');
  const [targetUnit, setTargetUnit] = useState<'KB' | 'MB'>('MB');
  const [pageSize, setPageSize] = useState(outputOptions.pdfPageSize);
  const [dpi, setDpi] = useState(outputOptions.imageDpi);
  const [mergeAsSingle, setMergeAsSingle] = useState(activeWorkflow === WorkflowType.MERGE);
  const [protectionEnabled, setProtectionEnabled] = useState(activeWorkflow === WorkflowType.PROTECT);
  const [ownerPassword, setOwnerPassword] = useState('');
  const [userPassword, setUserPassword] = useState('');

  // Split-specific states
  const [splitMode, setSplitMode] = useState<'single' | 'custom'>('single');
  const [checkedPoints, setCheckedPoints] = useState<Record<number, boolean>>({});

  const pageCount = documents[0]?.pageCount || 1;

  const handleBack = () => {
    if (documents.length === 1 && activeWorkflow !== WorkflowType.NONE && activeWorkflow !== WorkflowType.MERGE) {
      // If single file uploaded via quick actions, go back to Home
      setView(AppView.HOME);
    } else {
      setView(AppView.DOCUMENT_LIST);
    }
  };

  const handleProcess = () => {
    // Enforce protection requirements if enabling protection
    if (protectionEnabled && !ownerPassword && !userPassword) {
      toast.error('Please enter at least an owner or user password.');
      return;
    }

    // Calculate target size in bytes
    let targetSizeBytes: number | undefined;
    if (targetSize) {
      const sizeNum = parseFloat(targetSize);
      if (!isNaN(sizeNum)) {
        targetSizeBytes = sizeNum * (targetUnit === 'MB' ? 1024 * 1024 : 1024);
      }
    } else if (activeWorkflow === WorkflowType.COMPRESS) {
      toast.error('Please enter a target size for compression.');
      return;
    }

    // Calculate split points
    let splitPoints: number[] | undefined = undefined;
    if (activeWorkflow === WorkflowType.SPLIT) {
      if (splitMode === 'single') {
        splitPoints = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
      } else {
        splitPoints = Object.keys(checkedPoints)
          .map(Number)
          .filter((k) => checkedPoints[k]);
        if (splitPoints.length === 0) {
          toast.error('Please select at least one page boundary to split.');
          return;
        }
      }
    }

    // Update output options in store
    updateOutputOptions({
      filename,
      format,
      targetSize: targetSizeBytes,
      pdfPageSize: pageSize,
      imageDpi: dpi,
      mergeAsSingle: activeWorkflow === WorkflowType.MERGE ? true : mergeAsSingle,
      protection: {
        enabled: protectionEnabled,
        ownerPassword: protectionEnabled ? ownerPassword : undefined,
        userPassword: protectionEnabled ? userPassword : undefined,
      },
      splitPoints,
    });

    // Navigate to processing
    setView(AppView.PROCESSING);
  };

  const getHeaderContent = () => {
    switch (activeWorkflow) {
      case WorkflowType.COMPRESS:
        return { title: 'Compress PDF Settings', desc: 'Configure size compression parameters' };
      case WorkflowType.MERGE:
        return { title: 'Merge PDF Settings', desc: 'Configure output properties for merged document' };
      case WorkflowType.CONVERT:
        return { title: 'Convert Document Settings', desc: 'Configure destination format and quality' };
      case WorkflowType.SPLIT:
        return { title: 'Split PDF Settings', desc: 'Configure page splitting points' };
      case WorkflowType.PROTECT:
        return { title: 'Protect PDF Settings', desc: 'Configure document security passwords' };
      default:
        return { title: 'Output Options', desc: 'Configure how your documents will be processed' };
    }
  };

  const { title: headerTitle, desc: headerDesc } = getHeaderContent();

  const showFormatSelector = activeWorkflow === WorkflowType.NONE || activeWorkflow === WorkflowType.CONVERT;
  const showTargetSize = activeWorkflow === WorkflowType.COMPRESS || (activeWorkflow === WorkflowType.NONE && format === OutputFormat.PDF);
  const showPageSize = format === OutputFormat.PDF && activeWorkflow !== WorkflowType.SPLIT;
  const showDpi = [OutputFormat.JPEG, OutputFormat.PNG, OutputFormat.TIFF].includes(format);
  const showMergeOption = activeWorkflow === WorkflowType.NONE && documents.length > 1 && format === OutputFormat.PDF;
  const showProtectionSetting = activeWorkflow === WorkflowType.NONE && format === OutputFormat.PDF;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="border-b border-border bg-bg-surface">
        <div className="p-6 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft size={16} />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{headerTitle}</h1>
            <p className="text-sm text-text-secondary">
              {headerDesc}
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Output Filename */}
          <div>
            <Input
              label={activeWorkflow === WorkflowType.SPLIT ? "Output Filename Prefix" : "Output Filename"}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Enter output filename"
              fullWidth
            />
          </div>

          {/* Output Format */}
          {showFormatSelector && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Output Format
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as OutputFormat)}
                className="w-full px-3 py-2 bg-bg-sunken border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
              >
                {activeWorkflow !== WorkflowType.CONVERT && (
                  <option value={OutputFormat.PDF}>PDF</option>
                )}
                <option value={OutputFormat.JPEG}>JPEG</option>
                <option value={OutputFormat.PNG}>PNG</option>
                <option value={OutputFormat.TIFF}>TIFF</option>
                <option value={OutputFormat.DOCX}>DOCX</option>
              </select>
            </div>
          )}

          {/* Target File Size */}
          {showTargetSize && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Target File Size {activeWorkflow === WorkflowType.COMPRESS ? '(Required)' : '(Optional)'}
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={targetSize}
                  onChange={(e) => setTargetSize(e.target.value)}
                  placeholder={activeWorkflow === WorkflowType.COMPRESS ? "e.g. 500" : "Leave blank to skip compression"}
                  className="flex-1"
                />
                <select
                  value={targetUnit}
                  onChange={(e) => setTargetUnit(e.target.value as 'KB' | 'MB')}
                  className="px-3 py-2 bg-bg-sunken border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
                >
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                </select>
              </div>
            </div>
          )}

          {/* Split Settings */}
          {activeWorkflow === WorkflowType.SPLIT && (
            <div className="space-y-4 border border-border rounded-md p-4 bg-bg-surface">
              <h3 className="font-semibold text-text-primary text-sm">Split Settings</h3>
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="splitMode"
                    value="single"
                    checked={splitMode === 'single'}
                    onChange={() => setSplitMode('single')}
                    className="w-4 h-4 text-accent border-border"
                  />
                  <span className="text-sm text-text-primary font-medium">Split into single pages</span>
                </label>
                <p className="text-xs text-text-secondary pl-6">
                  Extracts every page into a separate PDF file (e.g. Part 1, Part 2...)
                </p>

                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="radio"
                    name="splitMode"
                    value="custom"
                    checked={splitMode === 'custom'}
                    onChange={() => setSplitMode('custom')}
                    className="w-4 h-4 text-accent border-border"
                  />
                  <span className="text-sm text-text-primary font-medium">Split at custom boundaries</span>
                </label>
                <p className="text-xs text-text-secondary pl-6">
                  Select the pages before which you want to split the PDF.
                </p>

                {splitMode === 'custom' && pageCount > 1 && (
                  <div className="pl-6 pt-2 space-y-2 max-h-[200px] overflow-y-auto border-t border-border mt-2">
                    {Array.from({ length: pageCount - 1 }, (_, i) => i + 2).map((pageNum) => (
                      <label key={pageNum} className="flex items-center gap-2 cursor-pointer py-1 hover:bg-bg-sunken rounded px-2">
                        <input
                          type="checkbox"
                          checked={!!checkedPoints[pageNum]}
                          onChange={(e) => {
                            setCheckedPoints({
                              ...checkedPoints,
                              [pageNum]: e.target.checked
                            });
                          }}
                          className="w-4 h-4 text-accent border-border rounded"
                        />
                        <span className="text-sm text-text-primary">
                          Split before Page {pageNum}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {splitMode === 'custom' && pageCount <= 1 && (
                  <p className="text-xs text-warning pl-6">
                    This PDF only has 1 page and cannot be split.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* PDF Page Size */}
          {showPageSize && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                PDF Page Size
              </label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as PdfPageSize)}
                className="w-full px-3 py-2 bg-bg-sunken border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
              >
                <option value={PdfPageSize.A4}>A4</option>
                <option value={PdfPageSize.LETTER}>Letter</option>
                <option value={PdfPageSize.LEGAL}>Legal</option>
              </select>
            </div>
          )}

          {/* DPI for images */}
          {showDpi && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                DPI (Dots Per Inch)
              </label>
              <select
                value={dpi}
                onChange={(e) => setDpi(parseInt(e.target.value) as 72 | 150 | 300 | 600)}
                className="w-full px-3 py-2 bg-bg-sunken border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
              >
                <option value={72}>72 DPI</option>
                <option value={150}>150 DPI</option>
                <option value={300}>300 DPI</option>
                <option value={600}>600 DPI</option>
              </select>
            </div>
          )}

          {/* Merge as Single */}
          {showMergeOption && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="merge-single"
                checked={mergeAsSingle}
                onChange={(e) => setMergeAsSingle(e.target.checked)}
                className="w-4 h-4 text-accent border-border rounded focus:ring-border-focus"
              />
              <label htmlFor="merge-single" className="text-sm text-text-primary cursor-pointer">
                Merge all documents into a single PDF
              </label>
            </div>
          )}

          {/* Protect PDF Workflow Passwords */}
          {activeWorkflow === WorkflowType.PROTECT && (
            <div className="border border-border rounded-md p-4 space-y-4 bg-bg-surface">
              <h3 className="font-semibold text-text-primary text-sm">Security Passwords</h3>
              <Input
                type="password"
                label="Owner Password (prevents editing)"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Enter password"
                fullWidth
              />
              <Input
                type="password"
                label="User Password (prevents opening)"
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="Enter password"
                fullWidth
              />
              <p className="text-xs text-warning">
                ⚠️ Warning: If you forget these passwords, the file cannot be recovered.
              </p>
            </div>
          )}

          {/* General PDF Protection */}
          {showProtectionSetting && (
            <div className="border border-border rounded-md p-4 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="protection-enabled"
                  checked={protectionEnabled}
                  onChange={(e) => setProtectionEnabled(e.target.checked)}
                  className="w-4 h-4 text-accent border-border rounded focus:ring-border-focus"
                />
                <label htmlFor="protection-enabled" className="text-sm font-medium text-text-primary cursor-pointer">
                  Password-protect PDF
                </label>
              </div>

              {protectionEnabled && (
                <>
                  <Input
                    type="password"
                    label="Owner Password (prevents editing)"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="Enter password"
                    fullWidth
                  />
                  <Input
                    type="password"
                    label="User Password (prevents opening)"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Enter password"
                    fullWidth
                  />
                  <p className="text-xs text-warning">
                    ⚠️ Warning: If you forget these passwords, the file cannot be recovered.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t border-border bg-bg-surface p-6">
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={handleBack}>
            Back
          </Button>
          <Button variant="primary" onClick={handleProcess}>
            Process & Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OutputScreen;
