import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import ProjectsPage from './pages/ProjectsPage'
import ProjectPage from './pages/ProjectPage'
import PortfolioPage from './pages/PortfolioPage'
import HardwareCatalogPage from './pages/HardwareCatalogPage'
import HardwareOverviewPage from './pages/HardwareOverviewPage'
import HwProjectsPage from './pages/HwProjectsPage'
import HwProjectPage from './pages/HwProjectPage'
import HwProcessPage from './pages/HwProcessPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/hardware-catalog" element={<HardwareCatalogPage />} />
        <Route path="/hardware" element={<HardwareOverviewPage />} />
        <Route path="/hardware/process" element={<HwProcessPage />} />
        <Route path="/hardware/projects" element={<HwProjectsPage />} />
        <Route path="/hardware/projects/:hwProjectId" element={<HwProjectPage />} />
        <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
