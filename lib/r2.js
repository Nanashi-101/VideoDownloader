/**
 * Cloudflare R2 storage layer (S3-compatible)
 * Falls back gracefully when R2 env vars are not set.
 */
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs   = require('fs');
const path = require('path');

const R2_ENABLED = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME
);

let s3 = null;

if (R2_ENABLED) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  console.log(`[R2] Connected — bucket: ${process.env.R2_BUCKET_NAME}`);
} else {
  console.log('[R2] Not configured — using local disk storage');
}

/**
 * Upload a local file to R2.
 * @param {string} localPath  - absolute path to the file on disk
 * @param {string} key        - R2 object key (e.g. "550e8400_Sintel.mp4")
 * @param {string} contentType
 * @returns {Promise<string>} the R2 key
 */
async function uploadFile(localPath, key, contentType = 'video/mp4') {
  if (!R2_ENABLED) throw new Error('R2 not configured');

  const fileStream = fs.createReadStream(localPath);
  const fileSize   = fs.statSync(localPath).size;

  console.log(`[R2] Uploading ${key} (${(fileSize / 1024 / 1024).toFixed(1)} MB)…`);

  await s3.send(new PutObjectCommand({
    Bucket:        process.env.R2_BUCKET_NAME,
    Key:           key,
    Body:          fileStream,
    ContentType:   contentType,
    ContentLength: fileSize,
  }));

  console.log(`[R2] Upload complete: ${key}`);
  return key;
}

/**
 * Generate a presigned URL for a private R2 object.
 * URL is valid for 1 hour by default.
 * @param {string} key
 * @param {number} expiresIn  - seconds (default 3600 = 1 hour)
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  if (!R2_ENABLED) throw new Error('R2 not configured');

  const command = new HeadObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key:    key,
  });

  // Use GetObject for the signed URL (HeadObject just checks existence)
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key:    key,
  }), { expiresIn });
}

/**
 * Delete an object from R2.
 */
async function deleteFile(key) {
  if (!R2_ENABLED || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key:    key,
    }));
    console.log(`[R2] Deleted: ${key}`);
  } catch (err) {
    console.error(`[R2] Delete failed for ${key}:`, err.message);
  }
}

module.exports = { R2_ENABLED, uploadFile, getPresignedUrl, deleteFile };
