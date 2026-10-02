import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PwaProvider } from './context/PwaContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import './styles/tokens.css';
import './styles/globals.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <PwaProvider>
              <App />
            </PwaProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
