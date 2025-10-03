import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bobbinId: string; path: string[] }> }
) {
  try {
    const { bobbinId, path } = await params
    const filePath = path.join('/')

    // Construct the path to the bobbin file
    // Bobbins are located in the monorepo root under bobbins/<bobbinId>/
    const bobbinPath = join(process.cwd(), '../../bobbins', bobbinId, filePath)

    console.log(`[Bobbin Route] Serving: ${bobbinPath}`)

    // Read the file
    const content = await readFile(bobbinPath)

    // Determine content type based on file extension
    const ext = filePath.split('.').pop()?.toLowerCase()
    const contentType = {
      'html': 'text/html',
      'js': 'application/javascript',
      'css': 'text/css',
      'json': 'application/json',
    }[ext || ''] || 'text/plain'

    return new NextResponse(content.toString(), {
      headers: {
        'Content-Type': contentType,
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
      },
    })
  } catch (error) {
    console.error('[Bobbin Route] Error:', error)
    return new NextResponse('File not found', { status: 404 })
  }
}
