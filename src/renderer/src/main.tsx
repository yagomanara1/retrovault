import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui/Toast';
import { applyMotionPreference } from './hooks/useMotionPreference';
import { isApiError } from './lib/api';
import './styles/index.css';

// O main avisa (?material=acrylic) quando a janela tem o material translúcido do Windows 11;
// sem ele, a barra lateral fica sólida em vez de "vazar" um fundo transparente.
const material = new URLSearchParams(window.location.search).get('material');
if (material) document.documentElement.dataset.material = material;
applyMotionPreference();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      // Erros de configuração/validação não melhoram com retry.
      retry: (failureCount, error) =>
        !isApiError(error, 'RA_NOT_CONFIGURED', 'RA_AUTH', 'NOT_FOUND', 'VALIDATION', 'FORBIDDEN', 'RATE_LIMITED') && failureCount < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
