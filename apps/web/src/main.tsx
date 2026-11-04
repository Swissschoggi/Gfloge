import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from './routes'

// One design system (DESIGN.md): tokens first, then base, shell, map, screens.
// Typography is the platform's system-ui, so there are no webfonts to load.
import '@gfloge/design/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/map.css'
import './styles/screens.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Router />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
