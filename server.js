import Fastify from 'fastify';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeProfiles } from './merge.js';

const DATA_DIR = process.env.DATA_DIR || './data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'skystream_sync.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    profile_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`);

const fastify = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function passwordsMatch(password, salt, passwordHash) {
  const expected = hashPassword(password, salt);
  const actual = Buffer.from(passwordHash, 'hex');
  const computed = Buffer.from(expected, 'hex');
  if (actual.length !== computed.length) return false;
  return crypto.timingSafeEqual(actual, computed);
}

function createUser(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (username, password_hash, salt, token, profile_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(username, hash, salt, token, '{}', now);
  return { token, username, created: true };
}

function readCredentials(body) {
  const username = String(body?.username ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (username.length < 2 || password.length < 6) return null;
  return { username, password };
}

function getUserFromHeader(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  return db.prepare('SELECT * FROM users WHERE token = ?').get(token);
}

fastify.get('/health', async () => ({ ok: true }));

fastify.post('/v1/auth/register', async (req, reply) => {
  const credentials = readCredentials(req.body);
  if (!credentials) {
    return reply.code(400).send({
      error: 'Username (2+ chars) and password (6+ chars) required.',
    });
  }
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(credentials.username);
  if (existing) {
    return reply.code(409).send({ error: 'Username already exists.' });
  }
  return createUser(credentials.username, credentials.password);
});

// Login creates the account on first use so a private server needs no
// separate signup step. A later login checks the password.
fastify.post('/v1/auth/login', async (req, reply) => {
  const credentials = readCredentials(req.body);
  if (!credentials) {
    return reply.code(400).send({
      error: 'Username (2+ chars) and password (6+ chars) required.',
    });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(credentials.username);

  if (!user) return createUser(credentials.username, credentials.password);

  if (!passwordsMatch(credentials.password, user.salt, user.password_hash)) {
    return reply.code(401).send({ error: 'Invalid username or password.' });
  }
  return { token: user.token, username: user.username, created: false };
});

fastify.get('/v1/profile', async (req, reply) => {
  const user = getUserFromHeader(req);
  if (!user) return reply.code(401).send({ error: 'Unauthorized' });
  try {
    return JSON.parse(user.profile_json || '{}');
  } catch (_) {
    return {};
  }
});

fastify.post('/v1/profile/sync', async (req, reply) => {
  const user = getUserFromHeader(req);
  if (!user) return reply.code(401).send({ error: 'Unauthorized' });

  const merged = mergeProfiles(user.profile_json, req.body || {});
  const mergedStr = JSON.stringify(merged);
  db.prepare(
    'UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?',
  ).run(mergedStr, merged.updatedAt, user.id);
  return merged;
});

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const port = Number(process.env.PORT || 8787);
  fastify.listen({ port, host: '0.0.0.0' });
}

export { mergeProfiles, fastify };
