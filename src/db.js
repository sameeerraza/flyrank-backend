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

// --- CRUD: still broken on purpose. Stage 2 (create/read) and Stage 3
// (update/delete) will port these to real SQL queries. ---

function getAllTasks() {
  throw new Error("getAllTasks not implemented yet (Stage 2)");
}

function getTaskById(id) {
  throw new Error("getTaskById not implemented yet (Stage 2)");
}

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
