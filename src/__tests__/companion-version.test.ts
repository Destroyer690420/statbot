/**
 * Companion version-change detection. Pure module — no env or DB needed.
 */
import { shouldLogVersionChange } from '../utils/companion-version';

describe('shouldLogVersionChange', () => {
  it('logs the first sighting of a version', () => {
    expect(shouldLogVersionChange(null, '1.4.4')).toBe(true);
    expect(shouldLogVersionChange(undefined, '1.4.4')).toBe(true);
  });

  it('logs upgrades and regressions alike', () => {
    expect(shouldLogVersionChange('1.4.0', '1.4.4')).toBe(true);
    expect(shouldLogVersionChange('1.4.4', '1.4.0')).toBe(true);
  });

  it('stays silent on steady state and missing versions', () => {
    expect(shouldLogVersionChange('1.4.4', '1.4.4')).toBe(false);
    expect(shouldLogVersionChange('1.4.4', null)).toBe(false);
    expect(shouldLogVersionChange(null, null)).toBe(false);
  });
});
