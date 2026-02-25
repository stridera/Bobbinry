import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { PublishDashboard } from './PublishDashboard'

export default async function PublishPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return <PublishDashboard user={session.user} apiToken={(session as any).apiToken} />
}
