import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

export type UploadFolder = 'memes' | 'thumbnails' | 'avatars';

export interface UploadResult {
  url: string;
  key: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly cdnEndpoint: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = configService.get<string>('spaces.bucket')!;
    this.cdnEndpoint = configService.get<string>('spaces.cdnEndpoint')!;

    this.s3Client = new S3Client({
      endpoint: configService.get<string>('spaces.endpoint'),
      region: configService.get<string>('spaces.region'),
      credentials: {
        accessKeyId: configService.get<string>('spaces.key')!,
        secretAccessKey: configService.get<string>('spaces.secret')!,
      },
      forcePathStyle: false,
    });
  }

  async uploadFile(file: Express.Multer.File, folder: UploadFolder = 'memes'): Promise<UploadResult> {
    const ext = file.originalname.split('.').pop();
    const key = `${folder}/${uuidv4()}.${ext}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
        CacheControl: 'max-age=31536000',
      }),
    );

    this.logger.log(`Uploaded ${key}`);

    return {
      url: `${this.cdnEndpoint}/${key}`,
      key,
    };
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    this.logger.log(`Deleted ${key}`);
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }
}
