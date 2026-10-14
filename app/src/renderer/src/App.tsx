import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatConversation,
  ClaudeSession,
  ClaudeSessionList,
  ConnectionStatus,
  Direction,
  FilePreview,
  LastResponse,
  ProjectFileList,
  TransferState
} from '../../shared/types'
import { api } from './api'

type Preview = { loading: boolean; data: LastResponse | null; error: string | null }
const emptyPreview: Preview = { loading: false, data: null, error: null }

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

export function App() {
  const [status, setStatus] = useState<(ConnectionStatus & { error: string | null }) | null>(null)
  const [convs, setConvs] = useState<ChatConversation[]>([])
  const [convHasMore, setConvHasMore] = useState(false)
  const [convLoading, setConvLoading] = useState(false)
  const [convError, setConvError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ClaudeSessionList | null>(null)
  const [historyLimit, setHistoryLimit] = useState(20)
  const [convId, setConvId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [chatPrev, setChatPrev] = useState<Preview>(emptyPreview)
  const [claudePrev, setClaudePrev] = useState<Preview>(emptyPreview)
  const [files, setFiles] = useState<ProjectFileList | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [filePrev, setFilePrev] = useState<FilePreview | null>(null)
  const [fileFilter, setFileFilter] = useState('')
  const [includeResponse, setIncludeResponse] = useState(true)
  const [fileMode, setFileMode] = useState<'attach' | 'inline'>('attach')
  const [tState, setTState] = useState<Record<Direction, TransferState | null>>({
    'chatgpt-to-claude': null,
    'claude-to-chatgpt': null
  })
  const [copied, setCopied] = useState(false)
  const restored = useRef(false)

  const session: ClaudeSession | null = useMemo(() => {
    if (!sessions || !sessionId) return null
    return [...sessions.active, ...sessions.history].find((s) => s.sessionId === sessionId) ?? null
  }, [sessions, sessionId])
  const conv = convs.find((c) => c.id === convId) ?? null

  // ---- carga inicial e eventos ----
  useEffect(() => {
    api.status().then(setStatus)
    api.getSelection().then(({ selection, fileMode }) => {
      setConvId(selection.conversationId)
      setSessionId(selection.sessionId)
      setFileMode(fileMode)
      restored.current = true
    })
    const off1 = api.on('status', setStatus)
    const off2 = api.on('transfer-state', (s: TransferState) => setTState((t) => ({ ...t, [s.direction]: s })))
    return () => {
      off1()
      off2()
    }
  }, [])

  useEffect(() => {
    if (restored.current) api.saveSelection({ conversationId: convId, sessionId }, fileMode)
  }, [convId, sessionId, fileMode])

  const loadSessions = useCallback(() => {
    api.listSessions(historyLimit).then(setSessions).catch(() => {})
  }, [historyLimit])

  useEffect(() => {
    loadSessions()
    const t = setInterval(loadSessions, 4000)
    return () => clearInterval(t)
  }, [loadSessions])

  const loadConvs = useCallback(async (offset: number) => {
    setConvLoading(true)
    setConvError(null)
    try {
      const page = await api.listConversations(offset)
      setConvs((prev) => {
        const base = offset === 0 ? [] : prev
        const seen = new Set(base.map((c) => c.id))
        return [...base, ...page.items.filter((c) => !seen.has(c.id))]
      })
      setConvHasMore(page.hasMore)
    } catch (e: any) {
      setConvError(e.message)
    } finally {
      setConvLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status?.chrome) loadConvs(0)
  }, [status?.chrome, loadConvs])

  // ---- prévias ----
  const loadChatPreview = useCallback(async () => {
    if (!convId) return setChatPrev(emptyPreview)
    setChatPrev((p) => ({ ...p, loading: true, error: null }))
    try {
      setChatPrev({ loading: false, data: await api.chatLastResponse(convId), error: null })
    } catch (e: any) {
      setChatPrev({ loading: false, data: null, error: e.message })
    }
  }, [convId])

  const loadClaudePreview = useCallback(async () => {
    if (!sessionId) return setClaudePrev(emptyPreview)
    setClaudePrev((p) => ({ ...p, loading: true, error: null }))
    try {
      setClaudePrev({ loading: false, data: await api.claudeLastResponse(sessionId), error: null })
    } catch (e: any) {
      setClaudePrev({ loading: false, data: null, error: e.message })
    }
  }, [sessionId])

  useEffect(() => {
    if (status?.chrome) loadChatPreview()
  }, [loadChatPreview, status?.chrome])
  useEffect(() => {
    loadClaudePreview()
  }, [loadClaudePreview])

  // Atualiza a prévia do Claude quando o estado da sessão muda (ocupada → ociosa).
  const sessionStateKey = session ? `${session.state}` : ''
  useEffect(() => {
    if (sessionStateKey) loadClaudePreview()
  }, [sessionStateKey, loadClaudePreview])

  // ---- arquivos ----
  useEffect(() => {
    setChecked([])
    setFilePrev(null)
    setFiles(null)
    setFilesError(null)
    if (!sessionId) return
    api.listFiles(sessionId).then(setFiles).catch((e) => setFilesError(e.message))
  }, [sessionId])

  const showFile = async (rel: string) => {
    if (!sessionId) return
    try {
      setFilePrev(await api.readFile(sessionId, rel))
    } catch (e: any) {
      setFilePrev({ relPath: rel, content: `Erro: ${e.message}`, size: 0 })
    }
  }

  const toggleFile = (rel: string) => {
    setChecked((c) => (c.includes(rel) ? c.filter((x) => x !== rel) : [...c, rel]))
    showFile(rel)
  }

  // Ao terminar um envio, atualiza as prévias.
  useEffect(() => {
    const s = tState['claude-to-chatgpt']
    if (s?.status === 'sent') loadChatPreview()
  }, [tState, loadChatPreview])
  useEffect(() => {
    const s = tState['chatgpt-to-claude']
    if (s?.status === 'sent') loadClaudePreview()
  }, [tState, loadClaudePreview])

  // ---- regras das setas ----
  const busy = (d: Direction) => {
    const s = tState[d]?.status
    return s === 'reading' || s === 'sending' || s === 'confirming'
  }

  const toClaudeBlock: string | null = !status?.chrome
    ? 'Navegador desconectado'
    : !convId
      ? 'Escolha uma conversa do ChatGPT'
      : !session
        ? 'Escolha uma sessão do Claude'
        : !session.canReceive
          ? session.receiveBlockedReason || 'Sessão só leitura'
          : session.state !== 'idle'
            ? 'Destino ocupado: o Claude está trabalhando'
            : chatPrev.loading
              ? 'Carregando prévia...'
              : chatPrev.error
                ? chatPrev.error
                : !chatPrev.data || !chatPrev.data.text
                  ? chatPrev.data?.generating
                    ? 'Origem ainda gerando'
                    : 'Sem resposta do ChatGPT'
                  : chatPrev.data.generating
                    ? 'Origem ainda gerando'
                    : null

  const toChatBlock: string | null = !status?.chrome
    ? 'Navegador desconectado'
    : !convId
      ? 'Escolha uma conversa do ChatGPT'
      : !session
        ? 'Escolha uma sessão do Claude'
        : includeResponse && claudePrev.loading
          ? 'Carregando prévia...'
          : includeResponse && !claudePrev.data
            ? 'Sem resposta do Claude'
            : includeResponse && claudePrev.data?.generating
              ? 'Origem ainda gerando'
              : !includeResponse && checked.length === 0
                ? 'Marque a resposta ou ao menos um arquivo'
                : null

  const doTransfer = (direction: Direction) => {
    if (!convId || !sessionId || busy(direction)) return
    const prev = direction === 'chatgpt-to-claude' ? chatPrev.data : claudePrev.data
    setTState((t) => ({ ...t, [direction]: { direction, status: 'reading', message: 'Iniciando...', at: Date.now() } }))
    api.transfer({
      direction,
      conversationId: convId,
      sessionId,
      previewMessageId: direction === 'chatgpt-to-claude' || includeResponse ? (prev?.messageId ?? null) : null,
      includeResponse: direction === 'chatgpt-to-claude' ? true : includeResponse,
      files: direction === 'claude-to-chatgpt' ? checked : [],
      fileMode
    })
  }

  const copyCode = async () => {
    await api.copyPairingCode()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const visibleFiles = (files?.files ?? []).filter((f) => !fileFilter || f.relPath.toLowerCase().includes(fileFilter.toLowerCase()))

  return (
    <div className="app">
      <header>
        <h1>Integra Claude</h1>
        <div className="conn">
          <span className={`pill ${status?.chrome ? 'ok' : 'bad'}`}>ChatGPT (Chrome): {status?.chrome ? 'conectado' : 'desconectado'}</span>
          <span className={`pill ${status?.vscode ? 'ok' : 'bad'}`}>VS Code: {status?.vscode ? `${status.vscode} janela(s)` : 'desconectado'}</span>
          <button className="ghost" onClick={copyCode}>{copied ? 'Código copiado ✓' : 'Copiar código de pareamento'}</button>
        </div>
      </header>
      {status?.error && <div className="banner bad">Servidor local: {status.error}</div>}

      <main>
        {/* ---------------- ChatGPT ---------------- */}
        <section className="col">
          <div className="col-head">
            <h2>ChatGPT</h2>
            <button className="ghost small" onClick={() => loadConvs(0)} disabled={!status?.chrome || convLoading}>Atualizar</button>
          </div>
          {!status?.chrome && <p className="hint">Abra o Chrome com a extensão Integra Claude e cole o código de pareamento (uma vez).</p>}
          {convError && <p className="err">{convError}</p>}
          <ul className="list">
            {convs.map((c) => (
              <li key={c.id} className={c.id === convId ? 'sel' : ''} onClick={() => setConvId(c.id)}>
                <div className="title">{c.title}</div>
                <div className="meta">{fmtDate(c.updatedAt)}</div>
              </li>
            ))}
          </ul>
          <div className="scope">
            {convs.length} conversa(s) carregada(s){convHasMore ? ' · há mais' : convs.length ? ' · fim da lista' : ''}
            <span className="muted"> (conversas dentro de Projetos do ChatGPT podem não aparecer)</span>
            {convHasMore && (
              <button className="ghost small" onClick={() => loadConvs(convs.length)} disabled={convLoading}>
                {convLoading ? 'Carregando...' : 'Carregar mais'}
              </button>
            )}
          </div>
        </section>

        {/* ---------------- Centro ---------------- */}
        <section className="center">
          <div className="route">
            <span className="end">{conv?.title ?? '—'}</span>
            <span className="muted">⇄</span>
            <span className="end">{session?.title ?? '—'}</span>
          </div>

          <Arrow
            label="ChatGPT → Claude"
            block={toClaudeBlock}
            state={tState['chatgpt-to-claude']}
            running={busy('chatgpt-to-claude')}
            onClick={() => doTransfer('chatgpt-to-claude')}
          />
          <PreviewBox title="Prévia: última resposta do ChatGPT" p={chatPrev} onRefresh={loadChatPreview} />

          <Arrow
            label="Claude → ChatGPT"
            block={toChatBlock}
            state={tState['claude-to-chatgpt']}
            running={busy('claude-to-chatgpt')}
            onClick={() => doTransfer('claude-to-chatgpt')}
            extra={
              <span className="muted small">
                {includeResponse ? 'resposta' : ''}
                {includeResponse && checked.length ? ' + ' : ''}
                {checked.length ? `${checked.length} arquivo(s) (${fileMode === 'attach' ? 'anexo' : 'texto'})` : ''}
              </span>
            }
          />
          <label className="check">
            <input type="checkbox" checked={includeResponse} onChange={(e) => setIncludeResponse(e.target.checked)} />
            Incluir a última resposta do Claude
          </label>
          <PreviewBox title="Prévia: última resposta do Claude" p={claudePrev} onRefresh={loadClaudePreview} />
        </section>

        {/* ---------------- Claude ---------------- */}
        <section className="col">
          <div className="col-head">
            <h2>Claude Code</h2>
            <button className="ghost small" onClick={loadSessions}>Atualizar</button>
          </div>
          {!status?.vscode && <p className="hint">Para enviar ao Claude, instale/abra a extensão Integra Claude no VS Code. Sem ela, as sessões ficam só leitura.</p>}
          <ul className="list">
            <li className="group">Ativas ({sessions?.active.length ?? 0})</li>
            {sessions?.active.map((s) => <SessionItem key={s.sessionId} s={s} sel={s.sessionId === sessionId} onSel={setSessionId} />)}
            <li className="group">Histórico (só leitura)</li>
            {sessions?.history.map((s) => <SessionItem key={s.sessionId} s={s} sel={s.sessionId === sessionId} onSel={setSessionId} />)}
          </ul>
          <div className="scope">
            {sessions?.history.length ?? 0} sessão(ões) do histórico{sessions?.historyHasMore ? ' · há mais' : ''}
            {sessions?.historyHasMore && (
              <button className="ghost small" onClick={() => setHistoryLimit((n) => n + 20)}>Carregar mais</button>
            )}
          </div>
        </section>
      </main>

      {/* ---------------- Arquivos ---------------- */}
      <section className="files">
        <div className="files-list">
          <div className="col-head">
            <h2>Arquivos do projeto {session ? <span className="muted small">{shortPath(files?.root ?? session.cwd)}</span> : null}</h2>
            <div className="mode">
              <label><input type="radio" checked={fileMode === 'attach'} onChange={() => setFileMode('attach')} /> Anexar</label>
              <label><input type="radio" checked={fileMode === 'inline'} onChange={() => setFileMode('inline')} /> Colar como texto</label>
            </div>
          </div>
          {!session && <p className="hint">Escolha uma sessão do Claude para ver os arquivos do projeto dela.</p>}
          {filesError && <p className="err">{filesError}</p>}
          {files && (
            <>
              <input className="filter" placeholder="Filtrar arquivos..." value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} />
              <ul className="flist">
                {visibleFiles.map((f) => (
                  <li key={f.relPath} className={f.blocked ? 'blocked' : ''} title={f.blocked ?? ''}>
                    <input type="checkbox" disabled={!!f.blocked} checked={checked.includes(f.relPath)} onChange={() => toggleFile(f.relPath)} />
                    <span className="fname" onClick={() => !f.blocked && showFile(f.relPath)}>{f.relPath}</span>
                    <span className="muted small">{f.blocked ? `🔒 ${f.blocked}` : `${(f.size / 1024).toFixed(1)} KB`}</span>
                  </li>
                ))}
              </ul>
              {files.truncated && <p className="muted small">Lista cortada em {files.files.length} arquivos (use o filtro).</p>}
            </>
          )}
        </div>
        <div className="files-prev">
          <div className="col-head">
            <h2>Prévia do arquivo</h2>
            {filePrev && <button className="ghost small" onClick={() => showFile(filePrev.relPath)}>Reler do disco</button>}
          </div>
          {filePrev ? (
            <>
              <div className="muted small">{filePrev.relPath}</div>
              <pre>{filePrev.content}</pre>
            </>
          ) : (
            <p className="hint">Marque um arquivo para ver o conteúdo. No envio, o app relê a versão salva em disco.</p>
          )}
        </div>
      </section>
    </div>
  )
}

function SessionItem({ s, sel, onSel }: { s: ClaudeSession; sel: boolean; onSel: (id: string) => void }) {
  const badge = !s.active ? 'histórico' : s.state === 'idle' ? 'ociosa' : 'trabalhando'
  return (
    <li className={`${sel ? 'sel' : ''} ${s.canReceive ? '' : 'ro'}`} onClick={() => onSel(s.sessionId)}>
      <div className="title">{s.title}</div>
      <div className="meta">
        <span className={`badge ${s.state}`}>{badge}</span>
        {s.active && !s.canReceive && <span className="badge ro">só leitura</span>}
        <span>{s.project}</span>
        <span>{fmtDate(s.updatedAt)}</span>
      </div>
      <div className="meta path">{shortPath(s.cwd)}</div>
    </li>
  )
}

function Arrow(props: {
  label: string
  block: string | null
  state: TransferState | null
  running: boolean
  onClick: () => void
  extra?: React.ReactNode
}) {
  const st = props.state
  return (
    <div className="arrow">
      <button className="primary" disabled={!!props.block || props.running} onClick={props.onClick}>
        {props.running ? '⏳ ' : ''}
        {props.label}
      </button>
      {props.extra}
      {props.block && !props.running && <div className="muted small">{props.block}</div>}
      {st && st.status !== 'idle' && (
        <div className={`tstate ${st.status}`}>
          {st.message} <span className="muted small">{new Date(st.at).toLocaleTimeString('pt-BR')}</span>
        </div>
      )}
    </div>
  )
}

function PreviewBox({ title, p, onRefresh }: { title: string; p: Preview; onRefresh: () => void }) {
  return (
    <div className="preview">
      <div className="col-head">
        <span className="small strong">{title}</span>
        <button className="ghost small" onClick={onRefresh}>Atualizar</button>
      </div>
      {p.loading && <p className="muted small">Carregando...</p>}
      {p.error && <p className="err">{p.error}</p>}
      {!p.loading && !p.error && !p.data && <p className="muted small">Nada para mostrar.</p>}
      {p.data && (
        <>
          {p.data.generating && <div className="tstate confirming">Ainda gerando... (envio bloqueado)</div>}
          <pre>{p.data.text}</pre>
          <div className="muted small">{p.data.text.length} caracteres · {fmtDate(p.data.createdAt)}</div>
        </>
      )}
    </div>
  )
}
