import { normalizeSubreddit } from '../services/automation/subreddit';

describe('normalizeSubreddit', () => {
  it('normalizes r/ prefix and case', () => {
    expect(normalizeSubreddit('r/aiagents')).toBe('aiagents');
    expect(normalizeSubreddit('AIAGENTS')).toBe('aiagents');
    expect(normalizeSubreddit('  r/Mommit/ ')).toBe('mommit');
  });

  it('extracts from full URLs', () => {
    expect(normalizeSubreddit('https://reddit.com/r/aiagents')).toBe('aiagents');
    expect(normalizeSubreddit('https://www.reddit.com/r/ToyotaTacoma/comments/abc')).toBe('toyotatacoma');
  });

  it('does not loosely match (exact identity)', () => {
    expect(normalizeSubreddit('aiagents')).not.toBe('aiagents2');
    expect(normalizeSubreddit('r/aiagents')).not.toBe('aiagents2');
  });

  it('returns null for empty/invalid', () => {
    expect(normalizeSubreddit(null)).toBeNull();
    expect(normalizeSubreddit('')).toBeNull();
    expect(normalizeSubreddit('r/')).toBeNull();
    expect(normalizeSubreddit('not a sub!')).toBeNull();
  });
});
