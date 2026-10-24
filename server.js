const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const secret = process.env.AUTH_SECRET;
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'todo_app',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  dateStrings: true,
  charset: 'utf8mb4'
});
if (!secret || secret.length < 32) throw Error('Set AUTH_SECRET in .env to a random value of at least 32 characters.');
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
  throw Error('Set DB_HOST, DB_USER, and DB_NAME in .env.');
}

const COOKIE = 'todo_session';
const TTL = 604800;
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(express.json({ limit: '20kb' }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});
app.use((req, res, next) => {
  const origin = req.get('Origin');
  const allowedOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  if (origin && allowedOrigin && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }
  next();
});
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'Untitled-09.html')));


function sign(payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function setSession(res, id) {
  const payload = String(id) + '.' + (Math.floor(Date.now() / 1000) + TTL);
  const token = payload + '.' + sign(payload);
  res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + TTL + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}
function sessionId(req) {
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  let token = '';
  try { token = cookie ? decodeURIComponent(cookie.slice(COOKIE.length + 1)) : ''; } catch {}
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[1-9]\d*$/.test(parts[0])) return null;
  const payload = parts[0] + '.' + parts[1];
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parts[2]);
  const expiry = Number(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual) || !Number.isSafeInteger(expiry) || expiry <= Date.now() / 1000) return null;
  return Number(parts[0]);
}
function auth(req, res, next) {
  const id = sessionId(req);
  if (!id) return res.status(401).json({ error: 'Please log in to continue.' });
  req.userId = id;
  next();
}
function validDob(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date) && date.toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
}
function hashDob(value, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(value, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
}
function equalHex(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
function validDate(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date) && date.toISOString().slice(0, 10) === value;
}
function parseTask(body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object.' };
  const value = {};
  const title = body.title === undefined ? body.text : body.title;
  if (!partial || title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 500) return { error: 'Title must be 1 to 500 characters.' };
    value.title = title.trim();
  }
  if (!partial || body.description !== undefined) {
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 5000)) return { error: 'Description must be at most 5000 characters.' };
    value.description = body.description || '';
  }
  for (const key of ['category', 'priority', 'dueDate', 'completed']) {
    const item = body[key];
    if (item === undefined) {
      if (!partial) value[key] = ({ category: 'General', priority: 'Medium', dueDate: '', completed: false })[key];
      continue;
    }
    if (key === 'category') {
      if (typeof item !== 'string' || item.trim().length > 100) return { error: 'Invalid category.' };
      value[key] = item.trim() || 'General';
    } else if (key === 'priority') {
      if (!['Low', 'Medium', 'High'].includes(item)) return { error: 'Invalid priority.' };
      value[key] = item;
    } else if (key === 'dueDate') {
      if (!validDate(item)) return { error: 'Due date must be YYYY-MM-DD or empty.' };
      value[key] = item;
    } else {
      if (typeof item !== 'boolean') return { error: 'Completed must be true or false.' };
      value[key] = item;
    }
  }
  return { value };
}
function taskOut(row) {
  const id = String(row.id);
  const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : '';
  return {
    id, _id: id, title: row.task_text, description: row.description || '', text: row.task_text,
    category: row.category, priority: row.priority, dueDate, completed: Boolean(row.completed),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
async function findUserByName(nameKey) {
  const [rows] = await pool.execute('SELECT id, display_name, dob_salt, dob_hash FROM users WHERE name_key = ?', [nameKey]);
  return rows;
}
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const id = sessionId(req);
  if (!id) return res.json({ user: null });
  const [rows] = await pool.execute('SELECT id, display_name FROM users WHERE id = ?', [id]);
  if (!rows.length) {
    clearSession(res);
    return res.json({ user: null });
  }
  res.json({ user: { id: String(rows[0].id), name: rows[0].display_name } });
}));
app.post('/api/auth/signup', authLimiter, asyncRoute(async (req, res) => {
  const displayName = normalizeName(req.body?.name);
  const dob = req.body?.dateOfBirth;
  if (displayName.length < 2 || displayName.length > 100) return res.status(400).json({ error: 'Name must be 2 to 100 characters.' });
  if (!validDob(dob)) return res.status(400).json({ error: 'Enter a valid date of birth.' });
  const nameKey = displayName.toLocaleLowerCase('en-US');
  for (const user of await findUserByName(nameKey)) {
    if (equalHex(await hashDob(dob, user.dob_salt), user.dob_hash)) return res.status(409).json({ error: 'This account already exists. Please log in.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const dobHash = await hashDob(dob, salt);
  const [result] = await pool.execute('INSERT INTO users (display_name, name_key, dob_salt, dob_hash) VALUES (?, ?, ?, ?)', [displayName, nameKey, salt, dobHash]);
  setSession(res, result.insertId);
  res.status(201).json({ user: { id: String(result.insertId), name: displayName } });
}));
app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const displayName = normalizeName(req.body?.name);
  const dob = req.body?.dateOfBirth;
  if (!displayName || !validDob(dob)) return res.status(400).json({ error: 'Enter your name and a valid date of birth.' });
  for (const user of await findUserByName(displayName.toLocaleLowerCase('en-US'))) {
    if (equalHex(await hashDob(dob, user.dob_salt), user.dob_hash)) {
      setSession(res, user.id);
      return res.json({ user: { id: String(user.id), name: user.display_name } });
    }
  }
  res.status(401).json({ error: 'Name or date of birth did not match.' });
}));
app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });

