import { describe, expect, it } from 'vitest'
import { findUserMessage, lastAssistantResponse, type ChatConversationJson } from '../src/main/integrations/chatgpt/extract'

// Estrutura real observada em 2026-10-14 (conteúdo resumido).
function conv(nodes: any[]): ChatConversationJson {
  const mapping: any = {}
  let parent: string | null = null
  for (const [i, m] of nodes.entries()) {
    const id = `n${i}`
    mapping[id] = { id, parent, message: m ? { id: `m${i}`, recipient: 'all', status: 'finished_successfully', ...m } : null }
    parent = id
  }
  return { current_node: parent!, mapping }
}
const user = (t: string, ts = 1000) => ({ author: { role: 'user' }, content: { content_type: 'text', parts: [t] }, create_time: ts })
const asst = (t: string, end: boolean | null, extra: any = {}) => ({ author: { role: 'assistant' }, content: { content_type: 'text', parts: [t] }, end_turn: end, ...extra })
const thoughts = { author: { role: 'assistant' }, content: { content_type: 'thoughts', parts: [] }, end_turn: false }
const recap = { author: { role: 'assistant' }, content: { content_type: 'reasoning_recap', parts: [] }, end_turn: false }

describe('lastAssistantResponse', () => {
  it('pega a resposta final (end_turn) e ignora preâmbulo, pensamento e recap', () => {
    const c = conv([null, user('oi'), thoughts, asst('Vou montar o prompt...', false), thoughts, asst('**Resposta final**\n```js\nx()\n```', true), recap])
    const r = lastAssistantResponse(c)!
    expect(r.text).toBe('**Resposta final**\n```js\nx()\n```')
    expect(r.generating).toBe(false)
    expect(r.messageId).toBe('m5')
  })

  it('marca como gerando quando a última mensagem está em andamento', () => {
    const c = conv([null, user('oi'), asst('parcial', null, { status: 'in_progress' })])
    expect(lastAssistantResponse(c)!.generating).toBe(true)
  })

  it('marca como gerando quando ainda não há fim de turno', () => {
    const c = conv([null, user('oi'), thoughts])
    const r = lastAssistantResponse(c)!
    expect(r.generating).toBe(true)
    expect(r.text).toBe('')
  })

  it('ignora mensagens de ferramenta (recipient diferente de all)', () => {
    const c = conv([null, user('oi'), asst('{"q":"x"}', false, { recipient: 'web.run' }), asst('resposta', true)])
    expect(lastAssistantResponse(c)!.text).toBe('resposta')
  })

  it('lê transcrição de voz (audio_transcription)', () => {
    const voice = { author: { role: 'assistant' }, content: { content_type: 'multimodal_text', parts: [{ content_type: 'audio_transcription', text: 'falado' }] }, end_turn: true }
    expect(lastAssistantResponse(conv([null, user('oi'), voice]))!.text).toBe('falado')
  })

  it('retorna null sem resposta do assistente', () => {
    expect(lastAssistantResponse(conv([null]))).toBeNull()
  })
})

describe('findUserMessage', () => {
  it('confirma só mensagem do usuário com o mesmo texto e depois do envio', () => {
    const c = conv([null, user('antigo', 100), user('texto\nenviado  ', 2000)])
    expect(findUserMessage(c, 'texto\nenviado', 2000 * 1000)).toBe('m2')
    expect(findUserMessage(c, 'antigo', 2000 * 1000)).toBeNull()
    expect(findUserMessage(c, 'outro', 0)).toBeNull()
  })
})
