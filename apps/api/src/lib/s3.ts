/**
 * S3 Client Singleton
 *
 * Provides S3-compatible storage access for MinIO (local) and Cloudflare R2 (production).
 * Uses presigned URLs so binary data never touches the API server.
 */

import { S3Client, HeadBucketCommand, CreateBucketCommand, PutBucketCorsCommand, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env'

let _client: S3Client | null = null

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO
    })
  }
  return _client
}

export async function ensureBucketExists(): Promise<void> {
  const client = getS3Client()
  const bucket = env.S3_BUCKET

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchBucket') {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))

      // Configure CORS for direct browser uploads
      await client.send(new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ['*'],
              AllowedMethods: ['GET', 'PUT', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag', 'Content-Length'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }))

      console.log(`Created S3 bucket: ${bucket}`)
    } else {
      throw err
    }
  }
}

export async function generatePresignedPutUrl(
  key: string,
  contentType: string,
  maxSize: number
): Promise<{ url: string; expiresAt: string }> {
  const client = getS3Client()

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: maxSize,
  })

  const url = await getSignedUrl(client, command, { expiresIn: 300 }) // 5 minutes
  const expiresAt = new Date(Date.now() + 300 * 1000).toISOString()

  return { url, expiresAt }
}

export async function headObject(key: string): Promise<{ contentType: string | undefined; contentLength: number | undefined } | null> {
  const client = getS3Client()

  try {
    const result = await client.send(new HeadObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }))
    return {
      contentType: result.ContentType ?? undefined,
      contentLength: result.ContentLength ?? undefined,
    }
  } catch {
    return null
  }
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client()
  await client.send(new DeleteObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  }))
}

/**
 * Build a URL for reading an uploaded file.
 * In development (MinIO), files are accessible via the MinIO endpoint.
 * In production (R2), you'd use a CDN or presigned GET URL.
 */
export function getPublicUrl(key: string): string {
  return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`
}
