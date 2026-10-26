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
  screenSubredditName,
  tier0Screen,
  buildSeenSet,
  autoBlockReason,
} from '../utils/content-screen';

const LISTS = {
  sexualHigh: ['porn', 'nsfw', 'escort', 'sex toy'],
  sexualAmbiguous: ['kink', 'sexy', 'breasts', 'adult content'],
  vapeHigh: ['vape', 'e-liquid', 'vape pen'],
  vapeAmbiguous: ['mod', 'pod', 'cart', 'coil', 'mech mod', 'smoking'],
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

  it('flags whole-word dojo in title or content (case-insensitive)', () => {
    expect(screenTitle('Join my Dojo today', LISTS)).toMatchObject({ signal: 'dojo', matched: 'dojo' });
    expect(screenTitle('WELCOME TO THE DOJO', LISTS)).toMatchObject({ signal: 'dojo' });
    expect(screenFullContent('clean title', 'visit our dojo this weekend', LISTS)).toMatchObject({
      signal: 'dojo',
      matched: 'dojo',
    });
  });

  it('does not stem dojo ("dojos" alone never matches)', () => {
    expect(screenTitle('best dojos in town', LISTS)).toBeNull();
  });

  it('checks sex before vape before dojo before crypto', () => {
    expect(screenTitle('porn dojo review', LISTS)).toMatchObject({ signal: 'sex' });
    expect(screenTitle('vape dojo review', LISTS)).toMatchObject({ signal: 'vape' });
    expect(screenTitle('dojo bitcoin review', LISTS)).toMatchObject({ signal: 'dojo' });
  });

  it('flags whole-word crypto terms in title or content (case-insensitive)', () => {
    expect(screenTitle('Best Bitcoin wallet 2026', LISTS)).toMatchObject({ signal: 'crypto', matched: 'bitcoin' });
    expect(screenTitle('CRYPTO signals group', LISTS)).toMatchObject({ signal: 'crypto' });
    expect(screenFullContent('clean title', 'start investing with $10 today', LISTS)).toMatchObject({
      signal: 'crypto',
      matched: 'investing',
    });
    expect(screenTitle('new ethereum defi nft drop', LISTS)).toMatchObject({ signal: 'crypto' });
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

describe('screenSubredditName (substring rules for names)', () => {
  it('blocks exact high-confidence names', () => {
    expect(screenSubredditName('masturbation', LISTS)).toMatchObject({ decision: 'block', signal: 'sex' });
    expect(screenSubredditName('porn', LISTS)).toMatchObject({ decision: 'block' });
    expect(screenSubredditName('nsfw', LISTS)).toMatchObject({ decision: 'block' });
  });

  it('blocks high substrings inside compound names', () => {
    // Bare `sex` is a name-screening root (absent from the content lists).
    expect(screenSubredditName('sexpositive')).toMatchObject({ decision: 'block', signal: 'sex', matched: 'sex' });
    expect(screenSubredditName('middlesex')).toMatchObject({ decision: 'block', matched: 'sex' });
    expect(screenSubredditName('sexed')).toMatchObject({ decision: 'block', matched: 'sex' });
    expect(screenSubredditName('vapers', LISTS)).toMatchObject({ decision: 'block', signal: 'vape' });
  });

  it('blocks crypto substrings in compound names', () => {
    expect(screenSubredditName('bitcoin', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'crypto',
      matched: 'bitcoin',
    });
    expect(screenSubredditName('cryptocurrency', LISTS)).toMatchObject({ decision: 'block', signal: 'crypto' });
    expect(screenSubredditName('ethereum', LISTS)).toMatchObject({ decision: 'block', signal: 'crypto' });
  });

  it('blocks dojo substrings in compound names', () => {
    expect(screenSubredditName('dojo_fans', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'dojo',
      matched: 'dojo',
    });
    expect(screenSubredditName('mydojo', LISTS)).toMatchObject({ decision: 'block', signal: 'dojo' });
  });

  it('blocks whole underscore tokens', () => {
    expect(screenSubredditName('vape_porn', LISTS)).toMatchObject({ decision: 'block' });
  });

  it('quarantines (never blocks) ambiguous substrings', () => {
    for (const sub of ['moderators', 'cartoons', 'podcasts', 'smoking', 'kinkshaming', 'coil_winding']) {
      const hit = screenSubredditName(sub, LISTS);
      expect(hit.decision).toBe('quarantine');
      expect(hit.signal).toBeNull();
    }
  });

  it('a high root inside an ambiguous word still blocks (sex wins over sexy)', () => {
    // `sexy_cars` contains bare `sex` → block, not quarantine. Directive-consistent.
    expect(screenSubredditName('sexy_cars', LISTS)).toMatchObject({ decision: 'block', matched: 'sex' });
  });

  it('keeps acronyms exact-only (rta must not fire on startups)', () => {
    const lists = { ...LISTS, vapeHigh: [...LISTS.vapeHigh, 'rta'] };
    expect(screenSubredditName('startups', lists).decision).toBe('pass');
    expect(screenSubredditName('rta', lists)).toMatchObject({ decision: 'block', matched: 'rta' });
    expect(screenSubredditName('rta_guides', lists)).toMatchObject({ decision: 'block', matched: 'rta' });
  });

  it('blocks US place-name substrings (signal place)', () => {
    expect(screenSubredditName('dallas', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'place',
      matched: 'dallas',
    });
    expect(screenSubredditName('texasraves', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'place',
      matched: 'texas',
    });
    expect(screenSubredditName('sanantonio', LISTS)).toMatchObject({ decision: 'block', signal: 'place' });
  });

  it('keeps short/ambiguous place words exact-only', () => {
    expect(screenSubredditName('austin', LISTS)).toMatchObject({ decision: 'block', signal: 'place' });
    expect(screenSubredditName('austin_texas', LISTS)).toMatchObject({ decision: 'block', signal: 'place' });
    // Substrings of ordinary words never fire.
    for (const sub of ['austinpowers', 'michaeljackson', 'mobilelegends', 'mainecoon', 'columbiarecords', 'parishilton', 'reno911', 'phoenixwright', 'mesaboogie']) {
      expect(screenSubredditName(sub, LISTS).decision).toBe('pass');
    }
    expect(screenSubredditName('maine', LISTS)).toMatchObject({ decision: 'block', signal: 'place' });
  });

  it('never blocks the exempt phone/truck names', () => {
    for (const sub of ['mobilegaming', 'mobilegames', 'toyotatacoma', 'mobile_gaming']) {
      expect(screenSubredditName(sub, LISTS).decision).toBe('pass');
    }
  });

  it('blocks university/college names (signal uni)', () => {
    expect(screenSubredditName('universityoftexas', LISTS)).toMatchObject({
      // `texas` (place) wins over `university` (uni) — either way it blocks.
      decision: 'block',
    });
    expect(screenSubredditName('mycollege', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'uni',
    });
    expect(screenSubredditName('syracuseu', LISTS)).toMatchObject({ decision: 'block' });
    expect(screenSubredditName('ucla', LISTS)).toMatchObject({ decision: 'block', signal: 'uni' });
    // `usc` sits inside `music` — exact-only keeps music clean.
    expect(screenSubredditName('usc', LISTS)).toMatchObject({ decision: 'block', signal: 'uni' });
    expect(screenSubredditName('usc_trojans', LISTS)).toMatchObject({ decision: 'block', signal: 'uni' });
    expect(screenSubredditName('music', LISTS).decision).toBe('pass');
  });

  it('place/uni terms never fire on title/content (name screening only)', () => {
    expect(screenTitle('dallas cowboys news today', LISTS)).toBeNull();
    expect(screenTitle('my university ranking list', LISTS)).toBeNull();
    expect(screenFullContent('austin trip', 'texas bbq and live music', LISTS)).toBeNull();
  });

  it('blocks Philippines-related names (signal ph)', () => {
    expect(screenSubredditName('philippines', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'ph',
      matched: 'philippin',
    });
    expect(screenSubredditName('filipinoamericans', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'ph',
      matched: 'filipino',
    });
    expect(screenSubredditName('manila', LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
    expect(screenSubredditName('cebucity', LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
    expect(screenSubredditName('pinoymemes', LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
  });

  it('ignores underscores in Philippine place names', () => {
    for (const sub of ['cagayan_de_oro', 'lanao_del_norte', 'negros_occidental', 'south_cotabato']) {
      expect(screenSubredditName(sub, LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
    }
  });

  it('keeps short/ambiguous Philippine place words exact-only', () => {
    expect(screenSubredditName('laguna', LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
    expect(screenSubredditName('lagunabeach', LISTS).decision).toBe('pass');
    expect(screenSubredditName('samar', LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
    expect(screenSubredditName('samaritan', LISTS).decision).toBe('pass');
    expect(screenSubredditName('cagayan', LISTS)).toMatchObject({ decision: 'block', signal: 'ph' });
    expect(screenSubredditName('cagayanvalley', LISTS)).toMatchObject({
      decision: 'block',
      signal: 'ph',
      matched: 'cagayanvalley',
    });
  });

  it('philippines terms never fire on title/content (name screening only)', () => {
    expect(screenTitle('moving to manila next year', LISTS)).toBeNull();
    expect(screenFullContent('a cebu trip', 'filipino food and karaoke', LISTS)).toBeNull();
  });

  it('hyphenated terms and spaced phrases are inert in names', () => {
    // 'e-liquid' cannot occur in a subreddit name (no hyphens allowed).
    expect(screenSubredditName('eliquid', LISTS).decision).toBe('pass');
    // 'adult content' / 'mech mod' carry spaces — unmatchable, by design.
    expect(screenSubredditName('adultcontent', LISTS).decision).toBe('pass');
  });

  it('passes clean and empty names', () => {
    expect(screenSubredditName('cats', LISTS).decision).toBe('pass');
    expect(screenSubredditName('peacocks', LISTS).decision).toBe('pass');
    expect(screenSubredditName(null, LISTS).decision).toBe('pass');
    expect(screenSubredditName('', LISTS).decision).toBe('pass');
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
    expect(autoBlockReason('dojo')).toBe('auto-content:dojo');
    expect(autoBlockReason('place')).toBe('auto-content:place');
    expect(autoBlockReason('uni')).toBe('auto-content:uni');
    expect(autoBlockReason('ph')).toBe('auto-content:ph');
    expect(autoBlockReason('crypto')).toBe('auto-content:crypto');
    expect(autoBlockReason('non-en')).toBe('auto-content:non-en');
  });
});
