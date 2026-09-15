import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { FirmwareStorageService } from './firmware-storage.service';

// type ชัดเจนแทน jest.fn() เปล่าๆ — กัน @typescript-eslint/no-unsafe-*
// ตอนอ่าน mockSend.mock.calls กลับมาเช็คว่า S3Client ถูกเรียกด้วย command ไหน
const mockSend = jest.fn() as jest.Mock<Promise<unknown>, [{ input: unknown }]>;

jest.mock('@aws-sdk/client-s3', () => {
  const actual =
    jest.requireActual<typeof import('@aws-sdk/client-s3')>(
      '@aws-sdk/client-s3',
    );
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

describe('FirmwareStorageService', () => {
  let service: FirmwareStorageService;

  beforeEach(async () => {
    mockSend.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirmwareStorageService,
        {
          provide: NestConfigService,
          useValue: {
            get: (key: string, fallback?: string) =>
              ({
                OBJECT_STORAGE_BUCKET: 'gps-firmware-test',
                OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
                OBJECT_STORAGE_ACCESS_KEY: 'x',
                OBJECT_STORAGE_SECRET_KEY: 'x',
              })[key] ?? fallback,
          },
        },
      ],
    }).compile();

    service = module.get(FirmwareStorageService);
  });

  describe('onModuleInit', () => {
    it('bucket มีอยู่แล้ว (HeadBucket ผ่าน) -> ไม่พยายามสร้างซ้ำ', async () => {
      mockSend.mockResolvedValueOnce(undefined); // HeadBucketCommand

      await service.onModuleInit();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('ไม่พบ bucket (HeadBucket โยน error) -> สร้าง bucket ใหม่', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('NotFound')) // HeadBucketCommand
        .mockResolvedValueOnce(undefined); // CreateBucketCommand

      await service.onModuleInit();

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('สร้าง bucket ไม่สำเร็จ -> ไม่ throw (แค่ log warning)', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('NotFound'))
        .mockRejectedValueOnce(new Error('Access Denied'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('uploadObject', () => {
    it('เรียก S3 PutObjectCommand พร้อมข้อมูลที่ส่งมา', async () => {
      mockSend.mockResolvedValueOnce(undefined);

      await service.uploadObject({
        key: 'firmware/abc/file.bin',
        body: Buffer.from('hello'),
        contentType: 'application/octet-stream',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toMatchObject({
        Bucket: 'gps-firmware-test',
        Key: 'firmware/abc/file.bin',
        ContentType: 'application/octet-stream',
      });
    });

    it('S3 ล้มเหลว -> throw ให้ผู้เรียกจัดการ (ไม่กลืน error เงียบๆ)', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 down'));

      await expect(
        service.uploadObject({
          key: 'firmware/abc/file.bin',
          body: Buffer.from('hello'),
        }),
      ).rejects.toThrow('S3 down');
    });
  });
});
