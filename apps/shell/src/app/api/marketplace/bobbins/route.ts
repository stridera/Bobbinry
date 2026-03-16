import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'yaml'
import { auth } from '@/auth'

function getHostFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host
  } catch {
    return null
  }
}

export async function GET() {
  try {
    // Get session to check user badges for visibility gating.
    // Badges are cached in the JWT with a 5-minute TTL — after adding a badge,
    // the user may need to wait for the next refresh window to see gated bobbins.
    const session = await auth()
    const userBadges: string[] = (session?.user as any)?.badges || []
    const isOwner = userBadges.includes('owner')

    // Path to bobbins directory (relative to project root)
    const bobbinsDir = path.join(process.cwd(), '../../bobbins')

    // Read installable bobbin manifests from package directories only.
    const entries = fs
      .readdirSync(bobbinsDir, { withFileTypes: true })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

    const bobbins = []
    const seenIds = new Set<string>()

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const manifestPath = path.join(bobbinsDir, entry.name, 'manifest.yaml')
      const packageJsonPath = path.join(bobbinsDir, entry.name, 'package.json')

      if (fs.existsSync(manifestPath) && fs.existsSync(packageJsonPath)) {
        try {
          const content = fs.readFileSync(manifestPath, 'utf8')
          const manifest = yaml.parse(content)

          // Skip if we've already seen this bobbin ID
          if (seenIds.has(manifest.id)) {
            continue
          }
          seenIds.add(manifest.id)

          // Visibility gating: filter bobbins based on visibility + user badges
          // Default visibility is 'public'. Owners bypass all visibility restrictions.
          const visibility = manifest.visibility || 'public'
          if (!isOwner) {
            if (visibility === 'none') continue
            if (visibility === 'moderator') continue // future: check for moderator badge
          }

          // Extract extension slots from manifest
          const slots: string[] = []
          if (manifest.extensions?.contributions) {
            for (const contrib of manifest.extensions.contributions) {
              if (contrib.slot && !slots.includes(contrib.slot)) {
                slots.push(contrib.slot)
              }
            }
          }

          // Create metadata object with full manifest content
          const hosts = Array.from(new Set(
            (manifest.external?.endpoints || [])
              .map((endpoint: any) => getHostFromUrl(String(endpoint.url || '')))
              .filter(Boolean)
          )) as string[]

          const bobbinMeta = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author || 'Unknown',
            description: manifest.description || '',
            tags: manifest.tags || [],
            license: manifest.license,
            visibility,
            capabilities: manifest.capabilities || {},
            externalAccess: manifest.capabilities?.external ? {
              authType: manifest.external?.auth?.type,
              hosts,
              permissions: (manifest.external?.permissions || []).map((permission: any) => ({
                endpoint: permission.endpoint || '',
                reason: permission.reason || '',
                required: permission.required !== false,
              })),
            } : undefined,
            execution: manifest.execution,
            slots,
            manifestContent: content // Include the full YAML content
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
