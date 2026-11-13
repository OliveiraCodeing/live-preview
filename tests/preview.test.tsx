import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'live-preview',
  component: 'Pane',
  requestId: 'live-preview',
  surface: 'terminal',
  props: {
    title: 'Vorschau',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const INFO = {
  id: 1,
  label: '<button#buy.btn> „Jetzt kaufen“',
  text: 'Jetzt kaufen',
  selector: 'button#buy',
  parent: '<body>',
  html: '<button class="btn" id="buy">Jetzt kaufen</button>',
  attrs: {},
  inlineStyle: '',
  styles: { color: 'rgb(255, 255, 255)' },
  size: '126×42 px',
  source: { file: '/proj/src/Hero.tsx', line: 42, column: 5, components: ['Hero'] },
  url: 'http://localhost:3000/',
}

test('ein Rechtsklick im Bild wählt das Element aus und es geht mit der Nachricht mit', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const asked: string[] = []
  const filled: string[] = []
  let context: readonly string[] | undefined

  // Jeder Hook hier steht für die Engine.
  on('command.register', () => ({ value: { command: 'vorschau' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__live-preview__vorschau_url' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true, box: { text: e.text, cursor: e.text.length } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '/tmp/lp-test\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '{"t":"ready","url":"http://localhost:3000/"}\n' }
    yield { stream: 'stdout' as const, text: '{"t":"frame","file":"/tmp/lp-test/f1.png","n":1}\n' }
    await held

    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', (_, e) => {
    asked.push(new URL(e.url).pathname)
    const body = e.url.endsWith('/pick') ? { info: INFO } : { ok: true }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.submit', (_, e) => {
    context = e.context

    return { text: e.text }
  })

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'vorschau', args: '3000' } as never)
  expect(ran.text).toBe('Vorschau geöffnet: http://localhost:3000/')

  // Der Brücke Zeit für ihre zwei Zeilen geben.
  for (let i = 0; i < 20; i++) await Promise.resolve()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeDefined()

  // Ein normaler Klick bedient die Seite, der Rechtsklick wählt aus.
  await ui.pointer({ type: 'down', x: 10, y: 5, button: 'left' })
  await ui.pointer({ type: 'up', x: 10, y: 5, button: 'left' })
  expect(asked).toContain('/click')
  expect(asked).not.toContain('/pick')
  await ui.pointer({ type: 'down', x: 10, y: 5, button: 'right' })
  await ui.pointer({ type: 'up', x: 10, y: 5, button: 'right' })
  expect(asked).toContain('/pick')
  expect(filled[0]).toBe('[Element 1: <button#buy.btn> „Jetzt kaufen“] ')
  expect(await ui.find({ type: 'Text', text: /1 ausgewählt/ })).toBeDefined()

  await $.prompt.submit({ text: 'mach den blau' } as never)
  expect(context?.[0]).toContain('Fundstelle im Code: src/Hero.tsx:42')
  expect(context?.[0]).toContain('<button class="btn" id="buy">')
  expect(asked).toContain('/clear')

  await ui.unmount()
  // Die Vorschau beenden, bevor der Test endet: sonst schreibt die Brücke danach.
  await $.command.run({ command: 'vorschau', args: 'aus' } as never)
  release()
  for (let i = 0; i < 20; i++) await Promise.resolve()
})

type Seen = {
  opened: { id: string; focus?: true }[]
  closed: string[]
  spawned: string[]
  asked: string[]
  release: () => void
}

