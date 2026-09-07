import { createHash, randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(res, body, status = 200, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export async function readBody(req, max = 16384) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Envía la solicitud como JSON.');
  }
  if (Number(req.headers['content-length']) > max) throw new HttpError(413, 'La solicitud es demasiado grande.');
  if (req.body !== undefined) {
    let value = req.body;
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (Buffer.byteLength(raw || '') > max) throw new HttpError(413, 'La solicitud es demasiado grande.');
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { throw new HttpError(400, 'El JSON no es válido.'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) throw new HttpError(400, 'Se esperaba un objeto.');
    return value;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > max) throw new HttpError(413, 'La solicitud es demasiado grande.');
    chunks.push(Buffer.from(chunk));
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'El JSON no es válido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Se esperaba un objeto.');
  return value;
}

export function textField(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new HttpError(400, `${name}: escribe entre 1 y ${max} caracteres.`);
  }
  return value.trim();
}

export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'El identificador no es válido.');
  }
  return value;
}

// Solo respaldo de desarrollo. En producción el contador compartido es obligatorio.
const windows = new Map();
export async function rateLimit(key, limit, env, now = Date.now()) {
  const bucket = Math.floor(now / 60000);
  const hash = createHash('sha256').update(key).digest('hex');
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n";
    let r;
    try {
      r = await fetch(env.UPSTASH_REDIS_REST_URL, {
        method: 'POST', headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(['EVAL', script, '1', `prime:rate:${bucket}:${hash}`]),
        signal: AbortSignal.timeout(4000),
      });
      const result = await r.json();
      if (!r.ok || !Number.isFinite(result.result)) throw new Error('counter unavailable');
      return result.result <= limit;
    } catch { throw new HttpError(503, 'La protección de acceso no está disponible. Reintenta en un momento.'); }
  }
  if (env.VERCEL || env.NODE_ENV === 'production') throw new HttpError(503, 'Falta completar la configuración segura del servicio.');
  for (const [k,v] of windows) if (v.bucket !== bucket) windows.delete(k);
  if (windows.size >= 10000 && !windows.has(hash)) return false;
  const entry = windows.get(hash) || { bucket, count: 0 };
  entry.count++; windows.set(hash, entry);
  return entry.count <= limit;
}

export function reportError(res, e) {
  const id = randomUUID();
  const status = e instanceof HttpError ? e.status : 502;
  // No registrar mensaje/cuerpo/URL de un proveedor: puede contener datos privados.
  if (status >= 500) console.error(JSON.stringify({ event: 'api_error', id, status, type: e?.name || 'Error' }));
  return json(res, { error: e instanceof HttpError ? e.message : 'No pudimos completar la consulta. Reintenta en un momento.', incidente: id }, status);
}
