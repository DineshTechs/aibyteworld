import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ThemeProvider } from './context/ThemeContext';
import { UiProvider } from './context/UiContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ThemeProvider>
      <SettingsProvider>
        <AuthProvider>
          <UiProvider>
            <App />
          </UiProvider>
        </AuthProvider>
      </SettingsProvider>
    </ThemeProvider>
  </BrowserRouter>,
);
