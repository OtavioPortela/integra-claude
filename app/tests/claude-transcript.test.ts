import { describe, expect, it } from 'vitest'
import { findSentPrompt, lastResponse, sessionTitle, type TranscriptEntry } from '../src/main/integrations/claude/transcript'

const human = (t: string, ts = '2026-10-14T10:00:00.000Z'): TranscriptEntry => ({ type: 'user', timestamp: ts, message: { role: 'user', content: t } })
const toolResult: TranscriptEntry = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] }, toolUseResult: {} }
const asst = (blocks: any[], stop: string | null = null, id = 'msg_1'): TranscriptEntry => ({ type: 'assistant', timestamp: '2026-10-14T10:00:05.000Z', message: { id, role: 'assistant', content: blocks, stop_reason: stop } })
const done: TranscriptEntry = { type: 'system', subtype: 'turn_duration' }

describe('lastResponse', () => {
  it('retorna só o texto final, depois do último resultado de ferramenta', () => {
    const e = [
      human('faça X'),
      asst([{ type: 'thinking', thinking: 'segredo' }], null, 'a'),
      asst([{ type: 'text', text: 'Vou ler o arquivo.' }], null, 'a'),
      asst([{ type: 'tool_use', name: 'Read' }], 'tool_use', 'a'),
      toolResult,
      asst([{ type: 'text', text: 'Pronto: **feito**.' }], 'end_turn', 'b'),
      done
    ]
    const r = lastResponse(e)!
    expect(r.text).toBe('Pronto: **feito**.')
    expect(r.complete).toBe(true)
    expect(r.messageId).toBe('b')
  })

  it('turno sem fim ainda é incompleto', () => {
    const r = lastResponse([human('oi'), asst([{ type: 'text', text: 'parcial' }], null)])!
    expect(r.complete).toBe(false)
  })

  it('ignora subagentes (sidechain) e mensagens meta', () => {
    const side = { ...asst([{ type: 'text', text: 'do subagente' }], 'end_turn', 'z'), isSidechain: true }
    const meta = { ...human('<command>'), isMeta: true }
    const r = lastResponse([human('oi'), asst([{ type: 'text', text: 'principal' }], 'end_turn'), side, meta, done])!
    expect(r.text).toBe('principal')
  })

  it('sem resposta retorna null', () => {
    expect(lastResponse([human('oi')])).toBeNull()
  })
})

describe('sessionTitle', () => {
  it('prefere título customizado, depois o gerado', () => {
    expect(sessionTitle([{ type: 'ai-title', aiTitle: 'IA' }, { type: 'custom-title', customTitle: 'Meu' }])).toBe('Meu')
    expect(sessionTitle([{ type: 'ai-title', aiTitle: 'IA' }])).toBe('IA')
    expect(sessionTitle([human('primeira mensagem')])).toBe('primeira mensagem')
  })
})

describe('findSentPrompt', () => {
  it('confirma o texto enviado só depois do instante do envio', () => {
    const since = Date.parse('2026-10-14T10:00:00.000Z')
    expect(findSentPrompt([human('olá\nmundo', '2026-10-14T10:00:01.000Z')], 'olá\nmundo', since)).toBe(true)
    expect(findSentPrompt([human('olá\nmundo', '2026-10-14T09:00:00.000Z')], 'olá\nmundo', since)).toBe(false)
    expect(findSentPrompt([human('outro', '2026-10-14T10:00:01.000Z')], 'olá', since)).toBe(false)
  })

  it('reconhece colagem longa embrulhada pelo Claude Code (formato real observado)', () => {
    const since = Date.parse('2026-10-14T10:00:00.000Z')
    const sent = '1. Maçã\n2. Banana\n60. Bacuri'
    const stored = `\n\n<pasted_content id="3bcf">\n${sent}\n</pasted_content id="3bcf">\n`
    expect(findSentPrompt([human(stored, '2026-10-14T10:00:01.000Z')], sent, since)).toBe(true)
  })
})
