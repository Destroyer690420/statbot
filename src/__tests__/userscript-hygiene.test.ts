/**
 * Userscript hygiene: no executable code hiding inside comments.
 *
 * Regression test for the v1.1.0 submit-executor incident: a whitespace edit
 * merged `var input = dialog.querySelector(...)` onto the end of a `//`
 * comment line. The file stayed syntactically valid (node --check passed),
 * but every job died with `ReferenceError: input is not defined` after
 * opening the dialog. A comment line that declares a variable is never
 * legitimate in these scripts — flag it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = [
  'goparttime-send.user.js',
  'goparttime-auto.user.js',
  'goparttime-submit.user.js',
  'goparttime-mobile.user.js',
  'reddit-format-check.user.js',
];

// A `//` line containing `<var|let|const> <name> =` — i.e. a declaration that
// can never execute. Comment prose in these scripts never takes this shape
// (verified: zero hits across all scripts when this test was added).
const COMMENTED_DECLARATION = /^\s*\/\/.*\b(var|let|const)\s+[A-Za-z_$][\w$]*\s*=[^=]/;

describe.each(SCRIPTS)('%s has no commented-out declarations', (file) => {
  it('fails loudly instead of shipping a silent ReferenceError', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
    const bad = source.split('\n').filter((line) => COMMENTED_DECLARATION.test(line));
    expect(bad).toEqual([]);
  });
});
