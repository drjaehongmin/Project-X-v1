// Argon2id password hashing.  Parameters are the OWASP defaults for
// argon2id as of 2024.  Bcrypt-compatible verifiers would need a
// different code path; the user table stores the argon2 string as-is.

import argon2 from 'argon2';

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, HASH_OPTIONS);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
