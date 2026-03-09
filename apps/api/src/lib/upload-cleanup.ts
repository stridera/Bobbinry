import { eq, and, ne, inArray } from 'drizzle-orm'
import { db } from '../db/connection'
import { uploads } from '../db/schema'
import { deleteObject } from './s3'
import { variantKey } from './image-variants'

/**
 * Clean up old avatar uploads for a user.
 * Deletes S3 objects (original + variants) and soft-deletes DB records.
 * Best-effort — logs warnings on failure, never throws.
 */
export async function cleanupOldAvatarUploads(userId: string, excludeS3Key?: string): Promise<void> {
  try {
    const conditions = [
      eq(uploads.userId, userId),
      eq(uploads.context, 'avatar'),
      eq(uploads.status, 'active'),
    ]
    if (excludeS3Key) {
      conditions.push(ne(uploads.s3Key, excludeS3Key))
    }

    const oldUploads = await db
      .select({ id: uploads.id, s3Key: uploads.s3Key })
      .from(uploads)
      .where(and(...conditions))

    if (oldUploads.length === 0) return

    // Delete S3 objects (original + variants) — best effort
    await Promise.allSettled(
      oldUploads.flatMap(u => [
        deleteObject(u.s3Key),
        deleteObject(variantKey(u.s3Key, 'thumb')),
        deleteObject(variantKey(u.s3Key, 'medium')),
      ])
    )

    // Soft-delete DB records in a single batch
    await db
      .update(uploads)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(inArray(uploads.id, oldUploads.map(u => u.id)))
  } catch (err) {
    console.warn('cleanupOldAvatarUploads failed (best-effort):', err)
  }
}