const SELECT_TASKS = 'SELECT id, task_text, description, category, priority, due_date, completed, created_at, updated_at FROM tasks';
async function list(req, res) {
  const [rows] = await pool.execute(SELECT_TASKS + ' WHERE user_id = ? ORDER BY created_at ASC, id ASC', [req.userId]);
  res.json(rows.map(taskOut));
}
async function get(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid task id.' });
  const [rows] = await pool.execute(SELECT_TASKS + ' WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
  res.json(taskOut(rows[0]));
}
async function create(req, res) {
  const parsed = parseTask(req.body, false);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const task = parsed.value;
  const [result] = await pool.execute(
    'INSERT INTO tasks (user_id, task_text, description, category, priority, due_date, completed) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.userId, task.title, task.description, task.category, task.priority, task.dueDate || null, task.completed]
  );
  const [rows] = await pool.execute(SELECT_TASKS + ' WHERE id = ? AND user_id = ?', [result.insertId, req.userId]);
  res.status(201).json(taskOut(rows[0]));
}
async function patch(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid task id.' });
  const parsed = parseTask(req.body, true);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const fields = parsed.value;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Provide a field to update.' });
  const columns = { title: 'task_text', description: 'description', category: 'category', priority: 'priority', dueDate: 'due_date', completed: 'completed' };
  const assignments = Object.keys(fields).map(key => columns[key] + ' = ?');
  const values = Object.keys(fields).map(key => key === 'dueDate' ? (fields[key] || null) : fields[key]);
  values.push(req.params.id, req.userId);
  const [result] = await pool.execute('UPDATE tasks SET ' + assignments.join(', ') + ' WHERE id = ? AND user_id = ?', values);
  if (!result.affectedRows) {
    const [rows] = await pool.execute('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
  }
  const [rows] = await pool.execute(SELECT_TASKS + ' WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  res.json(taskOut(rows[0]));
}
async function remove(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid task id.' });
  const [result] = await pool.execute('DELETE FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Task not found.' });
  res.status(204).end();
}
app.get('/api/todos', auth, asyncRoute(list));
app.get('/api/todos/:id', auth, asyncRoute(get));
app.post('/api/todos', auth, asyncRoute(create));
app.patch('/api/todos/:id', auth, asyncRoute(patch));
app.delete('/api/todos/:id', auth, asyncRoute(remove));
app.get('/api/tasks', auth, asyncRoute(list));
app.post('/api/tasks', auth, asyncRoute(create));
app.put('/api/tasks/:id', auth, asyncRoute(patch));
app.patch('/api/tasks/:id', auth, asyncRoute(patch));
app.delete('/api/tasks/:id', auth, asyncRoute(remove));
app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Invalid JSON request body.' });
  console.error('Request failed:', error.code || error.name || 'Error');
  res.status(500).json({ error: 'Server error. Please try again later.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    app.listen(port, '0.0.0.0', () => console.log('To-do app listening on port ' + port + '; MariaDB connected.'));
  } catch (error) {
    console.error('MariaDB connection failed. Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and database permissions.');
    console.error('Database error code:', error.code || 'unknown');
    process.exitCode = 1;
    await pool.end();
  }
}
start();
