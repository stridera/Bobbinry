import { redirect } from 'next/navigation'
import { auth } from '@/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user?.badges?.includes('owner')) {
    redirect('/dashboard')
  }

  return <>{children}</>
}
