// Descoberta de sessões do Claude Code.
// FRÁGIL: usa arquivos internos do Claude Code:
//   ~/.claude/sessions/<pid>.json  → sessões com processo vivo (sessionId, cwd, status, nome)
//   ~/.claude/projects/<proj>/<sessionId>.jsonl → histórico (transcript)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseJsonl, sessionTitle, type TranscriptEntry } from './transcript'

export const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

export interface LiveSessionRecord {
  pid: number
  sessionId: string
  cwd: string
  name?: string
  nameSource?: string
  status?: string
  entrypoint?: string
  kind?: string
  updatedAt?: number
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

export function readLiveSessions(dir = SESSIONS_DIR): LiveSessionRecord[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n))
  } catch {
    return []
  }
  const out: LiveSessionRecord[] = []
  for (const n of names) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as LiveSessionRecord
      if (rec.pid && rec.sessionId && alive(rec.pid)) out.push(rec)
    } catch {}
  }
  return out
}

export function readLiveSessionByPid(pid: number): LiveSessionRecord | null {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), 'utf8'))
    return alive(pid) ? rec : null
  } catch {
    return null
  }
}

/** Mapa pid → ppid de todos os processos (para achar o shell de cada `claude`). */
export function processTree(): Map<number, number> {
  const map = new Map<number, number>()
  try {
    const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
    for (const line of out.split('\n')) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number)
      if (pid) map.set(pid, ppid)
    }
  } catch {}
  return map
}

/** Ancestrais de um processo (pai, avô, ...). */
export function ancestors(pid: number, tree: Map<number, number>): number[] {
  const out: number[] = []
  let cur = tree.get(pid)
  while (cur && cur > 1 && out.length < 20) {
    out.push(cur)
    cur = tree.get(cur)
  }
  return out
}

const transcriptCache = new Map<string, string>()

export function findTranscript(sessionId: string): string | null {
  const cached = transcriptCache.get(sessionId)
  if (cached && fs.existsSync(cached)) return cached
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(PROJECTS_DIR)
  } catch {
    return null
  }
  for (const d of dirs) {
    const f = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`)
    if (fs.existsSync(f)) {
      transcriptCache.set(sessionId, f)
      return f
    }
  }
  return null
}

export function readTranscript(sessionId: string): TranscriptEntry[] {
  const f = findTranscript(sessionId)
  if (!f) return []
  return parseJsonl(fs.readFileSync(f, 'utf8'))
}

/** Lê só o começo e o fim do arquivo para achar título e cwd sem carregar tudo. */
export function quickInfo(file: string): { title: string | null; cwd: string | null } {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const head = Buffer.alloc(Math.min(size, 64 * 1024))
    fs.readSync(fd, head, 0, head.length, 0)
    const tailLen = Math.min(size, 256 * 1024)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    const entries = [...parseJsonl(head.toString('utf8')), ...parseJsonl(tail.toString('utf8'))]
    const cwdEntry = entries.find((e) => typeof (e as any).cwd === 'string')
    return { title: sessionTitle(entries), cwd: cwdEntry ? String((cwdEntry as any).cwd) : null }
  } finally {
    fs.closeSync(fd)
  }
}

export interface HistoryItem {
  sessionId: string
  file: string
  mtimeMs: number
}

export function listHistoryFiles(): HistoryItem[] {
  const out: HistoryItem[] = []
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(PROJECTS_DIR)
  } catch {
    return []
  }
  for (const d of dirs) {
    const full = path.join(PROJECTS_DIR, d)
    let files: string[] = []
    try {
      files = fs.readdirSync(full).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(full, f))
        out.push({ sessionId: f.slice(0, -6), file: path.join(full, f), mtimeMs: st.mtimeMs })
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}
