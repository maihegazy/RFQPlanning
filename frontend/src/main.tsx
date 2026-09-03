import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { VaultProvider } from './vault/VaultContext'
import { ThemeProvider } from './theme/ThemeContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <VaultProvider>
          <App />
        </VaultProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
