const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Stage 1: create the table if it's missing, then seed 3 example tasks
// only when the table is completely empty.
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false
    )
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM tasks");

  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO tasks (title, done) VALUES
        ($1, $2), ($3, $4), ($5, $6)`,
      ["Buy groceries", false, "Finish report", true, "Call the dentist", false]
    );
  }
}

// --- Stage 2: read operations on real SQL. No toTask helper — Postgres
// returns `done` as a real boolean already. ---

async function getAllTasks() {
  const { rows } = await pool.query(
    "SELECT id, title, done FROM tasks ORDER BY id"
  );
  return rows;
}

async function getTaskById(id) {
  const { rows } = await pool.query(
    "SELECT id, title, done FROM tasks WHERE id = $1",
    [id]
  );
  return rows[0];
}

// --- Stage 3: write operations. Every statement uses RETURNING so the
// updated row comes back in the same round trip — no follow-up SELECT
// like the SQLite version needed. ---

async function createTask(title) {
  const { rows } = await pool.query(
    "INSERT INTO tasks (title, done) VALUES ($1, false) RETURNING id, title, done",
    [title]
  );
  return rows[0];
}

// The route passes { title, done } with either key possibly undefined.
// pg sends undefined as NULL, and COALESCE($n, col) keeps the existing
// value when the argument is NULL. Safe here because both columns are
// NOT NULL, so a real NULL is never a valid target.
async function updateTask(id, { title, done }) {
  const { rows } = await pool.query(
    `UPDATE tasks
        SET title = COALESCE($1, title),
            done  = COALESCE($2, done)
      WHERE id = $3
      RETURNING id, title, done`,
    [title ?? null, done ?? null, id]
  );
  return rows[0];
}

async function deleteTask(id) {
  const result = await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
  return result.rowCount > 0;
}

module.exports = {
  init,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
};
