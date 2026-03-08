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
    const { eq, and, sql } = await import('drizzle-orm')

    console.log(`[API] GET /api/collections/${collection}/entities`, { projectId, limit, offset })

    const whereCondition = and(
      eq(entities.projectId, projectId),
      eq(entities.collectionName, collection)
    )

    // Run count and data queries in parallel
    const [countResult, results] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(entities).where(whereCondition),
      db
        .select()
        .from(entities)
        .where(whereCondition)
        .limit(parseInt(limit))
        .offset(parseInt(offset))
    ])

    const total = Number(countResult[0]?.count ?? 0)

    // Transform results to extract entity data
    const transformedEntities = results.map(row => ({
      id: row.id,
      ...(row.entityData as Record<string, unknown>),
      created_at: row.createdAt,
      updated_at: row.updatedAt
    }))

    return NextResponse.json({
      entities: transformedEntities,
      total,
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
