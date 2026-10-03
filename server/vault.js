// Encrypted storage for all financial data.
//
// Design:
//   - A random 256-bit data key (DEK) encrypts the vault with AES-256-GCM.
//   - The DEK is itself encrypted ("wrapped") with a key derived from the user's
//     password via scrypt. Only the wrapped DEK is ever written to disk.
//   - The plaintext DEK lives only in memory while the user is logged in and is
//     wiped on logout / idle lock.
//   - Vault file layout: MAGIC(4) | IV(12) | TAG(16) | ciphertext(gzip(JSON)).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --demo keeps test data separate from your real vault.
export const DATA_DIR = process.env.VAULTBOOK_DATA_DIR || path.join(ROOT, process.argv.includes('--demo') ? 'data-demo' : 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc');
const MAGIC = Buffer.from('VBK1');
const AAD = Buffer.from('vaultbook-vault-v1');

const KDF = { N: 2 ** 17, r: 8, p: 1, keyLen: 32, maxmem: 256 * 1024 * 1024 };

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

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}

export function isSetUp() {
  return fs.existsSync(AUTH_FILE);
}

export function getUsername() {
  return isSetUp() ? JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')).username : null;
}

async function wrapDek(dek, username, password) {
  const salt = crypto.randomBytes(16);
  const kek = await deriveKey(password, salt);
  const w = encrypt(kek, dek, Buffer.from(`vaultbook-user:${username}`));
  kek.fill(0);
  return {
    version: 1,
    username,
    kdf: { alg: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64') },
    wrappedKey: { iv: w.iv.toString('base64'), tag: w.tag.toString('base64'), ct: w.ct.toString('base64') },
  };
}

/** Creates the account and an empty vault. Returns the in-memory DEK. */
export async function setup(username, password, initialData) {
  if (isSetUp()) throw new Error('Already set up');
  const dek = crypto.randomBytes(32);
  writeAtomic(AUTH_FILE, JSON.stringify(await wrapDek(dek, username, password), null, 2));
  saveVault(dek, initialData);
  return dek;
}

/** Returns the DEK if the credentials are valid, otherwise null. */
export async function unlock(username, password) {
  if (!isSetUp()) return null;
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const kek = await deriveKey(password, Buffer.from(auth.kdf.salt, 'base64'),
    { ...KDF, N: auth.kdf.N, r: auth.kdf.r, p: auth.kdf.p });
  try {
    // GCM authentication fails for the wrong password or a mismatched username.
    return decrypt(kek, {
      iv: Buffer.from(auth.wrappedKey.iv, 'base64'),
      tag: Buffer.from(auth.wrappedKey.tag, 'base64'),
      ct: Buffer.from(auth.wrappedKey.ct, 'base64'),
    }, Buffer.from(`vaultbook-user:${username}`));
  } catch {
    return null;
  } finally {
    kek.fill(0);
  }
}

export async function changePassword(dek, username, newPassword) {
  writeAtomic(AUTH_FILE, JSON.stringify(await wrapDek(dek, username, newPassword), null, 2));
}

export function loadVault(dek) {
  const buf = fs.readFileSync(VAULT_FILE);
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Unrecognized vault file');
  const plain = decrypt(dek, { iv: buf.subarray(4, 16), tag: buf.subarray(16, 32), ct: buf.subarray(32) }, AAD);
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
}

export function saveVault(dek, data) {
  const { iv, tag, ct } = encrypt(dek, zlib.gzipSync(JSON.stringify(data)), AAD);
  writeAtomic(VAULT_FILE, Buffer.concat([MAGIC, iv, tag, ct]));
}

export function vaultBytes() {
  return fs.readFileSync(VAULT_FILE);
}

// ----------------------------------------------------- statement files ---
// Copies of imported statements, encrypted with the same data key as the vault.
// Without the password the key can't be unwrapped, so a forgotten password
// means these files are unrecoverable too. Layout: MAGIC(4) | IV(12) | TAG(16) | ct.
const FILES_DIR = path.join(DATA_DIR, 'files');
const FILE_MAGIC = Buffer.from('VBF1');
const fileId = (id) => { if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Bad file id'); return path.join(FILES_DIR, `${id}.enc`); };

export function saveFile(dek, id, buffer) {
  const { iv, tag, ct } = encrypt(dek, buffer, Buffer.from(`vaultbook-file:${id}`));
  writeAtomic(fileId(id), Buffer.concat([FILE_MAGIC, iv, tag, ct]));
  const bak = `${fileId(id)}.bak`;
  if (fs.existsSync(bak)) fs.rmSync(bak);
}

export function readFile(dek, id) {
  const buf = fs.readFileSync(fileId(id));
  if (!buf.subarray(0, 4).equals(FILE_MAGIC)) throw new Error('Unrecognized file');
  return decrypt(dek, { iv: buf.subarray(4, 16), tag: buf.subarray(16, 32), ct: buf.subarray(32) }, Buffer.from(`vaultbook-file:${id}`));
}

export function deleteFile(id) {
  for (const p of [fileId(id), `${fileId(id)}.bak`]) if (fs.existsSync(p)) fs.rmSync(p);
}

export function fileBytes(id) {
  return fs.existsSync(fileId(id)) ? fs.readFileSync(fileId(id)) : null;
}
