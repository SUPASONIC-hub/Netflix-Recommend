const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const TARGET_DIRS = ['src', 'public', 'prisma', '.github'];
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.json',
  '.ejs',
  '.css',
  '.html',
  '.md',
  '.yml',
  '.yaml',
  '.sql',
  '.prisma',
]);
const REPLACEMENT_CHAR = '\uFFFD';

function walk(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(REPLACEMENT_CHAR)) {
    return {
      ok: false,
      reason: 'contains replacement character (U+FFFD)',
    };
  }
  return { ok: true };
}

const failures = [];
for (const relDir of TARGET_DIRS) {
  const absDir = path.join(ROOT_DIR, relDir);
  if (!fs.existsSync(absDir)) continue;
  for (const filePath of walk(absDir)) {
    if (!isTextFile(filePath)) continue;
    const result = checkFile(filePath);
    if (!result.ok) {
      failures.push({
        path: path.relative(ROOT_DIR, filePath),
        reason: result.reason,
      });
    }
  }
}

if (failures.length > 0) {
  console.error('Encoding check failed:');
  failures.forEach((failure) => {
    console.error(`- ${failure.path}: ${failure.reason}`);
  });
  process.exit(1);
}

console.log('Encoding check passed.');
