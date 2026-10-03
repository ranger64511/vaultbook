// Encrypted storage for all financial data.
//
// Design:
//   - Each user has their own random 256-bit data key (DEK) that encrypts their vault
//     and statement copies with AES-256-GCM.
//   - The DEK is encrypted ("wrapped") with a key derived from that user's password
//     via scrypt. Only the wrapped DEK is ever written to disk, so no one, including
//     an admin, can open another person's data without their password.
//   - A plaintext DEK lives only in memory while its user is logged in and is wiped
//     on logout / idle lock.
//   - Vault file layout: MAGIC(4) | IV(12) | TAG(16) | ciphertext(gzip(JSON)).
//
// Files under DATA_DIR:
//   users.json              registry: server options + each user's wrapped key
//   vaults/<userId>.enc     a user's encrypted vault
//   files/<userId>/<id>.enc a user's encrypted statement copies
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --demo keeps test data separate from your real vault.
export const DATA_DIR = process.env.VAULTBOOK_DATA_DIR || path.join(ROOT, process.argv.includes('--demo') ? 'data-demo' : 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'users.json');
const LEGACY_AUTH = path.join(DATA_DIR, 'auth.json');
const LEGACY_VAULT = path.join(DATA_DIR, 'vault.enc');
const MAGIC = Buffer.from('VBK1');
const AAD = Buffer.from('vaultbook-vault-v1');
const FILE_MAGIC = Buffer.from('VBF1');

const KDF = { N: 2 ** 17, r: 8, p: 1, keyLen: 32, maxmem: 256 * 1024 * 1024 };
const ID_RE = /^[\w-]{1,64}$/;
const safeId = (id) => { if (!ID_RE.test(id || '')) throw new Error('Bad id'); return id; };

function deriveKey(password, salt, params = KDF) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize('NFKC'), salt, params.keyLen,
      { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem },
      (err, key) => (err ? reject(err) : resolve(key))));
}

function encrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function decrypt(key, { iv, tag, ct }, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function writeAtomic(file, data, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  if (backup && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------ registry ---
const vaultPath = (userId) => path.join(DATA_DIR, 'vaults', `${safeId(userId)}.enc`);
const filesDir = (userId) => path.join(DATA_DIR, 'files', safeId(userId));

/** One-time upgrade from the single-user layout (auth.json + vault.enc). */
function migrateLegacy() {
  if (fs.existsSync(REGISTRY_FILE) || !fs.existsSync(LEGACY_AUTH)) return;
  const auth = JSON.parse(fs.readFileSync(LEGACY_AUTH, 'utf8'));
  const id = `u-${crypto.randomBytes(6).toString('hex')}`;
  fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true });
  if (fs.existsSync(LEGACY_VAULT)) fs.renameSync(LEGACY_VAULT, vaultPath(id));
  if (fs.existsSync(`${LEGACY_VAULT}.bak`)) fs.renameSync(`${LEGACY_VAULT}.bak`, `${vaultPath(id)}.bak`);
  const oldFiles = path.join(DATA_DIR, 'files');
  if (fs.existsSync(oldFiles)) {
    const loose = fs.readdirSync(oldFiles).filter((f) => f.endsWith('.enc'));
    fs.mkdirSync(filesDir(id), { recursive: true });
    for (const f of loose) fs.renameSync(path.join(oldFiles, f), path.join(filesDir(id), f));
  }
  const registry = {
    version: 2,
    multiUser: false,
    lanAccess: false,
    users: [{ id, username: auth.username, role: 'admin', createdAt: new Date().toISOString(), kdf: auth.kdf, wrappedKey: auth.wrappedKey }],
  };
  writeAtomic(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  fs.renameSync(LEGACY_AUTH, `${LEGACY_AUTH}.v1-migrated`);
}

export function loadRegistry() {
  migrateLegacy();
  if (!fs.existsSync(REGISTRY_FILE)) return { version: 2, multiUser: false, lanAccess: false, users: [] };
  return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
}

function saveRegistry(registry) {
  writeAtomic(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

export const isSetUp = () => loadRegistry().users.length > 0;

/** Public user info (no key material). */
export const listUsers = () => loadRegistry().users.map(({ id, username, role, createdAt }) => ({ id, username, role, createdAt }));

export function serverOptions() {
  const { multiUser, lanAccess } = loadRegistry();
  return { multiUser: !!multiUser, lanAccess: !!lanAccess };
}

export function setServerOptions(patch) {
  const reg = loadRegistry();
  if (patch.multiUser !== undefined) reg.multiUser = !!patch.multiUser;
  if (patch.lanAccess !== undefined) reg.lanAccess = !!patch.lanAccess;
  saveRegistry(reg);
  return { multiUser: reg.multiUser, lanAccess: reg.lanAccess };
}

async function wrapDek(dek, username, password) {
  const salt = crypto.randomBytes(16);
  const kek = await deriveKey(password, salt);
  const w = encrypt(kek, dek, Buffer.from(`vaultbook-user:${username}`));
  kek.fill(0);
  return {
    kdf: { alg: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64') },
    wrappedKey: { iv: w.iv.toString('base64'), tag: w.tag.toString('base64'), ct: w.ct.toString('base64') },
  };
}

/** Creates a user with an empty vault. Returns { user, dek }. */
export async function createUser(username, password, role, initialData) {
  const reg = loadRegistry();
  if (reg.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error('That username is taken');
  const dek = crypto.randomBytes(32);
  const user = { id: `u-${crypto.randomBytes(6).toString('hex')}`, username, role, createdAt: new Date().toISOString(), ...(await wrapDek(dek, username, password)) };
  saveVault(user.id, dek, initialData);
  reg.users.push(user);
  saveRegistry(reg);
  return { user: { id: user.id, username, role }, dek };
}

/** Returns { user, dek } if the credentials are valid, otherwise null. */
export async function unlock(username, password) {
  const user = loadRegistry().users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  // Still derive a key for unknown users so timing doesn't reveal which usernames exist.
  const kdf = user?.kdf || { salt: crypto.randomBytes(16).toString('base64'), N: KDF.N, r: KDF.r, p: KDF.p };
  const kek = await deriveKey(password, Buffer.from(kdf.salt, 'base64'), { ...KDF, N: kdf.N, r: kdf.r, p: kdf.p });
  try {
    if (!user) return null;
    // GCM authentication fails for the wrong password.
    const dek = decrypt(kek, {
      iv: Buffer.from(user.wrappedKey.iv, 'base64'),
      tag: Buffer.from(user.wrappedKey.tag, 'base64'),
      ct: Buffer.from(user.wrappedKey.ct, 'base64'),
    }, Buffer.from(`vaultbook-user:${user.username}`));
    return { user: { id: user.id, username: user.username, role: user.role }, dek };
  } catch {
    return null;
  } finally {
    kek.fill(0);
  }
}

export async function changePassword(userId, dek, newPassword) {
  const reg = loadRegistry();
  const user = reg.users.find((u) => u.id === userId);
  if (!user) throw new Error('No such user');
  Object.assign(user, await wrapDek(dek, user.username, newPassword));
  saveRegistry(reg);
}

/** Removes a user and permanently deletes their vault and statement copies. */
export function deleteUser(userId) {
  const reg = loadRegistry();
  reg.users = reg.users.filter((u) => u.id !== userId);
  saveRegistry(reg);
  for (const p of [vaultPath(userId), `${vaultPath(userId)}.bak`]) if (fs.existsSync(p)) fs.rmSync(p);
  if (fs.existsSync(filesDir(userId))) fs.rmSync(filesDir(userId), { recursive: true, force: true });
}

/** A user's registry entry (wrapped key, still encrypted) for their own backup. */
export function authRecord(userId) {
  const u = loadRegistry().users.find((x) => x.id === userId);
  return u ? { username: u.username, kdf: u.kdf, wrappedKey: u.wrappedKey } : null;
}

// --------------------------------------------------------------- vaults ---
export function loadVault(userId, dek) {
  const buf = fs.readFileSync(vaultPath(userId));
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Unrecognized vault file');
  const plain = decrypt(dek, { iv: buf.subarray(4, 16), tag: buf.subarray(16, 32), ct: buf.subarray(32) }, AAD);
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
}

export function saveVault(userId, dek, data) {
  const { iv, tag, ct } = encrypt(dek, zlib.gzipSync(JSON.stringify(data)), AAD);
  writeAtomic(vaultPath(userId), Buffer.concat([MAGIC, iv, tag, ct]));
}

export const vaultBytes = (userId) => fs.readFileSync(vaultPath(userId));

// ----------------------------------------------------- statement files ---
// Copies of imported statements, encrypted with the user's data key. Without the
// password the key can't be unwrapped, so a forgotten password means these files
// are unrecoverable too. Layout: MAGIC(4) | IV(12) | TAG(16) | ct.
const filePath = (userId, id) => path.join(filesDir(userId), `${safeId(id)}.enc`);

export function saveFile(userId, dek, id, buffer) {
  const { iv, tag, ct } = encrypt(dek, buffer, Buffer.from(`vaultbook-file:${id}`));
  writeAtomic(filePath(userId, id), Buffer.concat([FILE_MAGIC, iv, tag, ct]), { backup: false });
}

export function readFile(userId, dek, id) {
  const buf = fs.readFileSync(filePath(userId, id));
  if (!buf.subarray(0, 4).equals(FILE_MAGIC)) throw new Error('Unrecognized file');
  return decrypt(dek, { iv: buf.subarray(4, 16), tag: buf.subarray(16, 32), ct: buf.subarray(32) }, Buffer.from(`vaultbook-file:${id}`));
}

export function deleteFile(userId, id) {
  const p = filePath(userId, id);
  if (fs.existsSync(p)) fs.rmSync(p);
}

export function fileBytes(userId, id) {
  const p = filePath(userId, id);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
