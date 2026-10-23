-- Run this only if you already created the original tasks table from schema.sql.
-- Existing tasks remain unassigned until you decide which account should own them.
USE todo_app;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  name_key VARCHAR(100) NOT NULL,
  dob_salt CHAR(32) NOT NULL,
  dob_hash CHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_name_key (name_key)
);

ALTER TABLE tasks ADD COLUMN user_id INT UNSIGNED NULL;
ALTER TABLE tasks ADD INDEX idx_tasks_user_created (user_id, created_at);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
