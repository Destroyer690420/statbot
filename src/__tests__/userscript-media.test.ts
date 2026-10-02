/**
 * GoPartTime userscript media extraction.
 *
 * The bug this pins: a task whose media is a video renders as
 *   <video poster="…jpg"><source src="…mp4"></video>
 * with no <img> anywhere. The original extractor only queried `img`, so a video
 * task produced an empty media list and the bot never sent the video at all —
 * there was no compression involved, the video simply never left the browser.
 *
 * The extractor is lifted verbatim out of the shipped userscripts between the
 * `media-extraction` sentinels and run against a hand-rolled DOM stub (there is
 * no jsdom in this project). Both copies are asserted byte-identical, which is
 * the sync rule KNOWN_ISSUES #11 records for `scripts/` vs `dashboard/public/`.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const COPIES = [
  path.join(ROOT, 'scripts', 'goparttime-send.user.js'),
  path.join(ROOT, 'scripts', 'goparttime-auto.user.js'),
];

const MIRRORS = [
  path.join(ROOT, 'dashboard', 'public', 'goparttime-send.user.js'),
  path.join(ROOT, 'dashboard', 'public', 'goparttime-auto.user.js'),
];

type ExtractImages = (root: { querySelectorAll: (selector: string) => unknown[] }) => Array<{
  order: number;
  url: string;
  kind: string;
}>;

function mediaExtractionSource(source: string): string {
  const start = source.indexOf('// ─── media-extraction:start ───');
  const end = source.indexOf('// ─── media-extraction:end ───');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('media-extraction sentinels not found — did the extractor get renamed?');
  }
  return source.slice(start, end);
}

function loadExtractImages(file: string): ExtractImages {
  const source = mediaExtractionSource(fs.readFileSync(file, 'utf8'));
  // eslint-disable-next-line no-new-func
  return new Function(`${source}\nreturn extractImages;`)() as ExtractImages;
}

// ─── DOM stub ────────────────────────────────────────────────

interface StubOptions {
  tagName: 'IMG' | 'VIDEO';
  alt?: string;
  src?: string;
  naturalWidth?: number;
  poster?: string;
  sources?: string[];
  currentSrc?: string;
  inButton?: boolean;
}

function stubNode(options: StubOptions) {
  const attrs: Record<string, string> = {};
  if (options.poster) attrs.poster = options.poster;
  if (options.src) attrs.src = options.src;
  return {
    tagName: options.tagName,
    alt: options.alt,
    src: options.src,
    naturalWidth: options.naturalWidth,
    currentSrc: options.currentSrc,
    closest: (selector: string) =>
      options.inButton && selector === 'button' ? { tagName: 'BUTTON' } : null,
    getAttribute: (name: string) => attrs[name] ?? null,
    querySelectorAll: (selector: string) =>
      selector === 'source'
        ? (options.sources || []).map((src) => ({ getAttribute: () => src }))
        : [],
  };
}

function rootOf(nodes: unknown[]) {
  return {
    querySelectorAll: (selector: string) => {
      if (selector === 'img, video') return nodes;
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
}

/** The exact markup from a real GoPartTime video task dialog. */
const TWITTER_VIDEO = 'https://video.twimg.com/amplify_video/2105333669607211008/vid/avc1/1280x720/_jPEq-fHXX00BKIA.mp4?tag=29';
const TWITTER_POSTER = 'https://pbs.twimg.com/amplify_video_thumb/2105333669607211008/img/Z8Hdt6npM09-U8St.jpg';

// ─── Tests ───────────────────────────────────────────────────

