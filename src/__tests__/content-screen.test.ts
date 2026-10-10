/**
 * Tier-0/Tier-1 content screen — pure functions, no DOM, no network.
 * Keyword lists are injected (production lists live in CONTENT_SCREEN and are
 * currently empty pending owner terms), so these tests pin the MATCHING
 * behavior, not any particular term.
 */
import {
  matchKeyword,
  looksNonEnglish,
  screenTitle,
  screenFullContent,
  tier0Screen,
  buildSeenSet,
  autoBlockReason,
} from '../utils/content-screen';

const LISTS = {
  sexualHigh: ['porn', 'escort', 'sex toy'],
  sexualAmbiguous: ['sexy', 'adult content'],
  vapeHigh: ['vape', 'e-liquid', 'vape pen'],
  vapeAmbiguous: ['mod', 'pod', 'coil', 'mech mod'],
};

describe('matchKeyword', () => {
  it('matches case-insensitively on word boundaries', () => {
    expect(matchKeyword('My new VAPE pen review', LISTS.vapeHigh)).toBe('vape pen');
    expect(matchKeyword('An Escort story', LISTS.sexualHigh)).toBe('escort');
  });

  it('matches multi-word phrases literally, not as independent words', () => {
    expect(matchKeyword('best vape pen deals', LISTS.vapeHigh)).toBe('vape pen');
    // "pod" alone must NOT match the "vape pen" phrase, and "pen" alone neither.
    expect(matchKeyword('a pen for sale', ['vape pen'])).toBeNull();
  });

  it('does not match substrings or unlisted plurals', () => {
    expect(matchKeyword('a vaper trick', ['vape'])).toBeNull();
    expect(matchKeyword('vapes for sale', ['vape'])).toBeNull();
    expect(matchKeyword('vapes for sale', ['vapes'])).toBe('vapes');
    expect(matchKeyword('pornography debate', ['porn', 'pornography'])).toBe('pornography');
    expect(matchKeyword('cumulative results', LISTS.sexualHigh)).toBeNull();
    expect(matchKeyword('class discussion', ['ass'])).toBeNull();
  });

  it('returns null for empty text or empty lists', () => {
    expect(matchKeyword('', LISTS.sexualHigh)).toBeNull();
    expect(matchKeyword('vape pen', [])).toBeNull();
  });

  it('escapes regex characters in terms', () => {
    expect(matchKeyword('try a+b today', ['a+b'])).toBe('a+b');
    expect(matchKeyword('try aab today', ['a+b'])).toBeNull();
  });
});

describe('looksNonEnglish', () => {
  it('passes plain English (short and long)', () => {
    expect(looksNonEnglish('Cute cat pics')).toBe(false);
    expect(looksNonEnglish('the cat sat on the mat with a hat and a bat')).toBe(false);
  });

  it('flags non-Latin scripts', () => {
    expect(looksNonEnglish('मुंबई की ताज़ा खबरें और अपडेट यहाँ पढ़ें')).toBe(true);
  });

  it('flags long romanized text with almost no common English words', () => {
    expect(
      looksNonEnglish('shayari mohabbat ishq dard wafa sanam bewafa ashiq dildaara yaadein'),
    ).toBe(true);
  });

  it('never fires on empty or tiny text', () => {
    expect(looksNonEnglish('')).toBe(false);
    expect(looksNonEnglish('Hi')).toBe(false);
  });
});

