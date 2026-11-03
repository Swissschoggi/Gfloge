import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from './routes'

// Self-hosted fonts (no CDN at runtime); bundled woff2 via fontsource.
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/instrument-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'

// Canonical tokens first, then metric-matched font fallbacks, then app CSS.
import '@gfloge/design/tokens.css'
import './styles/fonts.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/status.css'
import './styles/data.css'
import './styles/polish.css'

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
