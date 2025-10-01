import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'yaml'

export async function GET() {
  try {
    // Path to bobbins directory (relative to project root)
    const bobbinsDir = path.join(process.cwd(), '../../bobbins')

    // Read all manifest files in the bobbins directory
    const entries = fs.readdirSync(bobbinsDir, { withFileTypes: true })

    const bobbins = []

    for (const entry of entries) {
      // Look for manifest.yaml files in subdirectories or .manifest.yaml files in root
      let manifestPath: string | null = null

      if (entry.isDirectory()) {
        // Check for manifest.yaml in subdirectory
        const subManifest = path.join(bobbinsDir, entry.name, 'manifest.yaml')
        if (fs.existsSync(subManifest)) {
          manifestPath = subManifest
        }
      } else if (entry.name.endsWith('.manifest.yaml')) {
        // Root-level manifest file
        manifestPath = path.join(bobbinsDir, entry.name)
      }

      if (manifestPath) {
        try {
          const content = fs.readFileSync(manifestPath, 'utf8')
          const manifest = yaml.parse(content)

          // Create metadata object
          const bobbinMeta = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author || 'Unknown',
            description: manifest.description || '',
            tags: manifest.tags || [],
            license: manifest.license,
            capabilities: manifest.capabilities || {},
            execution: manifest.execution,
            manifestPath: `/bobbins/${entry.isDirectory() ? entry.name + '/' : ''}${path.basename(manifestPath)}`
          }

          bobbins.push(bobbinMeta)
        } catch (error) {
          console.error(`Failed to parse manifest: ${manifestPath}`, error)
        }
      }
    }

    return NextResponse.json({
      success: true,
      bobbins,
      count: bobbins.length
    })
  } catch (error) {
    console.error('Failed to load bobbins:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load bobbins from directory'
      },
      { status: 500 }
    )
  }
}
