import { redirect } from 'next/navigation'

// "Read" was merged into Library. Reader routes under /read/[authorUsername]/...
// are separate segments and keep working.
export default function ReadIndexPage() {
  redirect('/library')
}
