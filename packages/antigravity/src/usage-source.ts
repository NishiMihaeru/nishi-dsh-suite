/**
 * Cross-platform Antigravity local live quota adapter (attach-only).
 * Discovers an already-running official Antigravity/agy/IDE language server on
 * loopback and performs read-only quota RPCs without spawning or mutating it.
 */
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, readlink } from 'node:fs/promises';
import {
  AntigravityUsageSourceError,
  type AntigravityUsageCapabilitySource,
  type AntigravityObservation,
  type AntigravityNumericUsageObservation,
  type AntigravityNumericWindowObservation,
} from './usage.js';

const execFileAsync = promisify(execFile);
export type AntigravitySourceKind = 'APP' | 'AGY' | 'IDE';
export interface AntigravityLocalEndpoint {
  readonly transport: 'https' | 'http';
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly csrfToken?: string;
  readonly sourceKind: AntigravitySourceKind;
}
export interface AntigravityCandidate {
  readonly pid: number;
  readonly sourceKind: AntigravitySourceKind;
  readonly commandLine: string;
  readonly csrfToken?: string;
  readonly ports?: readonly number[];
}
export interface AntigravityListener { readonly host: '127.0.0.1' | '::1'; readonly port: number; }
export interface ProcFsReader {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  getuid?(): number;
}
export interface AntigravityPlatformDiscovery {
  discoverCandidates(): Promise<AntigravityCandidate[]>;
  discoverListeners?(pid: number): Promise<AntigravityListener[]>;
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
export interface HostAntigravityLocalUsageSourceConfig {
  platformDiscovery?: AntigravityPlatformDiscovery;
  requestTransport?: AntigravityRequestTransport;
  procReader?: ProcFsReader;
  execCommand?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface AntigravityDiagnostics {
  sourceKind: AntigravitySourceKind | 'UNKNOWN';
  methodUsed: 'RetrieveUserQuotaSummary' | 'GetUserStatus' | 'GetCommandModelConfigs' | 'NONE';
  summaryCallCount: number;
  userStatusCallCount: number;
  commandConfigsCallCount: number;
  modelGenerationCalls: number;
}

export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1048576;
export const MAX_CANDIDATES = 5;
export const MAX_PORTS_PER_CANDIDATE = 5;
export const ANTIGRAVITY_METADATA_BODY = JSON.stringify({
  metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' },
});

export interface ClassifiedProcess {
  sourceKind: AntigravitySourceKind;
  csrfToken?: string;
  ports?: number[];
}

export function classifyAntigravityProcess(meta: { name?: string; path?: string; commandLine?: string }): ClassifiedProcess | null {
  const name = String(meta.name ?? '').trim();
  const path = String(meta.path ?? '').trim();
  const cmd = String(meta.commandLine ?? '').trim();
  const pathLower = path.toLowerCase();
  const cmdLower = cmd.toLowerCase();
  const csrfMatch = cmd.match(/--csrf_token\s+([^\s"']+)/) ?? cmd.match(/--extension_server_csrf_token\s+([^\s"']+)/);
  const csrfToken = csrfMatch ? csrfMatch[1] : undefined;
  const portMatch = cmd.match(/--extension_server_port\s+(\d+)/);
  const ports = portMatch ? [Number(portMatch[1])] : undefined;
  const lsPattern = /(?:^|[/\\])language(?:_|-)?server(?:[_-][a-z0-9]+)*(?:\.exe)?(?:\s|$)/i;
  const isLs = lsPattern.test(name) || lsPattern.test(path) || lsPattern.test(cmd);
  if (isLs) {
    const hasAppDataDirMarker = /(?:--app_data_dir\s+["']?[^"']*(?:antigravity|google[\\/.]antigravity))/i.test(cmd);
    const hasPathMarker =
      pathLower.includes('/antigravity.app/') || pathLower.includes('\\antigravity\\') ||
      pathLower.includes('/antigravity/') || pathLower.includes('/gemini.app/') ||
      pathLower.includes('\\gemini\\') || cmdLower.includes('/antigravity.app/') ||
      cmdLower.includes('\\antigravity\\') || cmdLower.includes('/gemini.app/');
    const hasIdeMarker = pathLower.includes('antigravity-ide') || cmdLower.includes('antigravity-ide') || cmdLower.includes('google.antigravity');
    if (!hasAppDataDirMarker && !hasPathMarker && !hasIdeMarker) return null;
    if (!csrfToken) return null;
    return { sourceKind: hasIdeMarker ? 'IDE' : 'APP', csrfToken, ports };
  }
  const agyPattern = /(?:^|[/\\])(?:agy|antigravity-cli|antigravity_cli)(?:\.exe)?(?:\s|$)/i;
  const firstToken = cmd.split(/\s+/)[0] ?? '';
  if (agyPattern.test(name) || agyPattern.test(path) || agyPattern.test(firstToken)) {
    return { sourceKind: 'AGY', csrfToken, ports };
  }
  return null;
}

export function parseWindowsProcessCandidates(rawCimOutput: string, maxLimit = MAX_CANDIDATES, currentSid?: string): AntigravityCandidate[] {
  let list: any[];
  try { const parsed = JSON.parse(rawCimOutput); list = Array.isArray(parsed) ? parsed : [parsed]; } catch { return []; }
  const candidates: AntigravityCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const pid = Number(item.ProcessId);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const ownerSid = typeof item.OwnerSid === 'string' ? item.OwnerSid.trim() : '';
    const expectedSid = typeof currentSid === 'string' && currentSid.trim().length > 0
      ? currentSid.trim()
      : typeof item.CurrentSid === 'string' && item.CurrentSid.trim().length > 0 ? item.CurrentSid.trim() : undefined;
    if (!ownerSid || !expectedSid || ownerSid !== expectedSid) continue;
    const classification = classifyAntigravityProcess({ name: item.Name, path: item.ExecutablePath, commandLine: item.CommandLine });
    if (!classification) continue;
    candidates.push({ pid, sourceKind: classification.sourceKind, commandLine: String(item.CommandLine ?? ''), csrfToken: classification.csrfToken, ports: classification.ports });
    if (candidates.length >= maxLimit) break;
  }
  return candidates;
}

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

export async function parseLinuxProcFsCandidates(procReader: ProcFsReader, maxLimit = MAX_CANDIDATES): Promise<AntigravityCandidate[]> {
  if (typeof procReader.getuid !== 'function') return [];
  let currentUid: number;
  try { currentUid = procReader.getuid(); } catch { return []; }
  if (!Number.isFinite(currentUid)) return [];
  let entries: string[];
  try { entries = await procReader.readdir('/proc'); } catch { return []; }
  const candidates: AntigravityCandidate[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let statusText = '';
    try { statusText = await procReader.readFile(`/proc/${pid}/status`); } catch { continue; }
    const uidMatch = statusText.match(/^Uid:\s+(\d+)/m);
    if (!uidMatch || Number(uidMatch[1]) !== currentUid) continue;
    let cmdlineRaw = '';
    try { cmdlineRaw = await procReader.readFile(`/proc/${pid}/cmdline`); } catch { continue; }
    const cmdline = cmdlineRaw.split('\x00').filter(Boolean).join(' ');
    let exePath = '';
    try { exePath = await procReader.readlink(`/proc/${pid}/exe`); } catch {}
    const classification = classifyAntigravityProcess({ path: exePath, commandLine: cmdline });
    if (!classification) continue;
    candidates.push({ pid, sourceKind: classification.sourceKind, commandLine: cmdline, csrfToken: classification.csrfToken, ports: classification.ports });
    if (candidates.length >= maxLimit) break;
  }
  return candidates;
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

export function parseMacOsProcessCandidates(rawPsOutput: string, maxLimit = MAX_CANDIDATES, currentUid?: number): AntigravityCandidate[] {
  if (typeof currentUid !== 'number' || !Number.isFinite(currentUid)) return [];
  const candidates: AntigravityCandidate[] = [];
  for (const line of rawPsOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || Number(match[1]) !== currentUid) continue;
    const classification = classifyAntigravityProcess({ commandLine: match[3] });
    if (!classification) continue;
    candidates.push({ pid: Number(match[2]), sourceKind: classification.sourceKind, commandLine: match[3], csrfToken: classification.csrfToken, ports: classification.ports });
    if (candidates.length >= maxLimit) break;
  }
  return candidates;
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

export function parseLegacyModelConfigs(rawConfigs: any[]): AntigravityNumericUsageObservation {
  if (!Array.isArray(rawConfigs) || rawConfigs.length === 0) throw new Error('Invalid legacy model configs structure');
  let minGeminiFraction: number | undefined, minGeminiResetTime: number | undefined;
  let minClaudeGptFraction: number | undefined, minClaudeGptResetTime: number | undefined;
  for (const cfg of rawConfigs) {
    if (!cfg || typeof cfg !== 'object') continue;
    const combined = `${String(cfg.label ?? '').toLowerCase()} ${String(cfg.modelOrAlias?.model ?? '').toLowerCase()}`;
    if (combined.includes('embedding') || combined.includes('image') || combined.includes('autocomplete') || combined.includes('lite')) continue;
    const quotaInfo = cfg.quotaInfo;
    if (!quotaInfo || typeof quotaInfo !== 'object') continue;
    const fraction = quotaInfo.remainingFraction;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
    const resetTime = parseResetTimestampMs(quotaInfo.resetTime);
    if (combined.includes('gemini')) {
      if (minGeminiFraction === undefined || fraction < minGeminiFraction) { minGeminiFraction = fraction; minGeminiResetTime = resetTime; }
    } else if (combined.includes('claude') || combined.includes('gpt') || combined.includes('sonnet') || combined.includes('opus')) {
      if (minClaudeGptFraction === undefined || fraction < minClaudeGptFraction) { minClaudeGptFraction = fraction; minClaudeGptResetTime = resetTime; }
    }
  }
  const windows: AntigravityNumericWindowObservation[] = [];
  if (minGeminiFraction !== undefined) {
    const rem = Math.round(minGeminiFraction * 100 * 100) / 100;
    windows.push({ label: 'Gemini Session Limit', scope: 'BUCKET', scopeId: 'legacy-gemini-session', windowKind: 'SHORT', usedPercent: Math.max(0, Math.min(100, Math.round((100 - rem) * 100) / 100)), remainingPercent: rem, resetsAtMs: minGeminiResetTime });
  }
  if (minClaudeGptFraction !== undefined) {
    const rem = Math.round(minClaudeGptFraction * 100 * 100) / 100;
    windows.push({ label: 'Claude / GPT Session Limit', scope: 'BUCKET', scopeId: 'legacy-claude-gpt-session', windowKind: 'SHORT', usedPercent: Math.max(0, Math.min(100, Math.round((100 - rem) * 100) / 100)), remainingPercent: rem, resetsAtMs: minClaudeGptResetTime });
  }
  if (windows.length === 0) throw new Error('No eligible text model quotas identified in legacy config');
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
  async discoverCandidates(): Promise<AntigravityCandidate[]> {
    try {
      const script = "$currSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'language[-_]server|agy|antigravity' -or $_.CommandLine -match 'language[-_]server|agy|antigravity' } | Select-Object -First 10; $res = @(); foreach ($p in $procs) { $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction SilentlyContinue; $sid = if ($owner -and $owner.Sid) { $owner.Sid } else { '' }; $res += [PSCustomObject]@{ ProcessId = $p.ProcessId; Name = $p.Name; ExecutablePath = $p.ExecutablePath; CommandLine = $p.CommandLine; OwnerSid = $sid; CurrentSid = $currSid }; }; ConvertTo-Json -Compress -InputObject $res";
      const { stdout } = await this.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)]);
      return parseWindowsProcessCandidates(stdout);
    } catch { return []; }
  }
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
  discoverCandidates(): Promise<AntigravityCandidate[]> { return parseLinuxProcFsCandidates(this.procReader); }
  discoverListeners(pid: number): Promise<AntigravityListener[]> { return parseLinuxTcpListeners(this.procReader, pid); }
}
class MacOsPlatformDiscovery implements AntigravityPlatformDiscovery {
  constructor(private readonly exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>, private readonly getuid?: () => number) {}
  async discoverCandidates(): Promise<AntigravityCandidate[]> {
    try {
      const currentUid = typeof this.getuid === 'function' ? this.getuid() : process.getuid?.();
      if (typeof currentUid !== 'number') return [];
      return parseMacOsProcessCandidates((await this.exec('/bin/ps', ['-axww', '-o', 'uid=,pid=,command='])).stdout, MAX_CANDIDATES, currentUid);
    } catch { return []; }
  }
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
 * the current OS. Extracted out of {@link HostAntigravityLocalUsageSource}'s
 * constructor so a second caller (the opportunistic own-child quota harvest
 * in `quota-harvest-cache.ts`) can reuse the exact same, already-tested
 * per-platform listener resolution -- `discoverListeners(pid)`, which reads
 * only the sockets owned by one given pid -- without depending on
 * `HostAntigravityLocalUsageSource` itself or duplicating its per-OS
 * plumbing. `discoverCandidates()` (the part of this object that scans every
 * process on the machine) is untouched either way; the harvest caller only
 * ever invokes `discoverListeners`.
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
  return { discoverCandidates: async () => [] };
}

export class HostAntigravityLocalUsageSource implements AntigravityUsageCapabilitySource {
  private readonly platformDiscovery: AntigravityPlatformDiscovery;
  private readonly requestTransport: AntigravityRequestTransport;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private diagnostics: AntigravityDiagnostics = {
    sourceKind: 'UNKNOWN', methodUsed: 'NONE', summaryCallCount: 0,
    userStatusCallCount: 0, commandConfigsCallCount: 0, modelGenerationCalls: 0,
  };

  constructor(config?: HostAntigravityLocalUsageSourceConfig) {
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = config?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.requestTransport = config?.requestTransport ?? createDefaultTransport(this.timeoutMs, this.maxResponseBytes);
    this.platformDiscovery = config?.platformDiscovery ?? createHostPlatformDiscovery({
      procReader: config?.procReader,
      execCommand: config?.execCommand,
      timeoutMs: this.timeoutMs,
    });
  }

  getDiagnostics(): AntigravityDiagnostics { return { ...this.diagnostics }; }

  async read(): Promise<AntigravityObservation> {
    this.diagnostics = { sourceKind: 'UNKNOWN', methodUsed: 'NONE', summaryCallCount: 0, userStatusCallCount: 0, commandConfigsCallCount: 0, modelGenerationCalls: 0 };
    let candidates: AntigravityCandidate[];
    try { candidates = await this.platformDiscovery.discoverCandidates(); }
    catch { throw new AntigravityUsageSourceError('Process discovery failed', 'UNAVAILABLE'); }
    if (!candidates?.length) throw new AntigravityUsageSourceError('No running Antigravity endpoint found', 'UNAVAILABLE');
    const priorityOrder: Record<AntigravitySourceKind, number> = { APP: 1, AGY: 2, IDE: 3 };
    candidates.sort((a, b) => priorityOrder[a.sourceKind] - priorityOrder[b.sourceKind]);
    for (const candidate of candidates) {
      for (const endpoint of await this.resolveCandidateEndpoints(candidate)) {
        const observation = await this.probeAndFetchQuota(endpoint);
        if (observation) { this.diagnostics.sourceKind = candidate.sourceKind; return observation; }
      }
    }
    throw new AntigravityUsageSourceError('No supported Antigravity quota endpoint responded', 'UNSUPPORTED');
  }

  private async resolveCandidateEndpoints(candidate: AntigravityCandidate): Promise<AntigravityLocalEndpoint[]> {
    const endpoints: AntigravityLocalEndpoint[] = [];
    const ports: { host: '127.0.0.1' | '::1'; port: number }[] = [];
    if (candidate.ports) for (const p of candidate.ports) ports.push({ host: '127.0.0.1', port: p });
    if (this.platformDiscovery.discoverListeners) {
      try {
        for (const l of await this.platformDiscovery.discoverListeners(candidate.pid)) {
          if (!ports.some((p) => p.port === l.port && p.host === l.host)) ports.push(l);
        }
      } catch {}
    }
    for (const { host, port } of ports) {
      if (candidate.sourceKind === 'AGY') {
        endpoints.push({ transport: 'http', host, port, csrfToken: candidate.csrfToken, sourceKind: 'AGY' });
        endpoints.push({ transport: 'https', host, port, csrfToken: candidate.csrfToken, sourceKind: 'AGY' });
      } else endpoints.push({ transport: 'https', host, port, csrfToken: candidate.csrfToken, sourceKind: candidate.sourceKind });
    }
    return endpoints;
  }

  private async probeAndFetchQuota(endpoint: AntigravityLocalEndpoint): Promise<AntigravityNumericUsageObservation | null> {
    const baseUrl = `${endpoint.transport}://${endpoint.host}:${endpoint.port}/exa.language_server_pb.LanguageServerService`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };
    if (endpoint.csrfToken) headers['x-codeium-csrf-token'] = endpoint.csrfToken;
    try {
      const probe = await this.requestTransport(`${baseUrl}/GetUnleashData`, { method: 'POST', headers, body: ANTIGRAVITY_METADATA_BODY, timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes });
      if (probe.status !== 200) return null;
    } catch { return null; }
    try {
      this.diagnostics.summaryCallCount++;
      const res = await this.requestTransport(`${baseUrl}/RetrieveUserQuotaSummary`, { method: 'POST', headers, body: ANTIGRAVITY_METADATA_BODY, timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes });
      if (res.status === 200) {
        const obs = parseRetrieveUserQuotaSummary(JSON.parse(res.body));
        this.diagnostics.methodUsed = 'RetrieveUserQuotaSummary';
        return obs;
      }
    } catch {}
    try {
      this.diagnostics.userStatusCallCount++;
      const res = await this.requestTransport(`${baseUrl}/GetUserStatus`, { method: 'POST', headers, body: ANTIGRAVITY_METADATA_BODY, timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes });
      if (res.status === 200) {
        const payload = JSON.parse(res.body);
        const configs = payload?.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? payload?.cascadeModelConfigData?.clientModelConfigs ?? payload?.clientModelConfigs;
        if (Array.isArray(configs)) {
          const obs = parseLegacyModelConfigs(configs);
          this.diagnostics.methodUsed = 'GetUserStatus';
          return obs;
        }
      }
    } catch {}
    try {
      this.diagnostics.commandConfigsCallCount++;
      const res = await this.requestTransport(`${baseUrl}/GetCommandModelConfigs`, { method: 'POST', headers, body: ANTIGRAVITY_METADATA_BODY, timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes });
      if (res.status === 200) {
        const payload = JSON.parse(res.body);
        const configs = payload?.clientModelConfigs ?? payload?.configs;
        if (Array.isArray(configs)) {
          const obs = parseLegacyModelConfigs(configs);
          this.diagnostics.methodUsed = 'GetCommandModelConfigs';
          return obs;
        }
      }
    } catch {}
    return null;
  }
}
