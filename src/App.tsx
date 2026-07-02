import { Toaster } from 'react-hot-toast';
import { useAppStore } from './store/appStore';
import { AppView } from './types/UI.types';
import MainLayout from './components/layout/MainLayout';
import HomeScreen from './screens/HomeScreen';
import DocumentListScreen from './screens/DocumentListScreen';
import OutputScreen from './screens/OutputScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import SuccessScreen from './screens/SuccessScreen';
import PreviewScreen from './screens/PreviewScreen';
import ScannerModal from './components/scanner/ScannerModal';
import DocumentPreviewModal from './components/document/DocumentPreviewModal';
import AddMoreModal from './components/document/AddMoreModal';
import InAppConfirmModal from './components/ui/InAppConfirmModal';

function App() {
  const currentView = useAppStore((state) => state.ui.currentView);

  const renderScreen = () => {
    switch (currentView) {
      case AppView.HOME:
        return <HomeScreen />;
      case AppView.DOCUMENT_LIST:
        return <DocumentListScreen />;
      case AppView.OUTPUT_OPTIONS:
        return <OutputScreen />;
      case AppView.PROCESSING:
        return <ProcessingScreen />;
      case AppView.SUCCESS:
        return <SuccessScreen />;
      case AppView.PREVIEW:
        return <PreviewScreen />;
      default:
        return <HomeScreen />;
    }
  };

  return (
    <>
      <MainLayout>{renderScreen()}</MainLayout>
      <ScannerModal />
      <DocumentPreviewModal />
      <AddMoreModal />
      <InAppConfirmModal />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#FFFFFF',
            color: '#1C1917',
            border: '1px solid #D9D6D1',
            borderRadius: '8px',
            fontSize: '15px',
          },
          success: {
            iconTheme: {
              primary: '#16A34A',
              secondary: '#FFFFFF',
            },
          },
          error: {
            iconTheme: {
              primary: '#DC2626',
              secondary: '#FFFFFF',
            },
          },
        }}
      />
    </>
  );
}

export default App;
