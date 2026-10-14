// Arquivos do projeto: lista arquivos textuais do diretório da sessão e lê só o que foi marcado.
// Regras: nada fora da raiz (inclusive via link simbólico), nada sensível, nada binário/grande.
import fs from 'node:fs'
import path from 'node:path'
import type { FilePreview, ProjectFile, ProjectFileList } from '../../shared/types'

export const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES = 3000
const MAX_DEPTH = 8

const TEXT_EXT = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.csv',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.swift', '.sh', '.zsh', '.sql', '.html', '.css', '.scss', '.xml', '.graphql', '.prisma'
])
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.venv', 'venv',
  '__pycache__', '.turbo', '.cache', 'Pods', 'DerivedData', '.gradle', 'target'
])

const SENSITIVE: [RegExp, string][] = [
  [/(^|\/)\.env(\..*)?$/i, 'Arquivo .env (credenciais)'],
  [/\.(pem|key|p12|pfx|keystore|jks|der|crt)$/i, 'Chave ou certificado'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i, 'Chave SSH'],
  [/(^|\/)\.(npmrc|pypirc|netrc|git-credentials)$/i, 'Arquivo de credenciais'],
  [/(credential|secret|token|password|senha)/i, 'Nome sugere credencial'],
  [/(^|\/)\.claude\/(settings\.local\.json|.*\.key)$/i, 'Configuração local do Claude']
]

export function sensitiveReason(relPath: string): string | null {
  for (const [re, why] of SENSITIVE) if (re.test(relPath)) return why
  return null
}

/** Ordem: documentos do Spec Kit e Markdown primeiro. */
function rank(rel: string): number {
  if (rel.startsWith('.specify/memory/')) return 0
  if (rel.startsWith('specs/')) return 1
  if (/^(README|CLAUDE|AGENTS)\.md$/i.test(rel)) return 2
  if (rel.startsWith('docs/')) return 3
  if (/\.(md|mdx|markdown)$/i.test(rel)) return 4
  return 5
}

export function listProjectFiles(root: string): ProjectFileList {
  const realRoot = fs.realpathSync(root)
  const files: ProjectFile[] = []
  let truncated = false
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || truncated) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      const full = path.join(dir, e.name)
      const rel = path.relative(realRoot, full).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1)
        continue
      }
      if (e.isSymbolicLink() || !e.isFile()) continue
      const sens = sensitiveReason(rel)
      const ext = path.extname(e.name).toLowerCase()
      if (!sens && !TEXT_EXT.has(ext)) continue
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      const blocked = sens ?? (st.size > MAX_FILE_BYTES ? `Maior que ${MAX_FILE_BYTES / 1024} KB` : null)
      files.push({ relPath: rel, size: st.size, mtimeMs: st.mtimeMs, blocked })
    }
  }
  walk(realRoot, 0)
  files.sort((a, b) => rank(a.relPath) - rank(b.relPath) || a.relPath.localeCompare(b.relPath))
  return { root: realRoot, files, truncated }
}

/**
 * Lê UM arquivo marcado, na versão atual do disco. Revalida tudo no momento da leitura.
 */
export function readProjectFile(root: string, relPath: string): FilePreview {
  if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath)) throw new Error('Caminho inválido')
  const realRoot = fs.realpathSync(root)
  const full = path.resolve(realRoot, relPath)
  const real = fs.realpathSync(full)
  if (real !== full || !real.startsWith(realRoot + path.sep)) throw new Error(`Fora do projeto: ${relPath}`)
  const rel = path.relative(realRoot, real).split(path.sep).join('/')
  const sens = sensitiveReason(rel)
  if (sens) throw new Error(`Bloqueado (${sens}): ${rel}`)
  if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) throw new Error(`Tipo não suportado: ${rel}`)
  const st = fs.statSync(real)
  if (st.size > MAX_FILE_BYTES) throw new Error(`Arquivo grande demais: ${rel}`)
  const buf = fs.readFileSync(real)
  if (buf.includes(0)) throw new Error(`Arquivo binário: ${rel}`)
  return { relPath: rel, content: buf.toString('utf8'), size: st.size }
}

/** Texto delimitado (modo "colar como texto"): cada arquivo identificado pelo caminho. */
export function inlineFiles(files: FilePreview[]): string {
  return files
    .map((f) => `===== INÍCIO DO ARQUIVO: ${f.relPath} =====\n${f.content.replace(/\s+$/, '')}\n===== FIM DO ARQUIVO: ${f.relPath} =====`)
    .join('\n\n')
}

/** Nome do anexo: caminho relativo achatado, para o ChatGPT ver de onde veio. */
export function attachmentName(relPath: string): string {
  return relPath.replace(/\//g, '__')
}

export function mimeFor(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase()
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'text/markdown'
  if (ext === '.json') return 'application/json'
  if (ext === '.csv') return 'text/csv'
  return 'text/plain'
}
