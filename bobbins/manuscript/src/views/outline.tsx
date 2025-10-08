import type { BobbinrySDK } from '@bobbinry/sdk'

interface OutlineViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
}

/**
 * Outline View for Manuscript bobbin
 * Displays container hierarchy
 */
export default function OutlineView(_props: OutlineViewProps) {
  return (
    <div className="p-8 text-center">
      <div className="text-gray-500 dark:text-gray-400">
        <p className="mb-4">The Outline view is provided by the Navigation panel.</p>
        <p className="text-sm">Use the left panel to browse and organize your manuscript structure.</p>
      </div>
    </div>
  )
}
