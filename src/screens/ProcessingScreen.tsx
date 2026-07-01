import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { ProcessingStep } from '../types/Output.types';
import ProgressBar from '../components/ui/ProgressBar';
import Button from '../components/ui/Button';

function ProcessingScreen() {
  const documents = useAppStore((state) => state.documents);
  const outputOptions = useAppStore((state) => state.outputOptions);
  const setView = useAppStore((state) => state.setView);
  const setProcessingStatus = useAppStore((state) => state.setProcessingStatus);

  const [currentStep, setCurrentStep] = useState<ProcessingStep>(ProcessingStep.VALIDATING);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Track whether processing has started — prevents double-execution in StrictMode
  const hasStarted = useRef(false);

  const steps = [
    { step: ProcessingStep.VALIDATING,    label: 'Validating documents' },
    { step: ProcessingStep.APPLYING_EDITS,label: 'Applying edits' },
    { step: ProcessingStep.COMPRESSING,   label: 'Processing' },
    { step: ProcessingStep.CONVERTING,    label: 'Converting format' },
    { step: ProcessingStep.SAVING,        label: 'Saving output' },
    { step: ProcessingStep.COMPLETE,      label: 'Complete' },
  ];

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const processDocuments = async () => {
      try {
        setCurrentStep(ProcessingStep.VALIDATING);
        setProgress(10);
        await new Promise((resolve) => setTimeout(resolve, 300));

        setCurrentStep(ProcessingStep.APPLYING_EDITS);
        setProgress(30);
        await new Promise((resolve) => setTimeout(resolve, 300));

        setCurrentStep(ProcessingStep.COMPRESSING);
        setProgress(55);
        await new Promise((resolve) => setTimeout(resolve, 300));

        setCurrentStep(ProcessingStep.SAVING);
        setProgress(80);

        // Call backend to process documents
        const documentIds = documents.map((d) => d.id);
        const result = await window.electron.processOutput(documentIds, outputOptions);

        if (result.success) {
          setProgress(100);
          setCurrentStep(ProcessingStep.COMPLETE);

          // Store output path & size in the store so SuccessScreen can read them
          // Use the store action to avoid calling setState inside a component
          setProcessingStatus({
            step: ProcessingStep.COMPLETE,
            progress: 100,
            totalFiles: documents.length,
            processedFiles: documents.length,
            outputPath: result.data.outputPath,
            outputSize: result.data.outputSize,
          });

          // Also persist to recent files via IPC so it survives restart
          try {
            const filename = result.data.outputPath.split(/[\\/]/).pop() || outputOptions.filename;
            await window.electron.addRecentFile({
              filename,
              path: result.data.outputPath,
              timestamp: Date.now(),
              operation: outputOptions.mergeAsSingle ? 'merge'
                : (outputOptions.compress || outputOptions.targetSize) ? 'compress'
                : outputOptions.protection?.enabled ? 'protect'
                : outputOptions.splitPoints?.length ? 'split'
                : 'convert',
            });
          } catch {
            // Non-critical
          }

          toast.success('Processing complete!');

          setTimeout(() => setView(AppView.SUCCESS), 1000);
        } else {
          setError(result.error.message);
          setCurrentStep(ProcessingStep.ERROR);
          toast.error(result.error.message);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Processing failed';
        setError(msg);
        setCurrentStep(ProcessingStep.ERROR);
        toast.error('Processing failed');
      }
    };

    processDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => setView(AppView.OUTPUT_OPTIONS);

  const getStepIcon = (step: ProcessingStep) => {
    const stepIndex = steps.findIndex((s) => s.step === step);
    const currentStepIndex = steps.findIndex((s) => s.step === currentStep);

    if (currentStep === ProcessingStep.ERROR) {
      return <XCircle size={20} className="text-error" />;
    }
    if (stepIndex < currentStepIndex || currentStep === ProcessingStep.COMPLETE) {
      return <CheckCircle2 size={20} className="text-success" />;
    }
    if (stepIndex === currentStepIndex) {
      return <Loader2 size={20} className="animate-spin text-accent" />;
    }
    return <div className="w-5 h-5 rounded-full border-2 border-border" />;
  };

  return (
    <div className="h-full flex items-center justify-center p-12">
      <div className="w-full max-w-2xl">
        <div className="bg-bg-surface rounded-xl border border-border p-8 space-y-8 animate-fade-in">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-text-primary mb-2">
              {currentStep === ProcessingStep.COMPLETE ? 'Processing Complete!' : 'Processing Documents'}
            </h1>
            <p className="text-text-secondary">
              {currentStep === ProcessingStep.ERROR
                ? 'An error occurred during processing'
                : currentStep === ProcessingStep.COMPLETE
                ? 'Your documents have been processed successfully'
                : 'Please wait while we process your documents'}
            </p>
          </div>

          {/* Progress Bar */}
          {currentStep !== ProcessingStep.ERROR && (
            <ProgressBar progress={progress} showPercentage />
          )}

          {/* Steps */}
          <div className="space-y-3">
            {steps
              .filter((s) => s.step !== ProcessingStep.ERROR)
              .map((step) => (
                <div key={step.step} className="flex items-center gap-3">
                  {getStepIcon(step.step)}
                  <span
                    className={`text-sm ${
                      step.step === currentStep
                        ? 'text-text-primary font-medium'
                        : 'text-text-secondary'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-error-light border border-error rounded-md">
              <p className="text-sm text-error font-medium mb-1">Error</p>
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center">
            {currentStep !== ProcessingStep.COMPLETE && currentStep !== ProcessingStep.ERROR && (
              <Button variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
            )}
            {currentStep === ProcessingStep.ERROR && (
              <Button variant="primary" onClick={() => setView(AppView.OUTPUT_OPTIONS)}>
                Try Again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProcessingScreen;
