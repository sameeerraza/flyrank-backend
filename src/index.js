const express = require("express");
const swaggerUi = require("swagger-ui-express");
const openapiSpec = require("../openapi.json");
const { supabase, checkSupabase, signOutUser } = require("./supabase");
const { requireAuth } = require("./authMiddleware");
const {
  init,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
} = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.get("/", (req, res) => {
  res.json({ name: "Task API", version: "1.0", endpoints: ["/tasks"] });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/auth/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json(data.user);
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return res.status(401).json({ error: "Invalid login credentials" });
  }

  res.status(200).json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});

app.get("/public/info", (req, res) => {
  res.status(200).json({ message: "Welcome stranger! This info is public." });
});

app.get("/protected/profile", requireAuth, (req, res) => {
  res.status(200).json({
    id: req.user.id,
    email: req.user.email,
    created_at: req.user.created_at,
  });
});

app.get("/protected/dashboard", requireAuth, (req, res) => {
  res.status(200).json({ message: `Welcome to your dashboard, ${req.user.email}` });
});

app.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    await signOutUser(req.token);
  } catch (err) {
    return res.status(500).json({ error: "Failed to log out" });
  }

  res.status(204).send();
});

app.get("/tasks", async (req, res) => {
  res.json(await getAllTasks());
});

app.get("/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  const task = await getTaskById(id);

  if (!task) {
    return res.status(404).json({ error: `Task ${id} not found` });
  }

  res.json(task);
});

app.post("/tasks", async (req, res) => {
  const { title } = req.body;

  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "Title is required" });
  }

  const newTask = await createTask(title.trim());

  res.status(201).json(newTask);
});

app.put("/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  const task = await getTaskById(id);

  if (!task) {
    return res.status(404).json({ error: `Task ${id} not found` });
  }

  const { title, done } = req.body;

  if (title === undefined && done === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return res.status(400).json({ error: "Title must be a non-empty string" });
  }

  if (done !== undefined && typeof done !== "boolean") {
    return res.status(400).json({ error: "Done must be a boolean" });
  }

  const updatedTask = await updateTask(id, {
    title: title !== undefined ? title.trim() : undefined,
    done,
  });

  res.status(200).json(updatedTask);
});

app.delete("/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  if (!(await deleteTask(id))) {
    return res.status(404).json({ error: `Task ${id} not found` });
  }

  res.status(204).send();
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

Promise.all([init(), checkSupabase()])
    .then(() => {
      app.listen(PORT, () => {
        console.log("Server running and connected to Supabase");
        console.log(`Listening on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Startup failed:", err);
      process.exit(1);
    });