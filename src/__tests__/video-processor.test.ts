import http from 'http';
import {
  prepareVideo,
  isVideoUrl,
  sniffVideoFormat,
  formatBytes,
  MAX_VIDEO_BYTES,
  DISCORD_UPLOAD_LIMIT_BYTES,
  PreparedVideo,
} from '../utils/video-processor';

/** A tiny but real mp4 header, so sniffVideoFormat has something to read. */
function fakeMp4(bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes);
  buffer.write('....ftypisom', 0, 'latin1');
  return buffer;
}

describe('video size policy', () => {
  test('our ceiling sits under Discord\u2019s limit (never a 413 on the boundary)', () => {
    expect(MAX_VIDEO_BYTES).toBeLessThan(DISCORD_UPLOAD_LIMIT_BYTES);
  });

  test('video under the limit is returned unchanged (byte-identical)', async () => {
    const source = fakeMp4(6_410_028);
    const result = await prepareVideo('https://video.twimg.com/x.mp4', {
      download: async () => source,
    });

    expect(result.compressed).toBe(false);
    expect(result.originalBytes).toBe(source.length);
    expect(result.buffer.equals(source)).toBe(true);
    expect(result.mimeType).toBe('video/mp4');
    expect(result.extension).toBe('mp4');
  });

  test('oversized video is compressed and reported as compressed', async () => {
    const source = fakeMp4(MAX_VIDEO_BYTES + 1);
    const encoded = fakeMp4(1024);

    const result = await prepareVideo('https://video.twimg.com/big.mp4', {
      download: async () => source,
      transcode: async () => encoded,
    });

    expect(result.compressed).toBe(true);
    expect(result.originalBytes).toBe(source.length);
    expect(result.buffer.equals(encoded)).toBe(true);
    expect(result.extension).toBe('mp4');
  });

  test('compression is skipped entirely for a small video (ffmpeg never runs)', async () => {
    let transcodeCalls = 0;
    await prepareVideo('https://video.twimg.com/small.mp4', {
      download: async () => fakeMp4(1024),
      transcode: async () => {
        transcodeCalls++;
        return fakeMp4(16);
      },
    });
    expect(transcodeCalls).toBe(0);
  });
});

