const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const roots = ['api', 'lib', 'src', 'public', 'test', 'scripts'];
const files = [];

function collect(path) {
  for (const name of readdirSync(path)) {
    const target = join(path, name);
    if (statSync(target).isDirectory()) collect(target);
    else if (target.endsWith('.js') || target.endsWith('.mjs')) files.push(target);
  }
}

for (const root of roots) collect(root);
files.push('vite.config.js');

let failed = false;
for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  if (contents.split('\n').some(line => /[ \t]+$/.test(line))) {
    console.error(`${file}: trailing whitespace`);
    failed = true;
  }
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    process.stderr.write(error.stderr || String(error));
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files`);
