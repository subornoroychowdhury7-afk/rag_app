CREATE DATABASE IF NOT EXISTS auth_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE auth_system;

CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  password   VARCHAR(255) NOT NULL COMMENT 'bcrypt hash from password_hash()',
  role       ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  action       VARCHAR(32)  NOT NULL,
  identifier   CHAR(64)     NOT NULL COMMENT 'HMAC-SHA256 of IP or IP+email',
  attempts     INT UNSIGNED NOT NULL DEFAULT 1,
  window_start DATETIME     NOT NULL,
  locked_until DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rate_action_id (action, identifier),
  KEY idx_rate_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
