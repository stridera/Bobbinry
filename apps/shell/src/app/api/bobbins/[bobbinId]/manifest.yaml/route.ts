import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(
  request: Request,
  { params }: { params: { bobbinId: string } }
) {
  try {
    const { bobbinId } = params
    
    // Path to bobbins directory (relative to project root)
    const bobbinsDir = path.join(process.cwd(), '../../bobbins')
    
    // Try both directory-based and root-level manifest files
    let manifestPath: string | null = null
    
    // Check for subdirectory with manifest.yaml
    const subManifest = path.join(bobbinsDir, bobbinId, 'manifest.yaml')
    if (fs.existsSync(subManifest)) {
      manifestPath = subManifest
    } else {
      // Check for root-level .manifest.yaml
      const rootManifest = path.join(bobbinsDir, `${bobbinId}.manifest.yaml`)
      if (fs.existsSync(rootManifest)) {
        manifestPath = rootManifest
      }
    }
    
    if (!manifestPath) {
      return NextResponse.json(
        { error: 'Manifest not found' },
        { status: 404 }
      )
    }
    
    const content = fs.readFileSync(manifestPath, 'utf8')
    
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/yaml',
        'Cache-Control': 'no-cache'
      }
    })
  } catch (error) {
    console.error('Failed to load manifest:', error)
    return NextResponse.json(
      { error: 'Failed to load manifest' },
      { status: 500 }
    )
  }
}
