// Resolve only machine-generated contributor credits during upstream merges.
// Any unrelated or ambiguous conflict remains a manual-review failure.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const allowed = new Set(['README.md', 'README.zh-CN.md', 'docs/README.en.md']);
const start = '<!-- CONTRIBUTORS:START -->';
const end = '<!-- CONTRIBUTORS:END -->';
const unmerged = execFileSync('git', ['diff', '--name-only', '--diff-filter=U', '-z'])
  .toString('utf8').split('\0').filter(Boolean);

function abort(message) {
  console.error('Unsafe contributor merge: ' + message);
  process.exit(1);
}
if (!unmerged.length || unmerged.some(p => !allowed.has(p))) {
  abort('Non-contributor conflicts or no unmerged contributor files: ' + unmerged.join(', '));
}
const snapshot = JSON.parse(fs.readFileSync('.github/contributors.json', 'utf8'));
if (!Array.isArray(snapshot)) abort('Invalid contributors snapshot');
const peopleByLogin = new Map();
for (const person of snapshot) {
  if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(person.login ?? '') ||
      !Number.isSafeInteger(person.id) || person.id <= 0) {
    abort('Invalid contributor entry');
  }
  peopleByLogin.set(person.login.toLowerCase(), { login: person.login, id: person.id });
}
const manual = [...fs.readFileSync('CONTRIBUTORS.md', 'utf8')
  .matchAll(/\]\(https:\/\/github\.com\/([a-z\d-]+)\)/gi)].map(m => m[1]);
for (const name of manual) {
  if (!peopleByLogin.has(name.toLowerCase())) abort('Missing curated contributor: ' + name);
}
const rank = new Map(manual.map((login, i) => [login.toLowerCase(), i]));
const people = [...peopleByLogin.values()].sort((a, b) =>
  (rank.get(a.login.toLowerCase()) ?? 10000) - (rank.get(b.login.toLowerCase()) ?? 10000) ||
  a.login.toLowerCase().localeCompare(b.login.toLowerCase(), 'en'));
const cells = people.map(p =>
  '    <td align="center" width="120"><a href="https://github.com/' + p.login +
  '"><img src="https://avatars.githubusercontent.com/u/' + p.id +
  '?s=112" width="56" height="56" alt="' + p.login + '" /><br /><sub>' +
  p.login + '</sub></a></td>');
const rows = [];
for (let i = 0; i < cells.length; i += 6) {
  rows.push('  <tr>\n' + cells.slice(i, i + 6).join('\n') + '\n  </tr>');
}
const block = start + '\n<table>\n' + rows.join('\n') + '\n</table>\n' + end;

// Git's merge markers are only eligible when ALL conflicting lines are
// machine-generated HTML cells or table row wrappers inside this block.
const conflictRe = /^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*\n/gm;
const cellRe = /^\s*<td align="center" width="120"><a href="https:\/\/github\.com\/[a-z\d-]+"><img src="https:\/\/avatars\.githubusercontent\.com\/u\/\d+\?s=112" width="56" height="56" alt="[a-z\d-]+" \/><br \/><sub>[a-z\d-]+<\/sub><\/a><\/td>$/i;
function validSide(side) {
  return side.split('\n').every(line => !line ||
    cellRe.test(line) || /^\s*<\/?tr>$/.test(line));
}
const replacements = [];
for (const filename of unmerged) {
  const original = fs.readFileSync(filename, 'utf8');
  if (original.split(start).length !== 2 || original.split(end).length !== 2) {
    abort('Missing or duplicate credits markers in ' + filename);
  }
  const from = original.indexOf(start), to = original.indexOf(end);
  if (from < 0 || to < from) abort('Misordered credits markers: ' + filename);
  const before = original.slice(0, from), section = original.slice(from + start.length, to);
  const after = original.slice(to + end.length);
  const markerRe = /^(?:<<<<<<< |=======\s*$|>>>>>>> )/m;
  if (markerRe.test(before) || markerRe.test(after)) abort('Conflict outside credits: ' + filename);
  const matches = [...section.matchAll(conflictRe)];
  if (!matches.length || matches.some(m => !validSide(m[1]) || !validSide(m[2]))) {
    abort('Unexpected conflict content in ' + filename);
  }
  const stripped = section.replace(conflictRe, '');
  if (markerRe.test(stripped)) abort('Malformed or nested conflict markers: ' + filename);
  replacements.push([filename, before + block + after]);
}
for (const [filename, output] of replacements) fs.writeFileSync(filename, output);
execFileSync('git', ['add', ...unmerged], { stdio: 'inherit' });
if (execFileSync('git', ['diff', '--name-only', '--diff-filter=U']).toString().trim()) {
  abort('Other files remain unmerged');
}
execFileSync('node', ['scripts/update-contributors.mjs', '--check'], { stdio: 'inherit' });
console.log('Resolved generated contributor credits in: ' + unmerged.join(', '));