describe('screenTitle / screenFullContent', () => {
  it('returns null for empty input', () => {
    expect(screenTitle(null, LISTS)).toBeNull();
    expect(screenTitle('   ', LISTS)).toBeNull();
    expect(screenFullContent(null, null, LISTS)).toBeNull();
  });

  it('checks sex-high before vape-high before ambiguous phrases before language', () => {
    expect(screenTitle('vape porn review', LISTS)).toMatchObject({ signal: 'sex', matched: 'porn' });
    expect(screenTitle('my vape pen', LISTS)).toMatchObject({ signal: 'vape', matched: 'vape pen' });
    expect(screenTitle('mech mod roundup', LISTS)).toMatchObject({ signal: 'vape', matched: 'mech mod' });
    expect(screenTitle('मुंबई खबरें ताज़ा अपडेट यहाँ पढ़ें', LISTS)).toMatchObject({ signal: 'non-en' });
  });

  it('screens title + content together', () => {
    expect(screenFullContent('clean title', 'clean body text here', LISTS)).toBeNull();
    expect(screenFullContent('clean title', 'best e-liquid flavors ranked', LISTS)).toMatchObject({
      signal: 'vape',
      matched: 'e-liquid',
    });
  });

  it('ambiguous singles never trigger alone', () => {
    for (const title of [
      'sexy car photoshoot',
      'a message from the Reddit mod team',
      'shopping cart tricks',
      'guitar coil pickup winding',
      'kink-shaming is bad',
      'breastfeeding support group',
    ]) {
      expect(screenTitle(title, LISTS)).toBeNull();
    }
  });

  it('ambiguous singles enrich the detail when a high-confidence hit fires', () => {
    const hit = screenTitle('sexy vape pod mod review', LISTS);
    expect(hit).toMatchObject({ signal: 'vape', matched: 'vape' });
    expect(hit?.detail).toContain('sexy');
    expect(hit?.detail).toContain('pod');
  });

  it('ambiguous phrases trigger as exact phrases only', () => {
    expect(screenTitle('new mech mod review', LISTS)).toMatchObject({ signal: 'vape' });
    // "mod" alone in the same text shape does not trigger.
    expect(screenTitle('new mod review', LISTS)).toBeNull();
    expect(screenTitle('adult content warning', LISTS)).toMatchObject({ signal: 'sex' });
  });

  it('phrases are exact: "vape pens" does not match listed "vape pen"', () => {
    expect(screenTitle('vape pens compared', { ...LISTS, vapeHigh: ['vape pen'] })).toBeNull();
    expect(screenTitle('vape pen compared', { ...LISTS, vapeHigh: ['vape pen'] })).toMatchObject({
      signal: 'vape',
    });
  });

  it('finds nothing with empty lists except language', () => {
    const empty = { sexualHigh: [], sexualAmbiguous: [], vapeHigh: [], vapeAmbiguous: [] };
    expect(screenTitle('my vape pen', empty)).toBeNull();
    expect(screenTitle('मुंबई खबरें ताज़ा अपडेट यहाँ पढ़ें', empty)).toMatchObject({
      signal: 'non-en',
    });
  });
});

describe('tier0Screen', () => {
  it('is inactive without a seen set (old behavior preserved)', () => {
    expect(tier0Screen({ subreddit: 'newsub', title: 'vape pen' }, undefined, LISTS)).toBeNull();
    expect(tier0Screen({ subreddit: 'newsub', title: 'vape pen' }, null, LISTS)).toBeNull();
  });

  it('ignores seen subreddits and unreadable ones', () => {
    const seen = new Set(['newsub']);
    expect(tier0Screen({ subreddit: 'r/NewSub', title: 'vape pen' }, seen, LISTS)).toBeNull();
    expect(tier0Screen({ subreddit: null, title: 'vape pen' }, new Set(), LISTS)).toBeNull();
  });

  it('flags unseen subreddits with a title hit', () => {
    expect(tier0Screen({ subreddit: 'fresh', title: 'my vape pen' }, new Set(), LISTS)).toMatchObject({
      signal: 'vape',
    });
    expect(tier0Screen({ subreddit: 'fresh', title: 'cute cats' }, new Set(), LISTS)).toBeNull();
  });
});

describe('buildSeenSet / autoBlockReason', () => {
  it('normalizes like the digest (r/-prefix, case, URLs)', () => {
    expect(buildSeenSet(['r/Cats', 'DOGS', 'https://www.reddit.com/r/Birds/', null, '', '  '])).toEqual(
      new Set(['cats', 'dogs', 'birds']),
    );
  });

  it('marks automatic reasons distinctly from manual blocks', () => {
    expect(autoBlockReason('sex')).toBe('auto-content:sex');
    expect(autoBlockReason('vape')).toBe('auto-content:vape');
    expect(autoBlockReason('non-en')).toBe('auto-content:non-en');
  });
});
