/**
 * S3 Client Singleton
 *
 * Provides S3-compatible storage access for MinIO (local) and Cloudflare R2 (production).
 * Uses presigned URLs so binary data never touches the API server.
 */

import { S3Client, HeadBucketCommand, CreateBucketCommand, PutBucketCorsCommand, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env'

let _client: S3Client | null = null
let _presignClient: S3Client | null = null

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

/** Client for generating presigned URLs — uses the public endpoint so signatures match the browser's Host header */
function getPresignClient(): S3Client {
  if (env.S3_PUBLIC_ENDPOINT === env.S3_ENDPOINT) return getS3Client()
  if (!_presignClient) {
    _presignClient = new S3Client({
      endpoint: env.S3_PUBLIC_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      forcePathStyle: true,
    })
  }
  return _presignClient
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
      // R2 manages CORS via its dashboard, so this may fail in production
      try {
        await client.send(new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [env.WEB_ORIGIN],
                AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag', 'Content-Length'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }))
      } catch (corsErr) {
        console.warn(`Could not set CORS on bucket ${bucket} (expected on R2):`, (corsErr as Error).message)
      }

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
  const client = getPresignClient()

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

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = getS3Client()
  await client.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
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
 * Routes through the API image proxy so bucket access policy doesn't matter.
 */
export function getPublicUrl(key: string): string {
  return `${env.API_ORIGIN}/api/images/${encodeURIComponent(key)}`
}

/**
 * Stream an object from S3 for the image proxy.
 */
export async function getObject(key: string): Promise<{ body: ReadableStream | NodeJS.ReadableStream; contentType: string | undefined; contentLength: number | undefined } | null> {
  const client = getS3Client()
  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }))
    return {
      body: result.Body as any,
      contentType: result.ContentType ?? undefined,
      contentLength: result.ContentLength ?? undefined,
    }
  } catch {
    return null
  }
}
