import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listProjectFiles, readProjectFile, sensitiveReason } from '../src/main/files/project-files'
import { composeForChatGpt } from '../src/main/transfer/orchestrator'

let root: string
let outside: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'integra-proj-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'integra-fora-'))
  fs.mkdirSync(path.join(root, 'specs/001'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules/x'), { recursive: true })
  fs.writeFileSync(path.join(root, 'specs/001/spec.md'), '# Spec v1')
  fs.writeFileSync(path.join(root, 'README.md'), '# Leia')
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(root, 'server.pem'), 'chave')
  fs.writeFileSync(path.join(root, 'foto.png'), Buffer.from([0, 1, 2]))
  fs.writeFileSync(path.join(root, 'node_modules/x/a.md'), 'dep')
  fs.writeFileSync(path.join(outside, 'segredo.md'), 'fora do projeto')
  fs.symlinkSync(path.join(outside, 'segredo.md'), path.join(root, 'link.md'))
  fs.writeFileSync(path.join(root, 'grande.md'), 'x'.repeat(600 * 1024))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('listProjectFiles', () => {
  it('lista textos, bloqueia sensíveis e ignora binários, dependências e links', () => {
    const { files } = listProjectFiles(root)
    const by = Object.fromEntries(files.map((f) => [f.relPath, f]))
    expect(by['specs/001/spec.md'].blocked).toBeNull()
    expect(by['README.md'].blocked).toBeNull()
    expect(by['.env'].blocked).toMatch(/env/)
    expect(by['server.pem'].blocked).toMatch(/Chave/)
    expect(by['grande.md'].blocked).toMatch(/Maior/)
    expect(by['foto.png']).toBeUndefined()
    expect(by['node_modules/x/a.md']).toBeUndefined()
    expect(by['link.md']).toBeUndefined()
    expect(files[0].relPath).toBe('specs/001/spec.md')
  })
})

describe('readProjectFile', () => {
  it('lê a versão atual do disco', () => {
    expect(readProjectFile(root, 'specs/001/spec.md').content).toBe('# Spec v1')
    fs.writeFileSync(path.join(root, 'specs/001/spec.md'), '# Spec v2')
    expect(readProjectFile(root, 'specs/001/spec.md').content).toBe('# Spec v2')
  })

  it('recusa sair do projeto, links, sensíveis e caminhos absolutos', () => {
    expect(() => readProjectFile(root, '../' + path.basename(outside) + '/segredo.md')).toThrow()
    expect(() => readProjectFile(root, 'link.md')).toThrow(/Fora/)
    expect(() => readProjectFile(root, '.env')).toThrow(/Bloqueado/)
    expect(() => readProjectFile(root, path.join(outside, 'segredo.md'))).toThrow(/inválido/)
    expect(() => readProjectFile(root, 'grande.md')).toThrow(/grande/)
  })
})

describe('sensitiveReason', () => {
  it('detecta padrões comuns', () => {
    expect(sensitiveReason('.env.local')).not.toBeNull()
    expect(sensitiveReason('config/credentials.json')).not.toBeNull()
    expect(sensitiveReason('docs/plano.md')).toBeNull()
  })
})

describe('composeForChatGpt', () => {
  const files = [{ relPath: 'specs/001/spec.md', content: '# Spec' }]
  it('modo anexo: lista os caminhos no texto e gera anexos', () => {
    const r = composeForChatGpt({ response: 'resp', project: 'p', files, mode: 'attach' })
    expect(r.text).toContain('resp')
    expect(r.text).toContain('specs/001/spec.md')
    expect(r.attachments[0].name).toBe('specs__001__spec.md')
    expect(r.attachments[0].content).toBe('# Spec')
  })
  it('modo texto: conteúdo delimitado e identificado', () => {
    const r = composeForChatGpt({ response: null, project: 'p', files, mode: 'inline' })
    expect(r.attachments).toHaveLength(0)
    expect(r.text).toContain('===== INÍCIO DO ARQUIVO: specs/001/spec.md =====\n# Spec\n===== FIM DO ARQUIVO: specs/001/spec.md =====')
  })
})
