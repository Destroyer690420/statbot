import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { MEDIA } from '../config/constants';

/**
 * Video download + size policy for Discord delivery.
 *
 * Discord refuses an attachment larger than the guild's upload limit (25 MB on
 * an unboosted server) and answers with HTTP 413, so a task video is very
 * often unsendable as-is — a 60 s 1080p clip is ~100 MB. Rather than failing
 * the whole assignment, an oversized video is re-encoded with ffmpeg until it
 * fits.
 *
 * Policy (mirrors image-processor.ts, different toolchain):
 *  - Video <= MAX_VIDEO_BYTES is downloaded and returned unchanged
 *    (byte-identical, no re-encode, quality untouched).
 *  - Anything larger goes down the ffmpeg ladder: a stream-copy remux first
 *    (free when the container itself is wasteful), then a CRF ladder, then
 *    CRF + downscale. The first result under the limit wins.
 *  - A video is never silently discarded: any failure throws, so the caller
 *    marks the delivery FAILED with the step recorded and it can be retried.
 */

/** Discord's documented per-file limit for an unboosted server. */
export const DISCORD_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

/**
 * Our own ceiling, deliberately ~1 MB under Discord's: the limit is checked on
 * the uploaded bytes, so landing exactly on it is a coin flip.
 */
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

/** Refuse to even download something this large — it would only OOM the box. */
export const MAX_VIDEO_DOWNLOAD_BYTES = 300 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 120_000;
const TRANSCODE_TIMEOUT_MS = 180_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Re-encode ladder. Order is cheapest-quality-loss first:
 *  1. `-c copy` — no re-encode at all, only container cleanup. Wins whenever
 *     the source merely has a wasteful container (matters for mov/avi).
 *  2. CRF ladder — same resolution, lower bitrate. crf 30 at `veryfast` is
 *     visually near-lossless for screen recordings, which is what these are.
 *  3. CRF + downscale — last resort for very long clips.
 */
const CRF_LADDER = [30, 33, 36, 39];
const SCALE_LADDER: Array<{ height: number; crf: number }> = [
  { height: 720, crf: 30 },
  { height: 480, crf: 30 },
  { height: 360, crf: 32 },
  // Last rung. Only reached by a clip so far over the limit that 360p still
  // misses, which in practice means a long high-bitrate recording rather than
  // a short post clip. 270p is watchable where nothing is, and the message
  // under the video says the quality was reduced.
  { height: 270, crf: 40 },
];

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi']);

/**
 * Runs ffmpeg once for a ladder attempt and resolves with the encoded bytes.
 * Injected so the ladder is unit-testable without an ffmpeg binary.
 */
export type Transcoder = (input: Buffer, args: string[]) => Promise<Buffer>;

export interface PrepareVideoOptions {
  /** Download step; injected in tests. Defaults to an HTTP GET with a cap. */
  download?: (url: string) => Promise<Buffer>;
  /** ffmpeg step; injected in tests. Defaults to the real binary. */
  transcode?: Transcoder;
  /**
   * Ceiling to compress down to. Defaults to MAX_VIDEO_BYTES; a lower value
   * exists so the ffmpeg ladder can be exercised against the real binary
   * without building a 30 MB fixture.
   */
  maxBytes?: number;
}

export interface PreparedVideo {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  originalBytes: number;
  compressed: boolean;
}

export interface VideoFormat {
  mime: string;
  extension: string;
}

/** True when the URL points at a file Discord can play inline. */
export function isVideoUrl(url: string): boolean {
  const ext = extensionOf(url);
  return ext !== null && VIDEO_EXTENSIONS.has(ext);
}

/**
 * Downloads a video and applies the size policy. Throws on download or
 * compression failure — the video is never silently dropped.
 */
export async function prepareVideo(url: string, options: PrepareVideoOptions = {}): Promise<PreparedVideo> {
  const download = options.download ?? downloadVideo;
  const transcode = options.transcode ?? ffmpegTranscode;
  const maxBytes = options.maxBytes ?? MAX_VIDEO_BYTES;

  const source = await download(url);
  const originalBytes = source.length;

  if (originalBytes === 0) {
    throw new Error('Video download failed (empty response).');
  }

  const format = sniffVideoFormat(source);

  if (originalBytes <= maxBytes) {
    return {
      buffer: source,
      mimeType: format.mime,
      extension: format.extension,
      originalBytes,
      compressed: false,
    };
  }

  const compressed = await compressVideo(source, transcode, maxBytes);
  if (compressed.length > maxBytes) {
    // Belt and braces: never hand back bytes Discord would reject with a 413.
    throw new Error(
      `Video compression produced ${compressed.length} bytes, still over the ${maxBytes} byte limit.`,
    );
  }

  return {
    buffer: compressed,
    mimeType: 'video/mp4',
    extension: 'mp4',
    originalBytes,
    compressed: true,
  };
}

