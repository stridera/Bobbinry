import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { ProjectPublisherDashboard } from './ProjectPublisherDashboard'

export default async function ProjectPublishPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  const { projectId } = await params

  return (
    <ProjectPublisherDashboard
      user={session.user}
      apiToken={(session as any).apiToken}
      projectId={projectId}
    />
  )
}
