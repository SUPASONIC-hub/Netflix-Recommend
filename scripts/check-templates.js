const fs = require('node:fs');
const path = require('node:path');

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const files = fs
  .readdirSync(viewsDir, { withFileTypes: true })
  .flatMap((entry) => {
    if (entry.isFile() && entry.name.endsWith('.ejs')) {
      return [path.join(viewsDir, entry.name)];
    }
    if (entry.isDirectory()) {
      const nestedDir = path.join(viewsDir, entry.name);
      return fs
        .readdirSync(nestedDir, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.ejs'))
        .map((f) => path.join(nestedDir, f.name));
    }
    return [];
  });

const brokenTagPattern = /(?<!<)\/(a|h1|h2|h3|h4|h5|title|button|option|p|summary|label)>/g;
const replacementCharPattern = /\uFFFD/g;

const issues = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (brokenTagPattern.test(text)) {
    issues.push(`${file}: broken closing tag pattern found`);
  }
  if (replacementCharPattern.test(text)) {
    issues.push(`${file}: replacement character(�) found`);
  }
}

if (issues.length) {
  console.error('Template integrity check failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('Template integrity check passed.');