describe('GoPartTime media extraction', () => {
  const extractImages = loadExtractImages(COPIES[0]);

  test('a <video> with no <img> is still extracted (the regression)', () => {
    const video = stubNode({
      tagName: 'VIDEO',
      poster: TWITTER_POSTER,
      sources: [TWITTER_VIDEO],
      currentSrc: TWITTER_VIDEO,
    });

    const media = extractImages(rootOf([video]));

    expect(media).toEqual([{ order: 1, url: TWITTER_VIDEO, kind: 'video' }]);
  });

  test('images are unaffected and still prefer the alt URL', () => {
    const img = stubNode({
      tagName: 'IMG',
      alt: 'https://static.goparttime.net/original.jpg',
      src: 'https://static.goparttime.net/next-optimized.jpg',
      naturalWidth: 800,
    });

    expect(extractImages(rootOf([img]))).toEqual([
      { order: 1, url: 'https://static.goparttime.net/original.jpg', kind: 'image' },
    ]);
  });

  test('images and a video keep one document order across the shared numbering', () => {
    const first = stubNode({ tagName: 'IMG', alt: 'https://cdn/a.jpg', naturalWidth: 640 });
    const video = stubNode({ tagName: 'VIDEO', poster: TWITTER_POSTER, sources: [TWITTER_VIDEO] });
    const last = stubNode({ tagName: 'IMG', alt: 'https://cdn/b.jpg', naturalWidth: 640 });

    expect(extractImages(rootOf([first, video, last]))).toEqual([
      { order: 1, url: 'https://cdn/a.jpg', kind: 'image' },
      { order: 2, url: TWITTER_VIDEO, kind: 'video' },
      { order: 3, url: 'https://cdn/b.jpg', kind: 'image' },
    ]);
  });

  test('small UI icons are still skipped', () => {
    const icon = stubNode({ tagName: 'IMG', alt: 'https://cdn/icon.png', naturalWidth: 24 });
    const real = stubNode({ tagName: 'IMG', alt: 'https://cdn/big.png', naturalWidth: 800 });

    expect(extractImages(rootOf([icon, real]))).toHaveLength(1);
  });

  test('media inside a button is skipped', () => {
    const inButton = stubNode({ tagName: 'VIDEO', sources: [TWITTER_VIDEO], inButton: true });
    expect(extractImages(rootOf([inButton]))).toEqual([]);
  });

  test('an HLS-only video falls back to its poster frame', () => {
    const video = stubNode({
      tagName: 'VIDEO',
      poster: TWITTER_POSTER,
      sources: ['https://video.twimg.com/ext_tw/playlist.m3u8'],
    });

    expect(extractImages(rootOf([video]))).toEqual([{ order: 1, url: TWITTER_POSTER, kind: 'image' }]);
  });

  test('a video with neither a playable source nor a poster is dropped, not faked', () => {
    const video = stubNode({ tagName: 'VIDEO', sources: ['https://video.twimg.com/ext_tw/playlist.m3u8'] });
    expect(extractImages(rootOf([video]))).toEqual([]);
  });

  test('other video containers are accepted', () => {
    for (const url of [
      'https://cdn.example.com/clip.webm',
      'https://cdn.example.com/clip.mov',
      'https://cdn.example.com/clip.mkv',
    ]) {
      const media = extractImages(rootOf([stubNode({ tagName: 'VIDEO', sources: [url] })]));
      expect(media).toEqual([{ order: 1, url, kind: 'video' }]);
    }
  });

  test('the 20-item cap still applies across both kinds', () => {
    const nodes = Array.from({ length: 30 }, (_, i) =>
      stubNode({ tagName: 'IMG', alt: `https://cdn/${i}.jpg`, naturalWidth: 800 }),
    );
    expect(extractImages(rootOf(nodes))).toHaveLength(20);
  });
});

describe('shipped userscript copies', () => {
  test.each(COPIES.map((file, i) => [path.basename(file), file, MIRRORS[i]]))(
    '%s is byte-identical to its dashboard/public mirror',
    (_name, source, mirror) => {
      expect(fs.readFileSync(mirror, 'utf8')).toBe(fs.readFileSync(source, 'utf8'));
    },
  );

  test.each(COPIES)('%s declares a version', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toMatch(/^\/\/ @version\s+\d+\.\d+\.\d+$/m);
  });

  test.each(COPIES)('%s extracts video the same way (single implementation)', (file) => {
    const extract = loadExtractImages(file);
    const video = stubNode({ tagName: 'VIDEO', poster: TWITTER_POSTER, sources: [TWITTER_VIDEO] });
    expect(extract(rootOf([video]))).toEqual([{ order: 1, url: TWITTER_VIDEO, kind: 'video' }]);
  });
});
