-- Run against an existing todo_app database before starting the MariaDB app.
-- Existing tasks without a user_id remain unassigned and are not shown to accounts.
USE todo_app;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  name_key VARCHAR(100) NOT NULL,
  dob_salt CHAR(32) NOT NULL,
  dob_hash CHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_name_key (name_key)
) ENGINE=InnoDB;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS user_id INT UNSIGNED NULL AFTER id,
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '' AFTER task_text,
  ADD INDEX IF NOT EXISTS idx_tasks_user_created (user_id, created_at);

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND CONSTRAINT_NAME = 'fk_tasks_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @fk_sql = IF(@fk_exists = 0,
  'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE fk_stmt FROM @fk_sql;
EXECUTE fk_stmt;
DEALLOCATE PREPARE fk_stmt;
