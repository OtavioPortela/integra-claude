// Leitura do transcript JSONL do Claude Code (~/.claude/projects/<proj>/<sessionId>.jsonl).
// FRÁGIL: formato interno, não documentado. Toda a interpretação fica isolada aqui.

export interface TranscriptEntry {
  type?: string
  subtype?: string
  uuid?: string
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  toolUseResult?: unknown
  message?: { id?: string; role?: string; content?: unknown; stop_reason?: string | null }
  customTitle?: string
  aiTitle?: string
  title?: string
  [k: string]: unknown
}

export function parseJsonl(raw: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // linha parcial (arquivo sendo escrito): ignora
    }
  }
  return out
}

function textOfContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = content
    .filter((b) => b && typeof b === 'object' && (b as any).type === 'text')
    .map((b) => String((b as any).text ?? ''))
  return texts.length ? texts.join('\n') : null
}

/** Mensagem digitada pelo usuário (não resultado de ferramenta, não meta, não subagente). */
export function isHumanPrompt(e: TranscriptEntry): boolean {
  if (e.type !== 'user' || e.isSidechain || e.isMeta || e.isCompactSummary || e.toolUseResult) return false
  const c = e.message?.content
  if (Array.isArray(c) && c.some((b) => b && (b as any).type === 'tool_result')) return false
  return textOfContent(c) !== null
}

/**
 * O Claude Code registra colagens longas como
 * `<pasted_content id="x">\n...\n</pasted_content id="x">`. Remove esse invólucro para comparar.
 */
export function unwrapPasted(s: string): string {
  return s.replace(/<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content(?: id="\1")?>/g, '$2')
}

export function userText(e: TranscriptEntry): string {
  return unwrapPasted(textOfContent(e.message?.content) ?? '')
}

export interface ClaudeLastResponse {
  messageId: string
  text: string
  complete: boolean
  createdAt: string | null
}

/**
 * Última resposta completa: os blocos de texto do assistente depois da última mensagem humana,
 * sem "thinking" e sem uso de ferramentas. Se houver ferramentas no meio do turno, fica só o
 * texto que veio depois do último resultado de ferramenta (a resposta final).
 */
export function lastResponse(entries: TranscriptEntry[]): ClaudeLastResponse | null {
  const main = entries.filter((e) => !e.isSidechain)
  let lastHuman = -1
  for (let i = main.length - 1; i >= 0; i--) {
    if (isHumanPrompt(main[i])) {
      lastHuman = i
      break
    }
  }
  if (lastHuman < 0) return null
  const turn = main.slice(lastHuman + 1)

  let start = 0
  turn.forEach((e, i) => {
    // resultado de ferramenta: a resposta final vem depois dele
    const c = e.message?.content
    if (e.type === 'user' && (e.toolUseResult || (Array.isArray(c) && c.some((b) => b && (b as any).type === 'tool_result')))) start = i + 1
  })
  const finalPart = turn.slice(start)
  const blocks: string[] = []
  let messageId = ''
  let createdAt: string | null = null
  let stopReason: string | null | undefined
  for (const e of finalPart) {
    if (e.type !== 'assistant') continue
    const c = e.message?.content
    if (Array.isArray(c)) {
      for (const b of c) if (b && (b as any).type === 'text') blocks.push(String((b as any).text ?? ''))
    }
    messageId = e.message?.id || e.uuid || messageId
    createdAt = e.timestamp ?? createdAt
    stopReason = e.message?.stop_reason
  }
  const turnEnded = turn.some((e) => e.type === 'system' && e.subtype === 'turn_duration')
  const text = blocks.join('\n\n').trim()
  if (!text) return null
  return { messageId, text, complete: turnEnded || stopReason === 'end_turn', createdAt }
}

export function sessionTitle(entries: TranscriptEntry[]): string | null {
  let custom: string | null = null
  let ai: string | null = null
  for (const e of entries) {
    if (e.type === 'custom-title' && typeof e.customTitle === 'string') custom = e.customTitle
    if (e.type === 'ai-title' && typeof e.aiTitle === 'string') ai = e.aiTitle
    if (e.type === 'summary' && typeof (e as any).summary === 'string' && !ai) ai = (e as any).summary
  }
  if (custom) return custom
  if (ai) return ai
  const first = entries.find(isHumanPrompt)
  return first ? userText(first).replace(/\s+/g, ' ').slice(0, 80) : null
}

/** Normaliza para comparar o texto enviado com o que aparece no transcript. */
export function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\s+$/g, '').replace(/^\s+/g, '')
}

/** Procura uma mensagem humana com o texto enviado, registrada depois de `sinceMs`. */
export function findSentPrompt(entries: TranscriptEntry[], text: string, sinceMs: number): boolean {
  const want = normalize(text)
  return entries.some((e) => {
    if (!isHumanPrompt(e)) return false
    const t = e.timestamp ? Date.parse(e.timestamp) : 0
    return t >= sinceMs - 2000 && normalize(userText(e)) === want
  })
}
