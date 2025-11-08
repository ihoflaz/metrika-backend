import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Logger } from '../../lib/logger';
import type { AppConfig } from '../../config/app-config';

export class DocumentStorageService {
  private readonly client: S3Client;

  private readonly bucket: string;

  private readonly logger: Logger;

  private bucketValidated = false;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.bucket = config.STORAGE_BUCKET;

    this.client = new S3Client({
      region: config.STORAGE_REGION,
      endpoint: config.STORAGE_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.STORAGE_ACCESS_KEY,
        secretAccessKey: config.STORAGE_SECRET_KEY,
      },
    });
  }

  async uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectStream(key: string): Promise<{ stream: Readable; contentType?: string }> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!result.Body || typeof result.Body === 'string') {
      throw new Error('Expected readable stream from storage');
    }

    return {
      stream: result.Body as Readable,
      contentType: result.ContentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    await this.ensureBucket();

    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: targetKey,
      }),
    );
  }

  private async ensureBucket() {
    if (this.bucketValidated) {
      return;
    }

    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
      this.bucketValidated = true;
      return;
    } catch (error: unknown) {
      const status =
        typeof error === 'object' && error !== null
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;

      if (status !== 404) {
        this.logger.error({ error }, 'Failed to check storage bucket');
        throw error;
      }
    }

    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.bucket,
        }),
      );
      this.bucketValidated = true;
    } catch (error: unknown) {
      this.logger.error({ error }, 'Failed to create storage bucket');
      throw error;
    }
  }
}
