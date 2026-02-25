/**
 * Reader Layout
 *
 * Minimal layout for the reading experience - no shell sidebar/toolbar.
 * Provides a clean, distraction-free reading environment.
 */
export default function ReaderLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {children}
    </div>
  )
}