// Eine Engine ohne Brücke und Browser: die Brücke meldet sich mit ready und einem Bild.
// isHeld: die Brücke läuft weiter, bis release() sie beendet.
function engine(on: On, isHeld: boolean): Seen {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const seen: Seen = { opened: [], closed: [], spawned: [], asked: [], release: () => release() }

  on('command.register', () => ({ value: { command: 'vorschau' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__live-preview__vorschau_url' } }))
  on('ui.open', (_, e) => {
    seen.opened.push({ id: e.id, ...(e.focus ? { focus: e.focus } : {}) } as never)

    return { value: { isPlaced: true } }
  })
  on('ui.blit', () => ({ value: {} }))
  on('ui.close', (_, e) => {
    seen.closed.push(e.id)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '/tmp/lp-test\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('process.spawn', async function* (_: unknown, e: { argv: readonly string[] }) {
    const url = e.argv[3] ?? ''
    seen.spawned.push(url)
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ t: 'ready', url })}\n` }
    yield { stream: 'stdout' as const, text: '{"t":"frame","file":"/tmp/lp-test/f1.png","n":1}\n' }
    if (isHeld) await held

    return { value: { code: 0, signal: null } }
  } as never)
  on('http.fetch', (_, e) => {
    seen.asked.push(new URL(e.url).pathname)

    return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
  })

  return seen
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const START = { cwd: '/proj', surface: 'terminal', isInteractive: true } as const

test('/vorschau ohne Adresse öffnet nur das Panel mit dem Adressfeld', async ($, on) => {
  const seen = engine(on, false)
  await $.session.start(START)
  const ran = await $.command.run({ command: 'vorschau', args: '' } as never)
  expect(ran.text).toContain('Adresse')
  expect(seen.opened[0]?.focus).toBe(true)
  expect(seen.spawned).toEqual([])

  const ui = await $.ui.mount(PANE)
  const field = await ui.find({ key: 'url' })
  expect(field?.type).toBe('Input')
  expect(field?.props.value).toBe('')
  expect(field?.props.autoFocus).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Keine Vorschau aktiv/ })).toBeDefined()
  await ui.unmount()
})

test('Enter im Adressfeld lädt die Adresse; eine leere Eingabe startet nichts', async ($, on) => {
  const seen = engine(on, false)
  await $.session.start(START)
  await $.command.run({ command: 'vorschau', args: '' } as never)
  const ui = await $.ui.mount(PANE)

  await ui.input({ key: 'url', text: '   ' })
  await settle()
  expect(seen.spawned).toEqual([])

  await ui.input({ key: 'url', text: 'localhost:5173' })
  await settle()
  expect(seen.spawned).toEqual(['http://localhost:5173'])
  await ui.unmount()
  const again = await $.ui.mount(PANE)
  expect((await again.find({ key: 'url' }))?.props.value).toBe('http://localhost:5173')
  await again.unmount()
  await $.command.run({ command: 'vorschau', args: 'aus' } as never)
  await settle()
})

test('bei laufender Vorschau wechselt Enter per /nav, ohne neue Brücke', async ($, on) => {
  const seen = engine(on, true)
  await $.session.start(START)
  await $.command.run({ command: 'vorschau', args: '5173' } as never)
  await settle()
  const ui = await $.ui.mount(PANE)

  await ui.input({ key: 'url', text: '3000' })
  await settle()
  expect(seen.asked).toContain('/nav')
  expect(seen.spawned.length).toBe(1)
  await ui.unmount()
  const remounted = await $.ui.mount(PANE)
  expect((await remounted.find({ key: 'url' }))?.props.value).toBe('http://localhost:3000/')
  await remounted.unmount()

  await $.command.run({ command: 'vorschau', args: 'aus' } as never)
  seen.release()
  await settle()
})

test('das Werkzeug lädt lokale Adressen und verweigert Dateien außerhalb des Projekts', async ($, on) => {
  const seen = engine(on, false)
  await $.session.start(START)

  const loaded = await $.tool.call({
    tool: 'mcp__live-preview__vorschau_url',
    url: 'localhost:5173',
  } as never)
  await settle()
  expect(JSON.stringify(loaded)).toContain('http://localhost:5173')
  expect(seen.opened.length).toBe(1)
  expect(seen.opened[0]?.focus).toBeUndefined()
  expect(seen.spawned).toEqual(['http://localhost:5173'])

  const denied = await $.tool
    .call({ tool: 'mcp__live-preview__vorschau_url', url: '/etc/passwd' } as never)
    .then(
      value => JSON.stringify(value),
      error => String(error),
    )
  expect(denied).toContain('Projektordner')
  expect(seen.spawned.length).toBe(1)
  await $.command.run({ command: 'vorschau', args: 'aus' } as never)
  await settle()
})

test('/vorschau aus schließt das Panel', async ($, on) => {
  const seen = engine(on, false)
  await $.session.start(START)
  await $.command.run({ command: 'vorschau', args: '3000' } as never)
  await settle()

  const ran = await $.command.run({ command: 'vorschau', args: 'aus' } as never)
  expect(ran.text).toBe('Vorschau geschlossen.')
  expect(seen.closed).toEqual(['live-preview'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Keine Vorschau aktiv/ })).toBeDefined()
  await ui.unmount()
})
