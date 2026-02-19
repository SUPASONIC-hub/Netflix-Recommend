const fs = require('fs');
const path = require('path');

const dbFile = path.join(__dirname, '..', 'data', 'db.json');

function normalizeContent(content) {
  return {
    ...content,
    name: content.name || '',
    overview: content.overview || '',
    releaseDate: content.releaseDate || '',
    firstAirDate: content.firstAirDate || '',
    posterPath: content.posterPath || '',
    backdropPath: content.backdropPath || '',
    genreIds: Array.isArray(content.genreIds) ? content.genreIds : [],
    popularity:
      typeof content.popularity === 'number' ? content.popularity : null,
    voteAverage:
      typeof content.voteAverage === 'number' ? content.voteAverage : null,
    voteCount: typeof content.voteCount === 'number' ? content.voteCount : null,
    adult: typeof content.adult === 'boolean' ? content.adult : null,
    mediaType: content.mediaType || '',
  };
}

function run() {
  if (!fs.existsSync(dbFile)) {
    console.error('db.json not found:', dbFile);
    process.exit(1);
  }

  const raw = fs.readFileSync(dbFile, 'utf8');
  const data = JSON.parse(raw);
  const contents = Array.isArray(data.contents) ? data.contents : [];

  const migrated = contents.map(normalizeContent);
  const output = {
    contents: migrated,
    comments: Array.isArray(data.comments) ? data.comments : [],
  };

  fs.writeFileSync(dbFile, JSON.stringify(output, null, 2));
  console.log(`Migrated ${migrated.length} contents`);
}

run();
