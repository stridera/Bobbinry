import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { DashboardContent } from './DashboardContent'

/**
 * Dashboard Page
 *
 * Campfire-style project dashboard with:
 * - Project cards grouped by collections
 * - Recent activity panel
 * - Search and filters
 */

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return <DashboardContent user={session.user} />
}
