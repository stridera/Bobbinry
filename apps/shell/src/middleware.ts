/**
 * NextAuth Middleware for Protected Routes
 *
 * Protects routes and redirects unauthenticated users to login
 */

import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/signup', '/api']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))

  // Public reader routes (e.g., /p/shorturl or /public/...)
  const isPublicReader = pathname.startsWith('/p/') || pathname.startsWith('/c/') || pathname.startsWith('/public/')

  if (!isLoggedIn && !isPublicRoute && !isPublicReader) {
    // Redirect to login, preserving the intended destination
    const callbackUrl = encodeURIComponent(pathname)
    return NextResponse.redirect(new URL(`/login?callbackUrl=${callbackUrl}`, req.url))
  }

  // If logged in and trying to access login/signup, redirect to dashboard
  if (isLoggedIn && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Redirect homepage to dashboard if logged in
  if (isLoggedIn && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
})

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - manifest.json (PWA manifest)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
