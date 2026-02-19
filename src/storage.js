const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const dbFile = path.join(__dirname, '..', 'data', 'db.json');

const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { contents: [], comments: [] });

async function initDb() {
  await db.read();
  db.data = db.data || { contents: [], comments: [] };
  await db.write();
}

module.exports = {
  db,
  initDb,
};

