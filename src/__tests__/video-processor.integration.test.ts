import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import { prepareVideo, isFfmpegAvailable, MAX_VIDEO_BYTES, PreparedVideo } from '../utils/video-processor';

/**
 * Real-ffmpeg integration test.
 *
 * The ladder's branching is unit-tested with an injected transcoder; this file
 * covers what a mock cannot — that the argv we build is actually accepted by
 * ffmpeg, that libx264 + faststart output really is a playable MP4, and that
 * the ladder terminates on a real encoder. `maxBytes` is lowered so a normal
 * few-second clip exercises the whole path instead of requiring a 30 MB
 * fixture; the argv ladder is identical either way.
 *
 * Skips itself when ffmpeg is missing (a fresh checkout); production runs it
 * through the Docker image, which installs ffmpeg.
 */
jest.setTimeout(600_000);

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
const describeIfFfmpeg = hasFfmpeg ? describe : describe.skip;

if (!hasFfmpeg) {
  // eslint-disable-next-line no-console
  console.warn(`[video-processor.integration] ${FFMPEG} not found — skipping the real-transcode tests`);
}

/** A real, playable H.264 MP4 that ffmpeg itself produced. */
function buildClip({ seconds, size, bitrate }: { seconds: number; size: string; bitrate: string }): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-video-fixture-'));
  const out = path.join(dir, 'clip.mp4');
  const result = spawnSync(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate,
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      out,
    ],
    { stdio: 'pipe' },
  );
  try {
    if (result.status !== 0) throw new Error(`fixture build failed: ${result.stderr?.toString()}`);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function serve(body: Buffer): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${address.port}/clip.mp4`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describeIfFfmpeg('prepareVideo against the real ffmpeg binary', () => {
  test('the boot-time probe reports ffmpeg as available', async () => {
    await expect(isFfmpegAvailable()).resolves.toBe(true);
  });

  test('a clip under the limit is downloaded and passed through byte-identically', async () => {
    const body = buildClip({ seconds: 2, size: '320x240', bitrate: '1M' });
    const { url, close } = await serve(body);

    try {
      const result: PreparedVideo = await prepareVideo(url);
      expect(result.compressed).toBe(false);
      expect(result.buffer.equals(body)).toBe(true);
      expect(result.originalBytes).toBe(body.length);
      expect(result.mimeType).toBe('video/mp4');
    } finally {
      await close();
    }
  });

  test('an over-limit clip is re-encoded by ffmpeg into a valid, smaller MP4', async () => {
    const source = buildClip({ seconds: 6, size: '640x480', bitrate: '6M' });
    const target = Math.floor(source.length / 3);
    expect(source.length).toBeGreaterThan(target);

    const result = await prepareVideo('https://example.invalid/clip.mp4', {
      download: async () => source,
      maxBytes: target,
    });

    expect(result.compressed).toBe(true);
    expect(result.originalBytes).toBe(source.length);
    expect(result.buffer.length).toBeLessThanOrEqual(target);
    expect(result.extension).toBe('mp4');
    expect(result.mimeType).toBe('video/mp4');

    // Real ffmpeg output, not a truncated husk: it must still be an MP4 and
    // ffmpeg must be able to read it back.
    expect(result.buffer.subarray(4, 8).toString('latin1')).toBe('ftyp');
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', 'pipe:0', '-f', 'null', '-'], {
      input: result.buffer,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    expect(probe.stderr?.toString()).toContain('Video: h264');
  }, 600_000);

  test('the downscale rungs really produce a playable file', async () => {
    const source = buildClip({ seconds: 4, size: '1280x720', bitrate: '8M' });
    // Small enough that CRF alone cannot get there — the ladder has to scale.
    const result = await prepareVideo('https://example.invalid/hd.mp4', {
      download: async () => source,
      maxBytes: 20_000,
    });

    expect(result.compressed).toBe(true);
    expect(result.buffer.length).toBeLessThanOrEqual(20_000);
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', 'pipe:0', '-f', 'null', '-'], {
      input: result.buffer,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    expect(probe.stderr?.toString()).toMatch(/Video: h264.*\b\d{2,3}x\d{2,3}\b/);
  }, 600_000);

  test('a file that is not a video fails loudly instead of uploading garbage', async () => {
    const garbage = Buffer.alloc(60_000, 0x41);
    await expect(
      prepareVideo('https://example.invalid/not-a-video.mp4', {
        download: async () => garbage,
        maxBytes: 1000,
      }),
    ).rejects.toThrow(/compression failed/i);
  }, 600_000);

  test('the default ceiling is the Discord-derived one, not the test override', () => {
    expect(MAX_VIDEO_BYTES).toBe(24 * 1024 * 1024);
  });
});
