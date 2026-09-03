/**
 * The pieces the own-child quota harvest is built from: per-platform listener
 * resolution for ONE given pid, a bounded loopback HTTP transport, and the
 * parser for the vendor's quota payload.
 *
 * It used to be more than that -- a machine-wide source that scanned every
 * process for something Antigravity-shaped, lifted a CSRF token out of each
 * command line, and probed whatever it found. That was removed on 2026-09-03:
 * it contradicted this package's own posture that it reads no credential or
 * token store, and both independent reviewers ranked removing it their second
 * simplification. What survives inspects only a pid this package spawned.
 *
 * Internal to this package.
 *
 * @module nishi-dsh-antigravity/usage-source
 */
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, readlink } from 'node:fs/promises';
import {
  type AntigravityNumericUsageObservation,
  type AntigravityNumericWindowObservation,
} from './usage.js';

const execFileAsync = promisify(execFile);
export interface AntigravityListener { readonly host: '127.0.0.1' | '::1'; readonly port: number; }
export interface ProcFsReader {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  getuid?(): number;
}
/**
 * Resolves the loopback ports of ONE process, given its pid.
 *
 * It used to also enumerate every Antigravity-looking process on the machine
 * and read a CSRF token out of each command line. That half is gone: the only
 * pid this package resolves is one it spawned itself, so nothing here reads
 * another process's arguments. See `quota-harvest-cache.ts`.
 */
export interface AntigravityPlatformDiscovery {
  discoverListeners(pid: number): Promise<AntigravityListener[]>;
}
export interface AntigravityRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface AntigravityHttpResponse { status: number; body: string; }
export type AntigravityRequestTransport = (url: string, options?: AntigravityRequestOptions) => Promise<AntigravityHttpResponse>;
export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1048576;
export const MAX_PORTS_PER_CANDIDATE = 5;
export const ANTIGRAVITY_METADATA_BODY = JSON.stringify({
  metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' },
});

export function parseWindowsListeners(rawNetTcp: string, targetPid: number, maxLimit = MAX_PORTS_PER_CANDIDATE): AntigravityListener[] {
  let list: any[];
  try { const parsed = JSON.parse(rawNetTcp); list = Array.isArray(parsed) ? parsed : [parsed]; } catch { return []; }
  const listeners: AntigravityListener[] = [];
  const seenPorts = new Set<number>();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Number(item.OwningProcess) !== targetPid) continue;
    const rawAddr = String(item.LocalAddress ?? '').trim();
    const port = Number(item.LocalPort);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
    let host: '127.0.0.1' | '::1' | null = null;
    if (rawAddr === '127.0.0.1') host = '127.0.0.1';
    else if (rawAddr === '::1' || rawAddr === '[::1]' || rawAddr === '0:0:0:0:0:0:0:1') host = '::1';
    if (!host || seenPorts.has(port)) continue;
    seenPorts.add(port); listeners.push({ host, port });
    if (listeners.length >= maxLimit) break;
  }
  return listeners;
}

export async function parseLinuxTcpListeners(procReader: ProcFsReader, pid: number, maxLimit = MAX_PORTS_PER_CANDIDATE): Promise<AntigravityListener[]> {
  const socketInodes = new Set<string>();
  try {
    const fds = await procReader.readdir(`/proc/${pid}/fd`);
    for (const fd of fds) {
      try {
        const m = (await procReader.readlink(`/proc/${pid}/fd/${fd}`)).match(/^socket:\[(\d+)\]$/);
        if (m) socketInodes.add(m[1]);
      } catch {}
    }
  } catch { return []; }
  if (socketInodes.size === 0) return [];
  const listeners: AntigravityListener[] = [];
  const seenPorts = new Set<number>();
  async function parseTcpFile(filePath: string, isV6: boolean): Promise<void> {
    let content = '';
    try { content = await procReader.readFile(filePath); } catch { return; }
    const lines = content.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length < 10 || parts[3] !== '0A' || !socketInodes.has(parts[9])) continue;
      const [hexIp, hexPort] = parts[1].split(':');
      const port = parseInt(hexPort, 16);
      if (!hexIp || !hexPort || !Number.isFinite(port) || port <= 0 || port > 65535) continue;
      let host: '127.0.0.1' | '::1' | null = null;
      if (!isV6 && hexIp === '0100007F') host = '127.0.0.1';
      if (isV6 && (hexIp === '00000000000000000000000001000000' || hexIp === '00000000000000000000000000000001')) host = '::1';
      if (!host || seenPorts.has(port)) continue;
      seenPorts.add(port); listeners.push({ host, port });
      if (listeners.length >= maxLimit) break;
    }
  }
  await parseTcpFile('/proc/net/tcp', false);
  if (listeners.length < maxLimit) await parseTcpFile('/proc/net/tcp6', true);
  return listeners;
}

