import { Navigate, Route, Routes } from 'react-router-dom'
import ProjectsPage from './pages/ProjectsPage'
import ProjectPage from './pages/ProjectPage'
import PortfolioPage from './pages/PortfolioPage'
import HardwareCatalogPage from './pages/HardwareCatalogPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/portfolio" element={<PortfolioPage />} />
      <Route path="/hardware-catalog" element={<HardwareCatalogPage />} />
      <Route path="/projects/:projectId/*" element={<ProjectPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
