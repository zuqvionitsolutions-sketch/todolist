# To-Do List

Plain HTML/CSS/JavaScript frontend served by Express, with MariaDB persistence through mysql2. User accounts and todos are stored in MariaDB. Todo queries are always scoped to the signed-in user's account.

## Requirements and local setup

Use Node.js 20.19 or newer and MariaDB 10.6 or newer. The MariaDB command-line client is available as mariadb when its bin folder is on PATH.

1. Create the database and tables by running schema.sql with an administrator account. For example, from PowerShell:

   Get-Content -Raw schema.sql | & 'C:\Program Files\MariaDB 12.3\bin\mariadb.exe' -u root -p

2. Create a MariaDB account with access to todo_app, then copy .env.example to .env and set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and AUTH_SECRET. For a local-only database, an administrator can create the app account with CREATE USER 'todo_app'@'localhost' IDENTIFIED BY 'use-a-strong-password'; followed by GRANT SELECT, INSERT, UPDATE, DELETE ON todo_app.* TO 'todo_app'@'localhost';. Use a random AUTH_SECRET of at least 32 characters.
3. Install and start the app:

   npm install

   npm start

Open http://localhost:3000. For development with Node's watcher, run npm run dev.

Set APP_ORIGIN to the exact origin used to open the app. Set TRUST_PROXY=1 only if exactly one trusted reverse proxy sits in front of Node. Keep .env private; never put database credentials in frontend code.

## API

All todo routes require the signed, HttpOnly session cookie. Each query is scoped to the signed-in user.

- GET /api/todos lists the current user's todos
- GET /api/todos/:id fetches one todo
- POST /api/todos creates a todo
- PATCH /api/todos/:id updates supplied fields
- DELETE /api/todos/:id deletes a todo
- POST /api/auth/signup, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me provide the account flow

Todo fields include title, description, completed, category, priority, dueDate, createdAt, and updatedAt. text remains accepted as a title alias. The /api/tasks routes remain compatibility aliases. Signup and login are rate limited, and the app rejects requests from a different origin when APP_ORIGIN is configured.

## Existing data and migration

schema.sql creates the MariaDB database and tables for a new installation. If you already have the older todo_app.tasks table, run auth-migration.sql instead. Existing tasks without an account remain unassigned; assign them deliberately before making them account-visible.

The app previously used MongoDB. MongoDB accounts and tasks are not copied automatically. Export and import those records into MariaDB separately if they need to be retained.

## Render deployment

The `render.yaml` Blueprint deploys the Express app as a Render web service in Frankfurt. The MariaDB database remains on SkySQL in the `sky` database. During Blueprint setup, provide `DB_PASSWORD`; Render generates `AUTH_SECRET`. The app uses Render's `RENDER_EXTERNAL_URL` for same-origin checks. Keep TLS enabled with `DB_SSL=true`. If SkySQL restricts network access, allow the outbound IP ranges shown for the Render service. The free web service can sleep after inactivity and take about a minute to resume.

Do not expose database credentials in Git or frontend variables. Keep `.env` private.