export function parseMacOsListeners(rawLsofOutput: string, maxLimit = MAX_PORTS_PER_CANDIDATE): AntigravityListener[] {
  const listeners: AntigravityListener[] = [];
  const seenPorts = new Set<number>();
  for (const line of rawLsofOutput.split('\n')) {
    if (!line.includes('(LISTEN)')) continue;
    const match = line.match(/(?:127\.0\.0\.1|\[::1\]|localhost):(\d+)\s+\(LISTEN\)/);
    if (!match) continue;
    const port = Number(match[1]);
    if (!Number.isFinite(port) || port <= 0 || port > 65535 || seenPorts.has(port)) continue;
    seenPorts.add(port);
    listeners.push({ host: line.includes('127.0.0.1') ? '127.0.0.1' : '::1', port });
    if (listeners.length >= maxLimit) break;
  }
  return listeners;
}

export function parseResetTimestampMs(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  let ms: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed);
    ms = Number.isFinite(num) && num > 0 ? (num < 1e12 ? num * 1000 : num) : Date.parse(trimmed);
  } else return undefined;
  if (!Number.isFinite(ms) || ms <= 0 || ms < 946684800000 || ms > 4102444800000) return undefined;
  return ms;
}

export function classifyCadence(bucketId?: string, displayName?: string, windowStr?: string): 'SHORT' | 'WEEKLY' | 'OTHER' {
  const normalize = (s?: string) => (s ?? '').toLowerCase().trim().replace(/_/g, '-').replace(/\s+limit$/, '').trim();
  const idNorm = normalize(bucketId), nameNorm = normalize(displayName), winNorm = normalize(windowStr);
  const combined = `${idNorm} ${nameNorm} ${winNorm}`;
  if (idNorm.endsWith('-session') || idNorm.endsWith('-5h') || idNorm === 'session' || idNorm === '5h' || nameNorm.includes('session') || nameNorm.includes('5-hour') || nameNorm.includes('five hour') || nameNorm.includes('5 hour') || winNorm.includes('5 hour') || winNorm.includes('session') || /\b(session|5-?hour|five-?hour|5h)\b/.test(combined)) return 'SHORT';
  if (idNorm.endsWith('-weekly') || idNorm === 'weekly' || nameNorm.includes('weekly') || winNorm.includes('7 day') || winNorm.includes('week') || /\b(weekly|7-?day|week)\b/.test(combined)) return 'WEEKLY';
  return 'OTHER';
}

export function parseRetrieveUserQuotaSummary(payload: any): AntigravityNumericUsageObservation {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid RetrieveUserQuotaSummary payload structure');
  const groups = payload?.response?.groups ?? payload?.groups;
  if (!Array.isArray(groups)) throw new Error('Invalid RetrieveUserQuotaSummary payload structure: missing groups array');
  const windows: AntigravityNumericWindowObservation[] = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.buckets)) continue;
    const groupName = String(group.displayName ?? '').trim();
    for (const bucket of group.buckets) {
      if (!bucket || typeof bucket !== 'object') continue;
      const bucketId = String(bucket.bucketId ?? '').trim();
      const bucketName = String(bucket.displayName ?? '').trim();
      const rawFraction = bucket.remaining?.remainingFraction ?? bucket.remainingFraction;
      if (typeof rawFraction !== 'number' || !Number.isFinite(rawFraction) || rawFraction < 0 || rawFraction > 1) continue;
      const remainingPercent = Math.round(rawFraction * 100 * 100) / 100;
      const usedPercent = Math.max(0, Math.min(100, Math.round((100 - remainingPercent) * 100) / 100));
      windows.push({
        label: [groupName, bucketName].filter(Boolean).join(' ') || 'Antigravity Quota',
        scope: 'BUCKET',
        scopeId: bucketId || undefined,
        windowKind: classifyCadence(bucketId, bucketName, bucket.window),
        usedPercent,
        remainingPercent,
        resetsAtMs: parseResetTimestampMs(bucket.resetTime),
      });
    }
  }
  if (windows.length === 0) throw new Error('No valid quota windows found in RetrieveUserQuotaSummary');
  return { kind: 'NUMERIC_USAGE_AVAILABLE', windows };
}

