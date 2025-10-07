import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const collection = searchParams.get('collection')

    if (!projectId || !collection) {
      return NextResponse.json(
        { error: 'projectId and collection are required' },
        { status: 400 }
      )
    }

    const { id: entityId } = await params
    const { db, entities } = await import('@/lib/db')
    const { eq, and } = await import('drizzle-orm')

    console.log(`[API] GET /api/entities/${entityId}`, { projectId, collection })

    const [result] = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        )
      )
      .limit(1)

    if (!result) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }

    const entity = {
      id: result.id,
      ...(result.entityData as Record<string, unknown>),
      created_at: result.createdAt,
      updated_at: result.updatedAt
    }

    return NextResponse.json({ entity })
  } catch (error) {
    console.error('[API] Error fetching entity:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json()
    const { collection, projectId, data } = body

    if (!collection || !projectId || !data) {
      return NextResponse.json(
        { error: 'collection, projectId, and data are required' },
        { status: 400 }
      )
    }

    const { id: entityId } = await params
    const { db, entities } = await import('@/lib/db')
    const { eq, and } = await import('drizzle-orm')
    const { sql } = await import('drizzle-orm')

    console.log(`[API] PUT /api/entities/${entityId}`, { collection, projectId, data })

    const [updated] = await db
      .update(entities)
      .set({
        entityData: data,
        updatedAt: sql`NOW()`
      })
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        )
      )
      .returning()

    if (!updated) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }

    const entity = {
      id: updated.id,
      ...(updated.entityData as Record<string, unknown>),
      updated_at: updated.updatedAt
    }

    return NextResponse.json({ entity })
  } catch (error) {
    console.error('[API] Error updating entity:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const collection = searchParams.get('collection')

    if (!projectId || !collection) {
      return NextResponse.json(
        { error: 'projectId and collection are required' },
        { status: 400 }
      )
    }

    const { id: entityId } = await params
    const { db, entities } = await import('@/lib/db')
    const { eq, and } = await import('drizzle-orm')

    console.log(`[API] DELETE /api/entities/${entityId}`, { projectId, collection })

    const [deleted] = await db
      .delete(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        )
      )
      .returning()

    if (!deleted) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Error deleting entity:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
