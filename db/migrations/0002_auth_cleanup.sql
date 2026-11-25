-- Auth.js runs without a database adapter (JWT sessions); the API owns users/accounts.
-- Database-session tables from 0001 are unused.
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS verification_tokens;
-- OAuth rows created by the API don't carry provider tokens; keep columns nullable as defined.