export function createDefaultTransport(defaultTimeoutMs = DEFAULT_TIMEOUT_MS, defaultMaxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES): AntigravityRequestTransport {
  return (urlStr, options) => new Promise((resolve, reject) => {
    let settled = false;
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err); } };
    const safeResolve = (res: AntigravityHttpResponse) => { if (!settled) { settled = true; resolve(res); } };
    let parsedUrl: URL;
    try { parsedUrl = new URL(urlStr); } catch { safeReject(new Error('Invalid URL')); return; }
    const hostname = parsedUrl.hostname;
    if (hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== 'localhost' && hostname !== '[::1]') {
      safeReject(new Error('Non-loopback connection rejected')); return;
    }
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : isHttps ? 443 : 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options?.method ?? 'POST',
      headers: options?.headers ?? {},
      timeout: options?.timeoutMs ?? defaultTimeoutMs,
    };
    if (isHttps) reqOptions.rejectUnauthorized = false;
    const req = lib.request(reqOptions, (res) => {
      let body = '', bytesReceived = 0;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        bytesReceived += Buffer.byteLength(chunk, 'utf8');
        if (bytesReceived > (options?.maxResponseBytes ?? defaultMaxResponseBytes)) {
          req.destroy(); safeReject(new Error('Response exceeded max response size')); return;
        }
        body += chunk;
      });
      res.on('end', () => safeResolve({ status: res.statusCode ?? 500, body }));
      res.on('error', (err) => safeReject(new Error(`Local transport stream error: ${err.message}`)));
    });
    req.on('timeout', () => { req.destroy(); safeReject(new Error('Request timed out')); });
    req.on('error', (err) => safeReject(new Error(`Local transport error: ${err.message}`)));
    if (options?.body) req.write(options.body);
    req.end();
  });
}

function encodePowerShell(script: string): string { return Buffer.from(script, 'utf16le').toString('base64'); }
class WindowsPlatformDiscovery implements AntigravityPlatformDiscovery {
  constructor(private readonly exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>) {}
  async discoverListeners(pid: number): Promise<AntigravityListener[]> {
    try {
      const script = `Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalAddress, LocalPort | ConvertTo-Json -Compress`;
      const { stdout } = await this.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)]);
      return parseWindowsListeners(stdout, pid);
    } catch { return []; }
  }
}
class LinuxPlatformDiscovery implements AntigravityPlatformDiscovery {
  constructor(private readonly procReader: ProcFsReader) {}
  discoverListeners(pid: number): Promise<AntigravityListener[]> { return parseLinuxTcpListeners(this.procReader, pid); }
}
class MacOsPlatformDiscovery implements AntigravityPlatformDiscovery {
  constructor(private readonly exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>, private readonly getuid?: () => number) {}
  async discoverListeners(pid: number): Promise<AntigravityListener[]> {
    try { return parseMacOsListeners((await this.exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'])).stdout); }
    catch { return []; }
  }
}

export interface AntigravityHostPlatformDiscoveryConfig {
  procReader?: ProcFsReader;
  execCommand?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  timeoutMs?: number;
}

/**
 * Builds the platform-appropriate {@link AntigravityPlatformDiscovery} for
 * the current OS: `/proc` on Linux, `lsof` on macOS, `Get-NetTCPConnection`
 * on Windows, each asked only about the pid it is given.
 *
 * Its one caller is the own-child quota harvest in `quota-harvest-cache.ts`.
 * The machine-wide half that used to live beside this -- scanning every
 * process for something Antigravity-shaped and lifting a CSRF token out of
 * its command line -- was removed on 2026-09-03; see `docs/ROADMAP.md`
 * section 3.
 */
export function createHostPlatformDiscovery(config?: AntigravityHostPlatformDiscoveryConfig): AntigravityPlatformDiscovery {
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFn = config?.execCommand ?? (async (cmd, args) => execFileAsync(cmd, args, { timeout: timeoutMs }));
  if (process.platform === 'win32') return new WindowsPlatformDiscovery(execFn);
  if (process.platform === 'linux') {
    const procReader: ProcFsReader = config?.procReader ?? {
      readdir: (p) => readdir(p), readFile: (p) => readFile(p, 'utf8'), readlink: (p) => readlink(p),
      getuid: typeof process.getuid === 'function' ? () => process.getuid!() : undefined,
    };
    return new LinuxPlatformDiscovery(procReader);
  }
  if (process.platform === 'darwin') return new MacOsPlatformDiscovery(execFn, typeof process.getuid === 'function' ? () => process.getuid!() : undefined);
  return { discoverListeners: async () => [] };
}
