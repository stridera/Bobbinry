import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { collection, projectId, data } = body

    if (!collection || !projectId || !data) {
      return NextResponse.json(
        { error: 'collection, projectId, and data are required' },
        { status: 400 }
      )
    }

    const { db, entities } = await import('@/lib/db')

    console.log(`[API] POST /api/entities`, { collection, projectId, data })

    const [inserted] = await db
      .insert(entities)
      .values({
        projectId,
        bobbinId: 'entities',
        collectionName: collection,
        entityData: data
      })
      .returning()

    const entity = {
      id: inserted.id,
      ...inserted.entityData,
      created_at: inserted.createdAt,
      updated_at: inserted.updatedAt
    }

    return NextResponse.json({ entity })
  } catch (error) {
    console.error('[API] Error creating entity:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
