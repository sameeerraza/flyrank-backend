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

// --- Stage 3: still broken on purpose. createTask, updateTask and
// deleteTask will be ported to real SQL queries in Stage 3. ---

function createTask(title) {
  throw new Error("createTask not implemented yet (Stage 2)");
}

function updateTask(id, fields) {
  throw new Error("updateTask not implemented yet (Stage 3)");
}

function deleteTask(id) {
  throw new Error("deleteTask not implemented yet (Stage 3)");
}

module.exports = {
  init,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
};
