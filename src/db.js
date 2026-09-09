const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "..", "tasks.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT 0
  )
`);

const { count } = db.prepare("SELECT COUNT(*) AS count FROM tasks").get();

if (count === 0) {
  const insert = db.prepare(
    "INSERT INTO tasks (title, done) VALUES (?, ?)"
  );

  insert.run("Buy groceries", 0);
  insert.run("Finish report", 1);
  insert.run("Call the dentist", 0);
}

module.exports = db;
