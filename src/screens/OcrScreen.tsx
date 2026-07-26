import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { DocumentType } from '../types/Document.types';
import Button from '../components/ui/Button';
import { ArrowLeft, Copy, Download, FileText, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import Tesseract from 'tesseract.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish (Español)' },
  { code: 'fra', label: 'French (Français)' },
  { code: 'deu', label: 'German (Deutsch)' },
  { code: 'jpn', label: 'Japanese (日本語)' },
  { code: 'por', label: 'Portuguese (Português)' },
  { code: 'chi_sim', label: 'Chinese Simplified (简体中文)' },
];

export default function OcrScreen() {
  const setView = useAppStore((state) => state.setView);
  const documents = useAppStore((state) => state.documents);

  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [language, setLanguage] = useState<string>('eng');
  const [extractedText, setExtractedText] = useState<string>('');
  
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [pageWords, setPageWords] = useState<any[]>([]);
  const [timestamp, setTimestamp] = useState<number>(Date.now());

  const activeDoc = documents.find((d) => d.id === selectedDocId) || null;

  // Select first document by default
  useEffect(() => {
    if (documents.length > 0 && !selectedDocId) {
      setSelectedDocId(documents[0].id);
      setSelectedPage(1);
    }
  }, [documents, selectedDocId]);

  // Load preview image when document or page selection changes
  useEffect(() => {
    if (!selectedDocId) {
      setPreviewPath(null);
      return;
    }

    const loadPreview = async () => {
      try {
        if (activeDoc?.type === DocumentType.PDF) {
          const res = await window.electron.renderPdfPage(selectedDocId, selectedPage);
          if (res.success) {
            setPreviewPath(res.data);
            setTimestamp(Date.now());
          } else {
            setPreviewPath(null);
          }
        } else if (activeDoc?.type === DocumentType.IMAGE) {
          setPreviewPath(activeDoc.tempPath);
          setTimestamp(Date.now());
        }
      } catch (err) {
        console.error('Failed to load OCR page preview', err);
        setPreviewPath(null);
      }
    };

    loadPreview();
  }, [selectedDocId, selectedPage, activeDoc]);

  const handleRunOcr = async () => {
    if (!previewPath) {
      toast.error('No page preview available to OCR.');
      return;
    }

    setIsProcessing(true);
    setOcrProgress(0);
    setOcrStatus('Initializing OCR engine...');
    setExtractedText('');
    setPageWords([]);

    try {
      // Use clean docuflow URL protocol for local file system previews
      const imageUrl = `docuflow:///${previewPath.replace(/\\/g, '/')}`;
      
      const result = (await Tesseract.recognize(imageUrl, language, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round(m.progress * 100));
            setOcrStatus(`Analyzing pixels... ${Math.round(m.progress * 100)}%`);
          } else {
            setOcrStatus(m.status);
          }
        },
      })) as any;

      if (result && result.data) {
        setExtractedText(result.data.text);
        setPageWords(result.data.words || []);
        toast.success('Text extraction complete!');
      } else {
        toast.error('No text detected on the page.');
      }
    } catch (err: any) {
      console.error('OCR Process error:', err);
      toast.error(`OCR Failed: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
      setOcrStatus('');
    }
  };

  const handleCopyToClipboard = () => {
    if (!extractedText) return;
    navigator.clipboard.writeText(extractedText);
    toast.success('Text copied to clipboard!');
  };

  const handleDownloadTxt = async () => {
    if (!extractedText) return;
    
    try {
      // Base64 encode the string for unicode support
      const base64Text = btoa(unescape(encodeURIComponent(extractedText)));
      const filename = activeDoc 
        ? `${activeDoc.filename.substring(0, activeDoc.filename.lastIndexOf('.'))}_extracted.txt`
        : 'extracted_text.txt';

      const res = await window.electron.saveFileFromBase64(
        `data:text/plain;base64,${base64Text}`,
        filename,
        [{ name: 'Text Files', extensions: ['txt'] }]
      );

      if (res.success) {
        toast.success('Text file saved successfully!');
      }
    } catch (err) {
      toast.error('Failed to export TXT file');
    }
  };

  const handleDownloadSearchablePdf = async () => {
    if (!previewPath || pageWords.length === 0) {
      toast.error('Please run OCR extraction on this page first.');
      return;
    }

    setIsProcessing(true);
    setOcrStatus('Generating searchable PDF overlay...');

    try {
      // 1. Fetch image bytes
      const imageUrl = `docuflow:///${previewPath.replace(/\\/g, '/')}`;
      const imgResponse = await fetch(imageUrl);
      const imgBlob = await imgResponse.blob();
      const arrayBuffer = await imgBlob.arrayBuffer();
      const imageBytes = new Uint8Array(arrayBuffer);

      // 2. Setup pdf-lib document
      const pdfDoc = await PDFDocument.create();
      let embeddedImage;
      let width = 0;
      let height = 0;

      // Handle PNG/JPEG embedding
      const isPng = previewPath.toLowerCase().endsWith('.png');
      if (isPng) {
        embeddedImage = await pdfDoc.embedPng(imageBytes);
      } else {
        embeddedImage = await pdfDoc.embedJpg(imageBytes);
      }
      
      width = embeddedImage.width;
      height = embeddedImage.height;

      // 3. Create PDF Page and draw image
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width,
        height,
      });

      // 4. Draw transparent text overlay over the words for searchability
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      pageWords.forEach((word) => {
        if (!word.text || !word.bbox) return;

        const { x0, y0, y1 } = word.bbox;
        const wordHeight = y1 - y0;

        // Invert Y coordinate since PDF starts at bottom-left and image starts at top-left
        const pdfX = x0;
        const pdfY = height - y1;

        // Draw invisible/transparent text exactly over the word
        page.drawText(word.text, {
          x: pdfX,
          y: pdfY,
          size: wordHeight * 0.85,
          font,
          opacity: 0, // Invisibility overlay for searchable select-and-copy behavior
        });
      });

      // 5. Save and Export
      const pdfBytes = await pdfDoc.save();
      const base64Pdf = btoa(
        new Uint8Array(pdfBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const defaultName = activeDoc
        ? `${activeDoc.filename.substring(0, activeDoc.filename.lastIndexOf('.'))}_searchable.pdf`
        : 'searchable_page.pdf';

      const res = await window.electron.saveFileFromBase64(
        `data:application/pdf;base64,${base64Pdf}`,
        defaultName,
        [{ name: 'PDF Documents', extensions: ['pdf'] }]
      );

      if (res.success) {
        toast.success('Searchable PDF saved successfully!');
      }
    } catch (err: any) {
      console.error('Failed to generate searchable PDF:', err);
      toast.error(`PDF Generation failed: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
      setOcrStatus('');
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in bg-bg-base overflow-hidden">
      {/* Header */}
      <div className="border-b border-border bg-bg-surface flex-shrink-0">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setView(AppView.HOME)}>
              <ArrowLeft size={16} />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <FileText size={20} className="text-accent" />
                Offline OCR Text Extractor
              </h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Extract copyable text from scans locally using Tesseract OCR.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Screen Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Side: Document List and Configuration */}
        <div className="w-80 border-r border-border bg-bg-surface flex flex-col p-6 flex-shrink-0 gap-5 overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Select Document
            </label>
            {documents.length > 0 ? (
              <select
                value={selectedDocId}
                onChange={(e) => {
                  setSelectedDocId(e.target.value);
                  setSelectedPage(1);
                }}
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
              >
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.filename} ({doc.type})
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-bg-sunken rounded border border-border text-center text-xs text-text-muted">
                No documents uploaded. Go to Home to add some images or PDFs first.
              </div>
            )}
          </div>

          {activeDoc && activeDoc.type === DocumentType.PDF && (
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Select Page ({selectedPage} / {activeDoc.pageCount})
              </label>
              <div className="flex gap-2 items-center">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedPage <= 1 || isProcessing}
                  onClick={() => setSelectedPage(p => p - 1)}
                  className="flex-1 justify-center"
                >
                  Prev
                </Button>
                <span className="text-xs font-mono font-bold text-text-primary px-2">
                  Page {selectedPage}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedPage >= (activeDoc.pageCount || 1) || isProcessing}
                  onClick={() => setSelectedPage(p => p + 1)}
                  className="flex-1 justify-center"
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Recognition Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            className="w-full justify-center py-2.5 bg-accent hover:bg-accent-focus text-white font-semibold shadow-sm"
            onClick={handleRunOcr}
            disabled={isProcessing || !previewPath}
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Sparkles size={16} className="mr-2" />
                Run OCR Text Extraction
              </>
            )}
          </Button>

          {isProcessing && (
            <div className="space-y-2 animate-fade-in">
              <span className="text-xs font-medium text-text-secondary block">
                {ocrStatus}
              </span>
              <div className="w-full h-2 bg-bg-sunken rounded-full overflow-hidden border border-border">
                <div 
                  className="h-full bg-accent transition-all duration-normal" 
                  style={{ width: `${ocrProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="p-4 bg-bg-sunken border border-border rounded-xl text-xs text-text-secondary space-y-2">
            <p className="font-semibold text-accent flex items-center gap-1.5">
              <AlertCircle size={14} /> Offline Security
            </p>
            <p className="leading-relaxed">
              DocuFlow executes all OCR tasks completely offline. None of your sensitive document contents or processed text files are ever sent to any remote servers.
            </p>
          </div>
        </div>

        {/* Right Side: Split Screen Workspace */}
        <div className="flex-1 flex overflow-hidden min-h-0 bg-bg-base">
          {/* Main Workspace Split */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
            {/* Split Page Preview */}
            <div className="flex-1 border-r border-border flex flex-col p-6 overflow-hidden min-h-0">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Page Preview</span>
              <div className="flex-1 bg-bg-sunken rounded-xl border border-border flex items-center justify-center p-4 relative overflow-hidden bg-white shadow-inner">
                {previewPath ? (
                  <img
                    src={`docuflow:///${previewPath.replace(/\\/g, '/')}?t=${timestamp}`}
                    alt="OCR Preview"
                    className="max-w-full max-h-full object-contain rounded shadow bg-white p-1 select-none"
                  />
                ) : (
                  <div className="text-center p-4 text-text-muted italic text-xs">
                    Select a document to preview
                  </div>
                )}
              </div>
            </div>

            {/* Split Extracted Text Editor */}
            <div className="flex-1 flex flex-col p-6 overflow-hidden min-h-0">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Extracted Text</span>
                <div className="flex gap-2">
                  <button
                    disabled={!extractedText}
                    onClick={handleCopyToClipboard}
                    className={`p-1.5 rounded border border-border transition-fast ${extractedText ? 'bg-bg-surface hover:bg-bg-sunken text-text-primary hover:text-accent cursor-pointer' : 'text-text-muted opacity-55 cursor-not-allowed'}`}
                    title="Copy to Clipboard"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    disabled={!extractedText}
                    onClick={handleDownloadTxt}
                    className={`p-1.5 rounded border border-border transition-fast ${extractedText ? 'bg-bg-surface hover:bg-bg-sunken text-text-primary hover:text-accent cursor-pointer' : 'text-text-muted opacity-55 cursor-not-allowed'}`}
                    title="Download as TXT file"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-bg-surface rounded-xl border border-border flex flex-col overflow-hidden shadow-sm">
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  className="flex-1 w-full p-4 font-mono text-sm leading-relaxed text-text-primary bg-transparent outline-none border-none resize-none overflow-y-auto"
                  placeholder="Click 'Run OCR Text Extraction' to see output here. You can manually edit or copy the result afterwards."
                  disabled={isProcessing}
                />
                <div className="border-t border-border bg-bg-sunken px-4 py-3 flex justify-between items-center flex-shrink-0">
                  <span className="text-[10px] font-mono text-text-muted uppercase">
                    Characters: {extractedText.length} • Words: {extractedText.split(/\s+/).filter(Boolean).length}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownloadSearchablePdf}
                    disabled={isProcessing || pageWords.length === 0}
                    className="text-xs font-semibold"
                  >
                    Generate Searchable PDF
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
