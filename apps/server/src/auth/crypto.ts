import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Token aleatório seguro em base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Cofre para segredos guardados no banco (segredo do 2FA, chaves de terceiros — SPEC §17).
 * AES-256-GCM; formato: base64(iv[12] | tag[16] | texto cifrado).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('a chave do cofre precisa ter 32 bytes');
    this.key = key;
  }

  /**
   * Usa APP_SECRET (base64, 32 bytes) se definido; senão cria/lê um arquivo de chave ao lado do banco.
   * ATENÇÃO: sem essa chave os segredos guardados não podem ser lidos — ela entra no backup.
   */
  static load(appSecret: string | undefined, keyFile: string | null): SecretBox {
    if (appSecret) return new SecretBox(Buffer.from(appSecret, 'base64'));
    if (!keyFile) return new SecretBox(randomBytes(32)); // banco em memória (testes)
    if (existsSync(keyFile))
      return new SecretBox(Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64'));
    mkdirSync(dirname(keyFile), { recursive: true });
    const key = randomBytes(32);
    writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
    return new SecretBox(key);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  }

  open(sealed: string): string {
    const raw = Buffer.from(sealed, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }
}

// ------------------------------------------------------------------ TOTP (RFC 6238)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(
  key: Buffer,
  counter: number,
  digits = 6,
  algo: 'sha1' | 'sha256' = 'sha1',
): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, key).update(msg).digest();
  const off = (h[h.length - 1] as number) & 0xf;
  const bin =
    (((h[off] as number) & 0x7f) << 24) |
    ((h[off + 1] as number) << 16) |
    ((h[off + 2] as number) << 8) |
    (h[off + 3] as number);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totp(key: Buffer, timeMs: number, step = 30, digits = 6): string {
  return hotp(key, Math.floor(timeMs / 1000 / step), digits);
}

/** Aceita o código do passo atual e de ±1 passo (relógios fora de sincronia). */
export function verifyTotp(secretB32: string, code: string, timeMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secretB32);
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(totp(key, timeMs + drift * 30_000), code)) return true;
  }
  return false;
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Radar'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
