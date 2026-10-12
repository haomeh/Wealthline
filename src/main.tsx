import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'

// index.html hid the prerendered sign-in page for a reload while signed in; the app decides from here.
document.documentElement.classList.remove('restoring')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
