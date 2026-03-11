import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { TrashContent } from './TrashContent'

export default async function TrashPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return <TrashContent apiToken={(session as any).apiToken} />
}
