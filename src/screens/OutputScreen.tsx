import { useState, useEffect } from 'react';
import { ArrowLeft, FileText, XCircle, Eye } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView, WorkflowType } from '../types/UI.types';
import { OutputFormat, PdfPageSize, CompressionLevel } from '../types/Output.types';
import { DocumentType } from '../types/Document.types';
import { formatFileSize } from '../utils/formatFileSize';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

function OutputScreen() {
  const documents = useAppStore((state) => state.documents);
  const outputOptions = useAppStore((state) => state.outputOptions);
  const updateOutputOptions = useAppStore((state) => state.updateOutputOptions);
  const setView = useAppStore((state) => state.setView);
  const setSelectedDocument = useAppStore((state) => state.setSelectedDocument);
  const setPreviewBackView = useAppStore((state) => state.setPreviewBackView);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const clearDocuments = useAppStore((state) => state.clearDocuments);

  const [filename, setFilename] = useState(outputOptions.filename);
  const [format, setFormat] = useState(() => {
    if (activeWorkflow === WorkflowType.CONVERT) {
      return OutputFormat.JPEG; // Default export format for conversion
    }
    return OutputFormat.PDF;
  });
  const totalOriginalSize = documents.reduce((sum, d) => sum + d.size, 0);
  const [compressionOption, setCompressionOption] = useState<string>(() => {
    if (activeWorkflow === WorkflowType.COMPRESS) {
      return outputOptions.compressionLevel || 'medium';
    }
    return outputOptions.compress ? (outputOptions.compressionLevel || 'medium') : 'none';
  });
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

  // Preview panel states
  const [activeDocIndex, setActiveDocIndex] = useState(0);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false);

  const activeDoc = documents[activeDocIndex];

  // Load all preview page images effect
  useEffect(() => {
    let active = true;
    const loadAllPages = async () => {
      if (!activeDoc) return;
      setIsLoadingPreview(true);
      try {
        const images: Record<number, string> = {};
        for (let p = 1; p <= activeDoc.pageCount; p++) {
          if (activeDoc.cleanTempPaths?.[p]) {
            images[p] = activeDoc.cleanTempPaths[p];
          } else if (activeDoc.type === DocumentType.PDF) {
            const res = await window.electron.renderPdfPage(activeDoc.id, p);
            if (res.success && res.data) {
              images[p] = res.data;
            }
          } else {
            images[p] = activeDoc.tempPath;
          }
        }
        if (active) {
          setPageImages(images);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setIsLoadingPreview(false);
      }
    };
    loadAllPages();
    return () => {
      active = false;
    };
  }, [activeDocIndex, activeDoc]);

  // Keyboard navigation for vertical scroll preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events if user is typing in forms
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      const scrollContainer = document.getElementById('preview-scroll-container');
      if (!scrollContainer) return;

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        scrollContainer.scrollBy({ top: 220, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        scrollContainer.scrollBy({ top: -220, behavior: 'smooth' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeDocIndex]);

  const handleBack = () => {
    if (documents.length === 1 && activeWorkflow !== WorkflowType.NONE && activeWorkflow !== WorkflowType.MERGE) {
      // If single file uploaded via quick actions, go back to Home
      setView(AppView.HOME);
    } else {
      setView(AppView.DOCUMENT_LIST);
    }
  };

  const handleCancelSession = async () => {
    const confirmed = await window.electron.showConfirmDialog(
      'Are you sure you want to cancel this session? All uploaded files will be discarded.',
      'Cancel Session'
    );
    if (!confirmed) return;

    await window.electron.clearTemp().catch(() => {});
    clearDocuments();
    toast.success('Session cancelled');
    setView(AppView.HOME);
  };

  const handleProcess = () => {
    // Enforce protection requirements if enabling protection
    if (protectionEnabled && !ownerPassword && !userPassword) {
      toast.error('Please enter at least an owner or user password.');
      return;
    }

    const isCompressEnabled = compressionOption !== 'none';
    const compressionLevel = isCompressEnabled ? (compressionOption as CompressionLevel) : undefined;

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
      compress: activeWorkflow === WorkflowType.COMPRESS || isCompressEnabled,
      compressionLevel,
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

  const PreviewPanel = () => {
    if (!activeDoc) {
      return (
        <div className="flex-grow flex items-center justify-center text-xs text-text-muted italic select-none">
          No document loaded
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        {/* Document Selector Header if multiple files */}
        {documents.length > 1 && (
          <div className="p-3 bg-bg-surface border-b border-border flex items-center gap-2 flex-shrink-0 select-none">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Document:</span>
            <select
              value={activeDocIndex}
              onChange={(e) => {
                setActiveDocIndex(parseInt(e.target.value));
              }}
              className="flex-1 px-2.5 py-1 text-xs bg-bg-sunken border border-border rounded focus:outline-none font-medium cursor-pointer"
            >
              {documents.map((d, index) => (
                <option key={d.id} value={index}>
                  {d.filename}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Vertical scrollable gallery preview */}
        <div
          id="preview-scroll-container"
          className="flex-1 relative overflow-y-auto overflow-x-hidden flex flex-col items-center gap-6 p-6 no-scrollbar snap-y snap-mandatory scroll-smooth min-h-0 h-full"
        >
          {isLoadingPreview ? (
            <div className="absolute inset-0 bg-black/5 flex flex-col items-center justify-center gap-2 z-10">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-text-secondary font-medium">Loading Document Pages...</span>
            </div>
          ) : null}

          {Array.from({ length: activeDoc.pageCount }, (_, idx) => {
            const pNum = idx + 1;
            const path = pageImages[pNum];
            return (
              <div
                key={pNum}
                className="flex-shrink-0 w-[240px] lg:w-[280px] xl:w-[320px] snap-center flex flex-col items-center gap-3 select-none"
              >
                <div className="relative aspect-[3/4] w-full shadow-lg rounded-lg border border-border/60 bg-white overflow-hidden flex items-center justify-center p-2 hover:border-accent/40 transition-colors">
                  {path ? (
                    <img
                      src={`docuflow:///${path.replace(/\\/g, '/')}?t=${Date.now()}`}
                      alt={`Page ${pNum}`}
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  ) : (
                    <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <span className="text-xs font-semibold text-text-secondary font-mono bg-bg-surface px-2.5 py-1 rounded-full border border-border shadow-sm">
                  Page {pNum} of {activeDoc.pageCount}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const showFormatSelector = activeWorkflow === WorkflowType.NONE || activeWorkflow === WorkflowType.CONVERT;
  const showTargetSize = activeWorkflow === WorkflowType.COMPRESS || (activeWorkflow === WorkflowType.NONE && format === OutputFormat.PDF);
  const showPageSize = format === OutputFormat.PDF && activeWorkflow !== WorkflowType.SPLIT && activeWorkflow !== WorkflowType.COMPRESS;
  const showDpi = [OutputFormat.JPEG, OutputFormat.PNG, OutputFormat.TIFF].includes(format);
  const showMergeOption = activeWorkflow === WorkflowType.NONE && documents.length > 1 && format === OutputFormat.PDF;
  const showProtectionSetting = activeWorkflow === WorkflowType.NONE && format === OutputFormat.PDF;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="border-b border-border bg-bg-surface flex-shrink-0">
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

      {/* Split Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Left Side: Export Form */}
        <div className="flex-1 overflow-auto p-6 border-r border-border">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Small Screen View Preview Button */}
            <div className="md:hidden">
              <Button
                variant="secondary"
                className="w-full justify-center text-xs py-2 bg-accent-light/10 border-accent/20 text-accent hover:bg-accent-light/20 flex items-center gap-2"
                onClick={() => setIsMobilePreviewOpen(true)}
              >
                <Eye size={14} />
                Preview Document ({documents.length} File{documents.length > 1 ? 's' : ''})
              </Button>
            </div>

            {/* Uploaded Document Info Card */}
            {documents.length > 0 && (
              <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {documents.length === 1 ? 'Uploaded Document' : 'Uploaded Documents'}
                </p>
                {documents.length === 1 ? (
                  <div className="flex gap-4 items-center">
                    <div className="w-12 h-16 bg-bg-sunken rounded border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                      {documents[0].thumbnailPath ? (
                        <img
                          src={`docuflow:///${documents[0].thumbnailPath.replace(/\\/g, '/')}`}
                          alt="Thumbnail"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileText size={24} className="text-error" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary truncate mb-1">
                        {documents[0].filename}
                      </h3>
                      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-text-secondary font-mono">
                        <span>Size: {formatFileSize(documents[0].size)}</span>
                        <span>•</span>
                        <span>Pages: {documents[0].pageCount}</span>
                      </div>
                    </div>
                    {/* Keep the full-screen editor preview option as well */}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedDocument(documents[0].id);
                        setPreviewBackView(AppView.OUTPUT_OPTIONS);
                        setView(AppView.PREVIEW);
                      }}
                    >
                      Edit Document
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-[160px] overflow-y-auto space-y-2 pr-2">
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex gap-3 items-center py-1 border-b border-border last:border-0">
                        <FileText size={16} className="text-error flex-shrink-0" />
                        <span className="text-sm font-medium text-text-primary truncate flex-1">{doc.filename}</span>
                        <span className="text-xs text-text-muted font-mono">{formatFileSize(doc.size)}</span>
                        <span className="text-xs text-text-muted font-mono">{doc.pageCount} p.</span>
                      </div>
                    ))}
                    <div className="pt-2 text-xs font-semibold text-text-secondary border-t border-border flex justify-between">
                      <span>Total Files: {documents.length}</span>
                      <span>Total Size: {formatFileSize(documents.reduce((s, d) => s + d.size, 0))}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            
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
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
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

            {/* Convert format info banner */}
            {showFormatSelector && format !== OutputFormat.PDF && (
              <div className="p-4 bg-bg-sunken border border-border/80 rounded-md flex gap-3 animate-fade-in shadow-sm">
                <span className="text-accent text-lg leading-none">ℹ️</span>
                <div>
                  <p className="text-sm font-semibold text-text-primary mb-1">
                    {format === OutputFormat.DOCX ? 'Word Document Export' : `${format} Image Export`}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {format === OutputFormat.DOCX ? (
                      'For layout and image preservation, make sure pdf2docx is installed (pip install pdf2docx). Otherwise, a native text-extraction fallback is used.'
                    ) : (
                      `Multi-page documents will be exported as individual ${format} files in your selected destination folder.`
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Compression Level Selector */}
            {showTargetSize && (
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Compression Level {activeWorkflow === WorkflowType.COMPRESS ? '(Required)' : '(Optional)'}
                </label>
                <select
                  value={compressionOption}
                  onChange={(e) => setCompressionOption(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus text-base"
                >
                  {activeWorkflow !== WorkflowType.COMPRESS && (
                    <option value="none">None — Keep original size</option>
                  )}
                  <option value="low">Low (~{formatFileSize(totalOriginalSize * 0.8)}) — Best quality</option>
                  <option value="medium">Medium (~{formatFileSize(totalOriginalSize * 0.5)}) — Balanced</option>
                  <option value="high">High (~{formatFileSize(totalOriginalSize * 0.3)}) — Space saver</option>
                  <option value="extreme">Extreme (~{formatFileSize(totalOriginalSize * 0.15)}) — Smallest size</option>
                </select>
                <p className="mt-1 text-xs text-text-muted">
                  Estimated sizes are approximate. Actual results will vary depending on document content.
                </p>
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
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
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
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
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

        {/* Right Side: Parallel Live Preview on md+ screens */}
        <div className="hidden md:flex w-[380px] lg:w-[480px] xl:w-[580px] bg-bg-sunken flex-col border-l border-border/40 flex-shrink-0">
          <PreviewPanel />
        </div>
      </div>

      {/* Mobile Modal for Preview on small screens */}
      {isMobilePreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:hidden animate-fade-in">
          <div className="bg-bg-surface w-full max-w-lg h-[80vh] rounded-xl flex flex-col overflow-hidden shadow-2xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0 select-none">
              <h3 className="font-semibold text-text-primary text-sm">Document Preview</h3>
              <button
                onClick={() => setIsMobilePreviewOpen(false)}
                className="text-text-muted hover:text-text-primary p-1 text-sm font-semibold"
              >
                ✕ Close
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-bg-sunken flex flex-col min-h-0">
              <PreviewPanel />
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="border-t border-border bg-bg-surface p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <Button variant="secondary" className="text-error hover:bg-error-light hover:border-error" onClick={handleCancelSession}>
            <XCircle size={16} className="mr-1.5" />
            Cancel Session
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
            <Button variant="primary" onClick={handleProcess}>
              Process & Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OutputScreen;
