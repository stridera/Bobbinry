import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collection: string }> }
) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const limit = searchParams.get('limit') || '100'
    const offset = searchParams.get('offset') || '0'

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      )
    }

    const { collection } = await params
    const { db, entities } = await import('@/lib/db')
    const { eq, and } = await import('drizzle-orm')

    console.log(`[API] GET /api/collections/${collection}/entities`, { projectId, limit, offset })

    const results = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        )
      )
      .limit(parseInt(limit))
      .offset(parseInt(offset))

    // Transform results to extract entity data
    const transformedEntities = results.map(row => ({
      id: row.id,
      ...row.entityData,
      created_at: row.createdAt,
      updated_at: row.updatedAt
    }))

    return NextResponse.json({
      entities: transformedEntities,
      total: transformedEntities.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('[API] Error fetching entities:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
