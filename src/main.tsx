// Precisa vir primeiro: lê o erro de login da URL antes do Supabase mexer nela.
import './core/access'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
