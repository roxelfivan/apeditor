import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'func_spec');
const files = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();

/** Mirror of the viewer's slugify() in src/components/FuncSpecDocs.tsx. */
const slugsFor = (md) => {
  const seen = new Map();
  const out = new Set();
  for (const line of md.split('\n')) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]
      .replace(/`/g, '')
      .replace(/\*\*?/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
    const base = text.toLowerCase().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
};

const byFile = new Map(files.map((f) => [f, slugsFor(readFileSync(join(DIR, f), 'utf8'))]));
const problems = [];
let internal = 0;
let external = 0;

for (const f of files) {
  const md = readFileSync(join(DIR, f), 'utf8');

  // Control characters that would make grep treat the file as binary.
  const bad = [...md].filter((c) => {
    const n = c.charCodeAt(0);
    return n < 9 || (n > 10 && n < 32 && n !== 13);
  });
  if (bad.length) problems.push(`CONTROL ${f}: ${bad.length} control char(s)`);

  const re = /\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    const href = m[1];
    if (/^(https?:|mailto:)/.test(href)) { external++; continue; }

    const [rel, anchor] = href.split('#');
    if (!rel) {
      // In-page anchor.
      internal++;
      if (!byFile.get(f).has(decodeURIComponent(anchor ?? ''))) {
        problems.push(`ANCHOR  ${f} -> #${anchor}`);
      }
      continue;
    }

    internal++;
    const target = resolve(dirname(join(DIR, f)), rel);
    if (!existsSync(target)) { problems.push(`PATH    ${f} -> ${href}`); continue; }
    if (anchor && statSync(target).isFile() && rel.endsWith('.md')) {
      const tf = rel.split('/').pop();
      if (!byFile.get(tf)?.has(decodeURIComponent(anchor))) {
        problems.push(`ANCHOR  ${f} -> ${href}  (missing in ${tf})`);
      }
    }
  }
}

for (const p of problems) console.log(p);
console.log(`\nfiles=${files.length} internal_links=${internal} external_links=${external} problems=${problems.length}`);
process.exit(problems.length ? 1 : 0);