import http from 'http';
import sharp from 'sharp';
import { prepareImage, MAX_IMAGE_BYTES, MAX_COMPRESSED_BYTES } from '../utils/image-processor';

jest.setTimeout(120_000);

describe('prepareImage — size policy', () => {
  let server: http.Server;
  let baseUrl: string;

  const routes = new Map<string, Buffer>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const route = routes.get(req.url || '/');
      if (!route) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(route);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to start test server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function noisePng(width: number, height: number): Promise<Buffer> {
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = Math.floor(Math.random() * 256);
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 1 })
      .toBuffer();
  }

  test('image <= 10 MB is returned unchanged (byte-identical)', async () => {
    const buffer = await noisePng(300, 300);
    expect(buffer.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    routes.set('/small.png', buffer);

    const result = await prepareImage(`${baseUrl}/small.png`);
    expect(result.compressed).toBe(false);
    expect(result.originalBytes).toBe(buffer.length);
    expect(result.buffer.equals(buffer)).toBe(true);
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
  });

  test('image > 10 MB is compressed to approximately 9 MB with alpha preserved', async () => {
    const buffer = await noisePng(2800, 2800);
    expect(buffer.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    routes.set('/big.png', buffer);

    const result = await prepareImage(`${baseUrl}/big.png`);
    expect(result.compressed).toBe(true);
    expect(result.originalBytes).toBe(buffer.length);
    expect(result.buffer.length).toBeLessThanOrEqual(MAX_COMPRESSED_BYTES);
    expect(result.mimeType).toBe('image/webp');
    expect(result.extension).toBe('webp');

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  test('image just under 10 MB is returned unchanged (compressed=false)', async () => {
    // 1800x1800x3 raw noise PNG lands just below the 10 MB threshold.
    const buffer = await noisePng(1800, 1800);
    expect(buffer.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    routes.set('/boundary.png', buffer);

    const result = await prepareImage(`${baseUrl}/boundary.png`);
    expect(result.compressed).toBe(false);
    expect(result.buffer.equals(buffer)).toBe(true);
  });

  test('HTTP error throws (never silently dropped)', async () => {
    await expect(prepareImage(`${baseUrl}/missing.png`)).rejects.toThrow(/HTTP 404/);
  });

  test('PNG with transparency compresses while preserving alpha', async () => {
    const size = 2600;
    const rgba = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      rgba[i * 4] = Math.floor(Math.random() * 256);
      rgba[i * 4 + 1] = Math.floor(Math.random() * 256);
      rgba[i * 4 + 2] = Math.floor(Math.random() * 256);
      rgba[i * 4 + 3] = Math.floor(Math.random() * 256);
    }
    const buffer = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
      .png({ compressionLevel: 1 })
      .toBuffer();
    expect(buffer.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    routes.set('/alpha.png', buffer);

    const result = await prepareImage(`${baseUrl}/alpha.png`);
    expect(result.compressed).toBe(true);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.hasAlpha).toBe(true);
  });
});