describe('compression ladder', () => {
  const oversized = () => fakeMp4(MAX_VIDEO_BYTES + 5_000_000);

  test('a stream-copy remux is tried first (no quality loss)', async () => {
    const attempts: string[][] = [];
    const result = await prepareVideo('https://x/big.mp4', {
      download: async () => oversized(),
      transcode: async (_input, args) => {
        attempts.push(args);
        return fakeMp4(512);
      },
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toContain('copy');
    expect(result.compressed).toBe(true);
  });

  test('falls through to a CRF ladder when the remux is still too big', async () => {
    const attempts: string[][] = [];
    const result = await prepareVideo('https://x/big.mp4', {
      download: async () => oversized(),
      transcode: async (_input, args) => {
        attempts.push(args);
        // Remux "succeeds" but stays oversized; the next attempt fits.
        return fakeMp4(attempts.length === 1 ? MAX_VIDEO_BYTES + 1 : 900);
      },
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toContain('copy');
    expect(attempts[1]).toContain('-crf');
    expect(attempts[1]).toContain('libx264');
    expect(result.buffer.length).toBe(900);
  });

  test('a failing attempt is skipped, not fatal', async () => {
    const attempts: string[][] = [];
    const result = await prepareVideo('https://x/big.mp4', {
      download: async () => oversized(),
      transcode: async (_input, args) => {
        attempts.push(args);
        if (attempts.length < 3) throw new Error('ffmpeg exited with code 1');
        return fakeMp4(777);
      },
    });

    expect(attempts).toHaveLength(3);
    expect(result.buffer.length).toBe(777);
  });

  test('the ladder escalates to downscales when re-encoding alone is not enough', async () => {
    const attempts: string[][] = [];
    // Never gets under the limit, so the whole ladder has to run.
    await expect(
      prepareVideo('https://x/huge.mp4', {
        download: async () => oversized(),
        transcode: async (_input, args) => {
          attempts.push(args);
          return fakeMp4(MAX_VIDEO_BYTES + 1);
        },
      }),
    ).rejects.toThrow(/compression failed/i);

    // 1 remux + 4 CRF rungs + 4 downscale rungs.
    expect(attempts).toHaveLength(9);
    const scaleValues = attempts
      .filter((args) => args.includes('-vf'))
      .map((args) => args[args.indexOf('-vf') + 1]);
    expect(scaleValues).toEqual(['scale=-2:720', 'scale=-2:480', 'scale=-2:360', 'scale=-2:270']);
  });

  test('nothing under the limit throws (never sends bytes Discord rejects)', async () => {
    await expect(
      prepareVideo('https://x/huge.mp4', {
        download: async () => oversized(),
        transcode: async () => fakeMp4(MAX_VIDEO_BYTES + 1),
      }),
    ).rejects.toThrow(/compression failed/i);
  });

  test('a missing ffmpeg surfaces as a failure, not a silent drop', async () => {
    await expect(
      prepareVideo('https://x/huge.mp4', {
        download: async () => oversized(),
        transcode: async () => {
          throw new Error('ffmpeg could not be started: spawn ffmpeg ENOENT');
        },
      }),
    ).rejects.toThrow(/ffmpeg could not be started/);
  });
});

describe('download failures', () => {
  test('an HTTP error throws', async () => {
    let server: http.Server;
    let baseUrl = '';

    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await expect(prepareVideo(`${baseUrl}/missing.mp4`)).rejects.toThrow(/HTTP 404/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('an empty body throws', async () => {
    await expect(
      prepareVideo('https://x/empty.mp4', { download: async () => Buffer.alloc(0) }),
    ).rejects.toThrow(/empty response/);
  });
});

describe('download over HTTP', () => {
  let server: http.Server;
  let baseUrl = '';
  const body = fakeMp4(2048);

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('a real HTTP download comes back byte-identical', async () => {
    const result: PreparedVideo = await prepareVideo(`${baseUrl}/clip.mp4`);
    expect(result.compressed).toBe(false);
    expect(result.buffer.equals(body)).toBe(true);
    expect(result.mimeType).toBe('video/mp4');
  });
});

describe('format sniffing', () => {
  test('mp4 / mov family (ftyp box)', () => {
    const buffer = Buffer.alloc(64);
    buffer.write('ftypisom', 4, 'latin1');
    expect(sniffVideoFormat(buffer)).toEqual({ mime: 'video/mp4', extension: 'mp4' });
  });

  test('webm / matroska (EBML magic)', () => {
    const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]);
    expect(sniffVideoFormat(buffer)).toEqual({ mime: 'video/webm', extension: 'webm' });
  });

  test('unknown bytes fall back to mp4 (Discord plays it natively)', () => {
    expect(sniffVideoFormat(Buffer.from('nonsense'))).toEqual({ mime: 'video/mp4', extension: 'mp4' });
  });
});

describe('isVideoUrl', () => {
  test('accepts playable video URLs, query string and all', () => {
    expect(isVideoUrl('https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/a.mp4?tag=29')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/clip.WEBM')).toBe(true);
    expect(isVideoUrl('https://cdn.example.com/clip.mov')).toBe(true);
  });

  test('rejects images, HLS playlists and extensionless URLs', () => {
    expect(isVideoUrl('https://pbs.twimg.com/media/abc.jpg')).toBe(false);
    expect(isVideoUrl('https://video.twimg.com/pl/playlist.m3u8')).toBe(false);
    expect(isVideoUrl('https://video.twimg.com/stream/2105333669607211008')).toBe(false);
  });
});

describe('formatBytes', () => {
  test('reads the way the compression note shows it', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(Math.round(1.5 * 1024 * 1024))).toBe('1.5 MB');
  });
});