/** Human-readable size for the "this was compressed" note under the video. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// ─── Download ────────────────────────────────────────────────

async function downloadVideo(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'video/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Video download failed (HTTP ${response.status}).`);
  }

  const declared = Number(response.headers.get('content-length') || '0');
  if (declared > MAX_VIDEO_DOWNLOAD_BYTES) {
    throw new Error(`Video is too large to deliver (${formatBytes(declared)}).`);
  }

  return readBodyWithLimit(response, MAX_VIDEO_DOWNLOAD_BYTES);
}

/**
 * Reads a response body into a Buffer, aborting as soon as it exceeds `limit`.
 * A plain `arrayBuffer()` on a multi-hundred-megabyte video is how a small box
 * dies, and the size is only known from the stream for chunked responses.
 */
async function readBodyWithLimit(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new Error(`Video is too large to deliver (${formatBytes(buffer.length)}).`);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Video is too large to deliver (over ${formatBytes(limit)}).`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

// ─── Compression ─────────────────────────────────────────────

async function compressVideo(source: Buffer, transcode: Transcoder, maxBytes: number): Promise<Buffer> {
  const attempts: string[][] = [
    // Remux only: no quality loss, so it goes first.
    ['-c', 'copy', '-movflags', '+faststart'],
    ...CRF_LADDER.map((crf) => encodeArgs(crf)),
    ...SCALE_LADDER.map(({ height, crf }) => encodeArgs(crf, height)),
  ];

  const failures: string[] = [];

  for (const args of attempts) {
    try {
      const candidate = await transcode(source, args);
      if (candidate.length > 0 && candidate.length <= maxBytes) {
        return candidate;
      }
      failures.push(`${describeArgs(args)} -> ${candidate.length} bytes`);
    } catch (error) {
      failures.push(`${describeArgs(args)} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Video compression failed: could not reach ${maxBytes} bytes (${failures.join('; ')}).`);
}

/**
 * H.264/AAC in a faststart MP4 — the combination Discord's player handles most
 * reliably. `scale=-2:H` keeps the width even so yuv420p stays legal.
 */
function encodeArgs(crf: number, height?: number): string[] {
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    ...(height ? ['-vf', `scale=-2:${height}`] : []),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
  ];
}

function describeArgs(args: string[]): string {
  return args.includes('copy') ? 'remux' : `crf ${args[args.indexOf('-crf') + 1]}`;
}

/** Real ffmpeg: one temp dir per attempt, always cleaned up. */
async function ffmpegTranscode(input: Buffer, args: string[]): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtm-video-'));
  const inputPath = path.join(dir, 'input');
  const outputPath = path.join(dir, 'output.mp4');

  try {
    await fs.writeFile(inputPath, input);
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', inputPath, ...args, outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(MEDIA.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TRANSCODE_TIMEOUT_MS);

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < 4000) stderr += data.toString();
    });

    child.on('error', (error) => {
      settle(new Error(`${MEDIA.FFMPEG_PATH} could not be started: ${error.message}`));
    });

    child.on('close', (code) => {
      if (timedOut) {
        settle(new Error(`${MEDIA.FFMPEG_PATH} timed out after ${TRANSCODE_TIMEOUT_MS} ms`));
      } else if (code === 0) {
        settle();
      } else {
        settle(new Error(`${MEDIA.FFMPEG_PATH} exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
      }
    });
  });
}

/**
 * Boot-time capability probe. A missing ffmpeg is not fatal (nothing else needs
 * it) but it silently caps every future video at Discord's limit, so it is
 * worth a warning line at startup rather than a 413 at delivery time.
 */
export function isFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(MEDIA.FFMPEG_PATH, ['-version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

// ─── Format sniffing ─────────────────────────────────────────

function extensionOf(url: string): string | null {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split('?')[0].split('#')[0];
    }
  })();
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Detects the container from magic bytes so the attachment keeps the right
 * extension (Discord renders a player based on it). The source URL is not
 * trusted: Twitter's CDN serves the same clip from several paths.
 */
export function sniffVideoFormat(buffer: Buffer): VideoFormat {
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mime: 'video/webm', extension: 'webm' };
  }
  if (buffer.length >= 12 && buffer.toString('latin1', 4, 8) === 'ftyp') {
    return { mime: 'video/mp4', extension: 'mp4' };
  }
  if (buffer.length >= 12 && buffer.toString('latin1', 4, 8) === 'moov') {
    return { mime: 'video/mp4', extension: 'mp4' };
  }
  return { mime: 'video/mp4', extension: 'mp4' };
}
