# To-Do List

Plain HTML/CSS/JavaScript frontend served by Express, with MongoDB Atlas persistence through Mongoose. User accounts and todos are stored in MongoDB. Todos are always queried with the signed-in user's owner ID.

## Requirements and local setup

Use Node.js 20.19 or newer. From this folder:

```sh
npm ci
npm start
```

Open http://localhost:3000. For development with Node's watcher, run `npm run dev`.

Copy `.env.example` to `.env`, then set:

- `MONGODB_URI`: Atlas connection string for the `todolist` database.
- `AUTH_SECRET`: a random secret of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `APP_ORIGIN`: the exact origin users use to open this app (for local use, `http://localhost:3000`).
- `TRUST_PROXY=1` only if the app is behind exactly one trusted reverse proxy. Configure this to match your hosting platform.

Keep `.env` private. It is ignored by Git. Never place the Atlas URI in frontend code or public deployment variables.

## API

All todo routes require the existing signed, HttpOnly session cookie. Each query is scoped to the signed-in user.

- `GET /api/todos` — list the current user's todos
- `GET /api/todos/:id` — fetch one todo
- `POST /api/todos` — create a todo
- `PATCH /api/todos/:id` — update supplied fields
- `DELETE /api/todos/:id` — delete a todo
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — existing account flow

Todo fields include `title`, `description`, `completed`, `category`, `priority`, `dueDate`, `createdAt`, and `updatedAt`. `text` remains accepted as a title alias for the existing UI. The old `/api/tasks` routes remain as compatibility aliases.

The app is same-origin by default; it does not enable permissive CORS. When `APP_ORIGIN` is configured, requests carrying a different Origin are rejected. Signup and login are rate limited.

## Atlas setup and troubleshooting

In Atlas, create a database user with read/write access to `todolist`, and add the server's outbound IP address to **Network Access**. Do not use a public all-addresses allowlist to work around connection errors. Then copy the driver connection URI into the server's `MONGODB_URI` environment variable. URL-encode special characters in the database user's password.

If startup reports a connection failure:

1. Check that the URI uses the correct cluster host and database name.
2. Confirm the database user and password in Atlas, and that the user has read/write permission.
3. Confirm the deployment's outbound IP is allowed in Atlas Network Access.
4. Check DNS/SRV resolution and outbound access to Atlas from the hosting provider.
5. Check that `MONGODB_URI` is set in the running process environment and restart the app.

The server intentionally logs a generic connection message and does not return driver details or credentials to clients.

## Deployment

Deploy the Express app and static page together on a Node.js host, or serve them behind one same-origin reverse proxy. Set `NODE_ENV=production`, `MONGODB_URI`, a freshly generated `AUTH_SECRET`, and `APP_ORIGIN=https://your-domain.example` in the host's secret/environment settings. Set `TRUST_PROXY` only to the actual number of trusted proxies in front of Node. Install with `npm ci --omit=dev` and start with `npm start`. Terminate HTTPS at the host or trusted proxy; production session cookies are marked Secure.

The previous project used MariaDB. This change does not migrate old MariaDB accounts or tasks; the old database remains separate, and people need to sign up in the MongoDB-backed app. Export/import any old data separately before relying on the new database as the sole source of truth.

## Verification

The implementation was checked against the configured Atlas cluster. The API smoke checks covered account signup, todo create/list/detail/update/delete, invalid IDs and titles, and data visibility across two accounts. Temporary test records were deleted. A startup test against an unavailable local MongoDB endpoint confirmed a generic failure message. The existing app has no separate build step; `node --check server.js` and `npm ls --depth=0` are the available local checks.
