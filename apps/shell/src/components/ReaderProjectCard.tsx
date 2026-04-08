import Link from 'next/link'
import { OptimizedImage } from './OptimizedImage'

interface ReaderProjectCardProps {
  href: string
  name: string
  coverImage: string | null
  description: string | null
  badge?: string | undefined
  children?: React.ReactNode
}

export function ReaderProjectCard({ href, name, coverImage, description, badge, children }: ReaderProjectCardProps) {
  return (
    <div className="group bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all overflow-hidden">
      <Link href={href}>
        <div className="aspect-[16/9] bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 relative overflow-hidden">
          {coverImage ? (
            <OptimizedImage
              src={coverImage}
              variant="thumb"
              alt={name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-4xl font-bold text-blue-300 dark:text-blue-700 opacity-50">
                {name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {badge && (
            <span className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
      </Link>
      <div className="p-4">
        <Link href={href}>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {name}
          </h3>
        </Link>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}
