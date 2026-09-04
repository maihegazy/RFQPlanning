import { Modal } from './ui'
import HardwareCatalogManager from './HardwareCatalogManager'

/**
 * The hardware catalog in a modal, opened from the Hardware planning tab so
 * the catalog can be edited without leaving a project. The full-page version
 * lives at /hardware-catalog (HardwareCatalogPage).
 */
export default function HardwareCatalogModal({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged?: () => void
}) {
  return (
    <Modal title="Hardware Catalog" onClose={onClose} size="xl">
      <HardwareCatalogManager onChanged={onChanged} />
    </Modal>
  )
}
