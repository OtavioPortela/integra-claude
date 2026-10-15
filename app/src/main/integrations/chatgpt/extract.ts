// Interpretação do JSON de conversa do ChatGPT (/backend-api/conversation/<id>).
// FRÁGIL: endpoint interno da interface web, não é API pública. Isolado aqui.

export interface ChatNode {
  id: string
  parent?: string | null
  message?: {
    id: string
    author: { role: string }
    content: { content_type: string; parts?: unknown[]; text?: string }
    status?: string
    end_turn?: boolean | null
    recipient?: string
    create_time?: number | null
    metadata?: Record<string, any>
  } | null
}

export interface ChatConversationJson {
  title?: string
  current_node: string
  mapping: Record<string, ChatNode>
  async_status?: unknown
}

function partsText(parts: unknown[] | undefined): string {
  if (!parts) return ''
  return parts
    .map((p) => {
      if (typeof p === 'string') return p
      // Respostas do modo de voz: partes com transcrição do áudio
      if (p && typeof p === 'object' && (p as any).content_type === 'audio_transcription') return String((p as any).text ?? '')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Remove marcas internas de citação do ChatGPT (ex.: \ue200filecite\ue202turn3file0\ue202L1-L1\ue201). */
export function stripCitations(s: string): string {
  return s.replace(/[ \t]?\ue200[^\ue201]*\ue201/g, '')
}

/** Caminho da raiz até o nó atual (o ramo que o usuário está vendo). */
export function currentBranch(c: ChatConversationJson): NonNullable<ChatNode['message']>[] {
  const out: NonNullable<ChatNode['message']>[] = []
  let id: string | null | undefined = c.current_node
  const seen = new Set<string>()
  while (id && c.mapping[id] && !seen.has(id)) {
    seen.add(id)
    const n: ChatNode = c.mapping[id]
    if (n.message) out.push(n.message)
    id = n.parent
  }
  return out.reverse()
}

function isVisibleUser(m: NonNullable<ChatNode['message']>): boolean {
  return m.author.role === 'user' && !m.metadata?.is_visually_hidden_from_conversation
}

function isAnswerText(m: NonNullable<ChatNode['message']>): boolean {
  return (
    m.author.role === 'assistant' &&
    (m.recipient ?? 'all') === 'all' &&
    (m.content.content_type === 'text' || m.content.content_type === 'multimodal_text') &&
    !m.metadata?.is_visually_hidden_from_conversation &&
    partsText(m.content.parts).trim().length > 0
  )
}

export interface ChatLastResponse {
  messageId: string
  text: string
  generating: boolean
  createdAt: string | null
}

/**
 * Última resposta completa: depois da última mensagem visível do usuário, a mensagem de texto do
 * assistente marcada como fim de turno (end_turn). Ignora raciocínio, ferramentas e textos
 * intermediários ("vou pesquisar...").
 */
export function lastAssistantResponse(c: ChatConversationJson): ChatLastResponse | null {
  const branch = currentBranch(c)
  let lastUser = -1
  branch.forEach((m, i) => {
    if (isVisibleUser(m)) lastUser = i
  })
  const turn = branch.slice(lastUser + 1)
  const unfinished = turn.some((m) => m.status && m.status !== 'finished_successfully')
  const answers = turn.filter(isAnswerText)
  const final = [...answers].reverse().find((m) => m.end_turn === true) ?? answers[answers.length - 1]
  const generating = unfinished || !turn.some((m) => m.author.role === 'assistant' && m.end_turn === true)
  if (!final) {
    if (lastUser >= 0 && generating) return { messageId: '', text: '', generating: true, createdAt: null }
    return null
  }
  return {
    messageId: final.id,
    text: stripCitations(partsText(final.content.parts)).trim(),
    generating,
    createdAt: final.create_time ? new Date(final.create_time * 1000).toISOString() : null
  }
}

export function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim()
}

/** Confirmação: existe mensagem do usuário com o texto enviado, criada depois de `sinceMs`. */
export function findUserMessage(c: ChatConversationJson, text: string, sinceMs: number): string | null {
  const want = normalize(text)
  for (const n of Object.values(c.mapping)) {
    const m = n.message
    if (!m || m.author.role !== 'user') continue
    const t = (m.create_time ?? 0) * 1000
    if (t < sinceMs - 5000) continue
    if (normalize(partsText(m.content.parts)) === want) return m.id
  }
  return null
}

/** Nomes dos anexos de uma mensagem do usuário. */
export function attachmentNames(c: ChatConversationJson, messageId: string): string[] {
  for (const n of Object.values(c.mapping)) {
    if (n.message?.id === messageId) return (n.message.metadata?.attachments ?? []).map((a: any) => String(a.name))
  }
  return []
}
