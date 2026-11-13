#!/usr/bin/env node
// Die Brücke der live-preview-Mod: startet einen unsichtbaren Chrome, zeigt
// ihm die Seite, schreibt Bilder davon als PNG in <dir> und nimmt Befehle
// (Klick, Auswahl, Scrollen ...) über einen Unix-Socket in <dir> entgegen.
//
//   node bridge.mjs <dir> <url> <breite> <höhe> <dsf>
//
// stdout: eine JSON-Zeile je Ereignis ({t:'frame'|'nav'|'ready'|'error'}).
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const [dir, startUrl = '', w0 = '640', h0 = '800', dsf0 = '2'] = process.argv.slice(2)
if (!dir) {
  process.stderr.write('usage: bridge.mjs <dir> <url> <w> <h> <dsf>\n')
  process.exit(2)
}

const emit = o => process.stdout.write(JSON.stringify(o) + '\n')
const size = { w: Number(w0) || 640, h: Number(h0) || 800, dsf: Number(dsf0) || 2 }
let chrome
let isClosing = false

function shutdown(code = 0) {
  if (isClosing) return
  isClosing = true
  try {
    chrome?.kill('SIGKILL')
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  process.exit(code)
}
function fail(message) {
  emit({ t: 'error', message })
  shutdown(1)
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => shutdown(0))
}
process.on('exit', () => {
  try {
    chrome?.kill('SIGKILL')
  } catch {}
})

// Nur Webseiten und Dateien: kein javascript:, data:, chrome: o. Ä.
const isAllowed = url => /^(https?|file):\/\//i.test(String(url))
if (!isAllowed(startUrl)) {
  fail(`Keine gültige Adresse: „${startUrl}“. Erlaubt sind http://, https:// und file://.`)
}

// Reste früherer Brücken aufräumen, die ohne Abschied endeten.
function sweep() {
  const parent = dirname(dir)
  let names = []
  try {
    names = readdirSync(parent)
  } catch {}
  for (const name of names) {
    const other = join(parent, name)
    if (!name.startsWith('lp-') || other === dir) continue
    try {
      const bridgePid = Number(readFileSync(join(other, 'bridge.pid'), 'utf8'))
      try {
        process.kill(bridgePid, 0)
        continue // lebt noch
      } catch {}
      try {
        process.kill(Number(readFileSync(join(other, 'chrome.pid'), 'utf8')), 'SIGKILL')
      } catch {}
      rmSync(other, { recursive: true, force: true })
    } catch {}
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  return candidates.find(path => path && existsSync(path))
}

// ---------------------------------------------------------------- CDP
let ws
let seq = 0
const waits = new Map()
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    waits.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

// Läuft in der Seite. Zeichnet den Rahmen unter dem Zeiger und die Rahmen der
// ausgewählten Elemente, und beschreibt ein Element für das Modell.
function install() {
  if (window.__lp) return window.__lp
  const Z = 2147483647
  const mk = css => {
    const d = document.createElement('div')
    d.setAttribute('data-lp', '')
    d.style.cssText =
      'position:fixed;pointer-events:none;box-sizing:border-box;margin:0;z-index:' +
      Z +
      ';' +
      css
    document.documentElement.appendChild(d)
    return d
  }
  const tagCss =
    'position:absolute;left:-2px;top:-18px;height:16px;line-height:16px;padding:0 5px;' +
    'font:600 11px/16px system-ui,sans-serif;color:#fff;white-space:nowrap;border-radius:3px 3px 0 0;'
  let hoverBox
  const picks = []
  let count = 0

  const place = (box, el) => {
    if (!el || !el.isConnected) {
      box.style.display = 'none'
      return
    }
    const r = el.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
    const tag = box.firstChild
    if (tag) tag.style.top = r.top < 18 ? '0px' : '-18px'
  }
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y)
    return el && el.nodeType === 1 ? el : null
  }
  const short = el => {
    const tag = el.tagName.toLowerCase()
    const cls = [...el.classList].slice(0, 2)
    return tag + (el.id ? '#' + el.id : '') + (cls.length ? '.' + cls.join('.') : '')
  }
  const textOf = el =>
    (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ')

  const sync = () => {
    for (const p of picks) place(p.box, p.el)
  }
  window.addEventListener('scroll', sync, true)
  window.addEventListener('resize', sync)
  setInterval(sync, 400)

  const selectorOf = el => {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id) {
        parts.unshift(node.tagName.toLowerCase() + '#' + node.id)
        break
      }
      let part = node.tagName.toLowerCase()
      const cls = [...node.classList].slice(0, 2)
      if (cls.length) part += '.' + cls.join('.')
      const parent = node.parentElement
      if (parent) {
        const same = [...parent.children].filter(c => c.tagName === node.tagName)
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(' > ')
  }

  // Wo das Element im Quellcode steht, soweit das Framework es im Dev-Modus verrät.
  const sourceOf = el => {
    const out = { file: '', line: 0, column: 0, components: [] }
    const take = (file, line, column) => {
      if (!out.file && file) {
        out.file = String(file)
        out.line = Number(line) || 0
        out.column = Number(column) || 0
      }
    }
    try {
      // React (Dev-Build)
      const key = Object.keys(el).find(
        k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
      )
      let fiber = key ? el[key] : null
      let guard = 0
      while (fiber && guard++ < 60) {
        const src = fiber._debugSource
        if (src) take(src.fileName, src.lineNumber, src.columnNumber)
        const t = fiber.type
        const name =
          typeof t === 'function'
            ? t.displayName || t.name
            : t && typeof t === 'object'
              ? t.displayName || (t.render && t.render.name) || (t.type && t.type.name)
              : ''
        if (name && out.components.length < 6 && !out.components.includes(name)) {
          out.components.push(name)
        }
        fiber = fiber.return
      }
    } catch {}
    try {
      // Vue 3
      let node = el
      let inst = null
      while (node && !inst) {
        inst = node.__vueParentComponent || null
        node = node.parentElement
      }
      let guard = 0
      while (inst && guard++ < 20) {
        const type = inst.type || {}
        take(type.__file, 0, 0)
        const name = type.name || type.__name
        if (name && out.components.length < 6 && !out.components.includes(name)) {
          out.components.push(name)
        }
        inst = inst.parent
      }
    } catch {}
    try {
      // Svelte (Dev)
      let node = el
      while (node && !out.file) {
        const meta = node.__svelte_meta
        if (meta && meta.loc) take(meta.loc.file, meta.loc.line, meta.loc.column)
        node = node.parentElement
      }
    } catch {}
    try {
      // Attribute, die Astro und Inspector-Plugins setzen
      const holder = el.closest(
        '[data-astro-source-file],[data-source-file],[data-inspector-relative-path],[data-source],[data-loc]',
      )
      if (holder) {
        const a = n => holder.getAttribute(n)
        const loc = (a('data-astro-source-loc') || '').split(':')
        take(a('data-astro-source-file'), loc[0], loc[1])
        take(a('data-source-file'), a('data-source-line'), 0)
        take(a('data-inspector-relative-path'), a('data-inspector-line'), a('data-inspector-column'))
        take(a('data-source') || a('data-loc'), 0, 0)
      }
    } catch {}
    return out
  }

  const describe = (el, id) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const clone = el.cloneNode(true)
    for (const n of clone.querySelectorAll('[data-lp]')) n.remove()
    let html = clone.outerHTML
    if (html.length > 1500) html = html.slice(0, 1500) + ' …'
    const attrs = {}
    for (const a of el.attributes) {
      if (a.name === 'class' || a.name === 'style' || a.name === 'id') continue
      if (Object.keys(attrs).length >= 12) break
      attrs[a.name] = a.value.slice(0, 120)
    }
    const text = textOf(el)
    const parent = el.parentElement
    return {
      id,
      tag: el.tagName.toLowerCase(),
      elementId: el.id || '',
      classes: [...el.classList],
      label:
        '<' + short(el) + '>' + (text ? ' „' + text.slice(0, 40) + (text.length > 40 ? '…' : '') + '“' : ''),
      text: text.slice(0, 200),
      selector: selectorOf(el),
      parent: parent ? '<' + short(parent) + '>' : '',
      html,
      attrs,
      inlineStyle: (el.getAttribute('style') || '').slice(0, 300),
      styles: {
        color: cs.color,
        'background-color': cs.backgroundColor,
        'font-size': cs.fontSize,
        'font-weight': cs.fontWeight,
        'font-family': cs.fontFamily.slice(0, 80),
        padding: cs.padding,
        margin: cs.margin,
        border: cs.border,
        'border-radius': cs.borderRadius,
        display: cs.display,
      },
      size: Math.round(r.width) + '×' + Math.round(r.height) + ' px',
      source: sourceOf(el),
      url: location.href,
    }
  }

  window.__lp = {
    hover(x, y) {
      const el = x < 0 ? null : at(x, y)
      if (!hoverBox) {
        hoverBox = mk('border:2px solid #3b82f6;background:rgba(59,130,246,.14);display:none;')
        const tag = document.createElement('div')
        tag.style.cssText = tagCss + 'background:#3b82f6;'
        hoverBox.appendChild(tag)
      }
      if (!el) {
        hoverBox.style.display = 'none'
        return ''
      }
      const r = el.getBoundingClientRect()
      hoverBox.firstChild.textContent =
        short(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height)
      place(hoverBox, el)
      return short(el)
    },
    pick(x, y) {
      const el = at(x, y)
      if (!el) return null
      const known = picks.find(p => p.el === el)
      if (known) return { ...describe(el, known.id), isKnown: true }
      const id = ++count
      const box = mk('border:2px solid #f59e0b;background:rgba(245,158,11,.14);')
      const tag = document.createElement('div')
      tag.style.cssText = tagCss + 'background:#f59e0b;'
      tag.textContent = String(id)
      box.appendChild(tag)
      picks.push({ id, el, box })
      sync()
      if (hoverBox) hoverBox.style.display = 'none'
      return describe(el, id)
    },
    unpick(id) {
      const i = picks.findIndex(p => p.id === id)
      if (i >= 0) {
        picks[i].box.remove()
        picks.splice(i, 1)
      }
      return picks.length
    },
    clear() {
      for (const p of picks) p.box.remove()
      picks.length = 0
      if (hoverBox) hoverBox.style.display = 'none'
      return 0
    },
    sync() {
      sync()
      return picks.length
    },
    title() {
      return document.title
    },
  }
  return window.__lp
}
const HELPER = String(install)
async function page(fn, ...args) {
  const out = await cdp('Runtime.evaluate', {
    expression: `(${HELPER})().${fn}(${args.map(a => JSON.stringify(a)).join(',')})`,
    returnByValue: true,
  })
  return out.result?.value
}

// ---------------------------------------------------------------- Bilder
let isBusy = false
let isWanted = false
let lastData = ''
let frames = 0
const files = []
async function capture() {
  if (isBusy) {
    isWanted = true
    return
  }
  isBusy = true
  try {
    do {
      isWanted = false
      // Mit Frist, damit ein hängendes Bild die Vorschau nicht einfriert.
      const { data } = await Promise.race([
        cdp('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ])
      if (data === lastData) continue
      lastData = data
      const file = join(dir, `f${++frames}.png`)
      writeFileSync(file + '.tmp', Buffer.from(data, 'base64'))
      renameSync(file + '.tmp', file)
      files.push(file)
      while (files.length > 8) {
        try {
          unlinkSync(files.shift())
        } catch {}
      }
      emit({ t: 'frame', file, n: frames, w: size.w, h: size.h })
    } while (isWanted)
  } catch {
  } finally {
    isBusy = false
  }
}

async function applySize() {
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: size.w,
    height: size.h,
    deviceScaleFactor: size.dsf,
    mobile: false,
  })
}

async function announce() {
  try {
    const { result } = await cdp('Runtime.evaluate', {
      expression: 'JSON.stringify([location.href, document.title])',
      returnByValue: true,
    })
    const [url, title] = JSON.parse(result.value)
    emit({ t: 'nav', url, title })
  } catch {}
}

async function navigate(url) {
  if (!isAllowed(url)) return { ok: false }
  const out = await cdp('Page.navigate', { url })
  if (out.errorText) {
    emit({ t: 'error', message: `Seite nicht erreichbar (${out.errorText}): ${url}`, isSoft: true })
  }
  return { ok: !out.errorText }
}

const KEYS = {
  return: ['Enter', 'Enter', 13, '\r'],
  tab: ['Tab', 'Tab', 9, ''],
  backspace: ['Backspace', 'Backspace', 8, ''],
  delete: ['Delete', 'Delete', 46, ''],
  up: ['ArrowUp', 'ArrowUp', 38, ''],
  down: ['ArrowDown', 'ArrowDown', 40, ''],
  left: ['ArrowLeft', 'ArrowLeft', 37, ''],
  right: ['ArrowRight', 'ArrowRight', 39, ''],
  pageup: ['PageUp', 'PageUp', 33, ''],
  pagedown: ['PageDown', 'PageDown', 34, ''],
  home: ['Home', 'Home', 36, ''],
  end: ['End', 'End', 35, ''],
}

async function route(path, a) {
  const x = Number(a.x) || 0
  const y = Number(a.y) || 0
  switch (path) {
    case '/resize': {
      const next = { w: Math.round(a.w), h: Math.round(a.h), dsf: Number(a.dsf) || 1 }
      if (!(next.w >= 50 && next.h >= 50)) return { ok: false }
      Object.assign(size, next)
      await applySize()
      await page('sync')
      void capture()
      return { ok: true }
    }
    case '/hover': {
      const label = await page('hover', a.x < 0 ? -1 : x, y)
      void capture()
      return { label }
    }
    case '/pick': {
      const info = await page('pick', x, y)
      void capture()
      return { info }
    }
    case '/unpick':
      await page('unpick', Number(a.id))
      void capture()
      return { ok: true }
    case '/clear':
      await page('clear')
      void capture()
      return { ok: true }
    case '/click': {
      const base = { x, y, button: 'left', clickCount: 1 }
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await cdp('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
      await cdp('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' })
      void capture()
      return { ok: true }
    }
    case '/scroll':
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: a.x === undefined ? size.w / 2 : x,
        y: a.y === undefined ? size.h / 2 : y,
        deltaX: 0,
        deltaY: Number(a.dy) || 0,
      })
      setTimeout(() => void page('sync').then(capture, capture), 60)
      return { ok: true }
    case '/key': {
      const known = KEYS[a.key]
      if (known) {
        const [key, code, vk, text] = known
        const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
        await cdp('Input.dispatchKeyEvent', {
          ...base,
          type: text ? 'keyDown' : 'rawKeyDown',
          ...(text ? { text } : {}),
        })
        await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
      } else if (typeof a.key === 'string' && a.key.length > 0) {
        await cdp('Input.insertText', { text: a.key })
      }
      void capture()
      return { ok: true }
    }
    case '/nav':
      return navigate(String(a.url))
    case '/reload':
      await cdp('Page.reload', {})
      return { ok: true }
    case '/capture':
      void capture()
      return { ok: true }
    default:
      return { ok: false }
  }
}

// ---------------------------------------------------------------- Start
let ready
const isReady = new Promise(resolve => {
  ready = resolve
})

mkdirSync(dir, { recursive: true })
sweep()
writeFileSync(join(dir, 'bridge.pid'), String(process.pid))

const server = createServer(async (req, res) => {
  let body = ''
  for await (const piece of req) body += piece
  let args = {}
  try {
    args = body ? JSON.parse(body) : {}
  } catch {}
  try {
    await isReady
    const out = await route(req.url, args)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(out ?? {}))
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(error?.message ?? error) }))
  }
})
server.listen(join(dir, 'b.sock'))

const bin = findChrome()
if (!bin) {
  fail('Kein Chrome gefunden. Installiere Google Chrome oder setze CHROME_PATH.')
}

chrome = spawn(
  bin,
  [
    '--headless=new',
    `--user-data-dir=${join(dir, 'profile')}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-extensions',
    `--window-size=${size.w},${size.h}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
writeFileSync(join(dir, 'chrome.pid'), String(chrome.pid))
chrome.on('exit', () => {
  if (!isClosing) fail('Der Vorschau-Browser wurde beendet.')
})

const port = await new Promise((resolve, reject) => {
  let seen = ''
  const timer = setTimeout(() => reject(new Error('timeout')), 20000)
  chrome.stderr.on('data', piece => {
    seen += piece
    const hit = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(seen)
    if (hit) {
      clearTimeout(timer)
      resolve(Number(hit[1]))
    }
  })
}).catch(() => fail('Der Vorschau-Browser ist nicht gestartet.'))

let target
for (let tries = 0; tries < 40 && !target; tries++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find(t => t.type === 'page')
  } catch {}
  if (!target) await new Promise(r => setTimeout(r, 100))
}
if (!target) fail('Der Vorschau-Browser hat keine Seite geöffnet.')

ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
}).catch(() => fail('Keine Verbindung zum Vorschau-Browser.'))
ws.addEventListener('close', () => {
  if (!isClosing) fail('Die Verbindung zum Vorschau-Browser ist abgerissen.')
})
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const wait = waits.get(message.id)
    waits.delete(message.id)
    if (!wait) return
    if (message.error) wait.reject(new Error(message.error.message))
    else wait.resolve(message.result)
    return
  }
  switch (message.method) {
    case 'Page.screencastFrame':
      void cdp('Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(() => {})
      void capture()
      break
    case 'Page.loadEventFired':
      void announce()
      void capture()
      break
    case 'Page.frameNavigated':
      if (!message.params.frame.parentId) void announce()
      break
    case 'Page.javascriptDialogOpening':
      void cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
      break
  }
})

await cdp('Page.enable')
await applySize()
// Der Screencast dient nur als Signal, dass sich etwas geändert hat; das
// scharfe Bild holt capture().
await cdp('Page.startScreencast', {
  format: 'jpeg',
  quality: 5,
  maxWidth: 96,
  maxHeight: 96,
  everyNthFrame: 1,
}).catch(() => {})
setInterval(() => void capture(), 1500)

const url = startUrl
ready()
emit({ t: 'ready', url })
await navigate(url)
void capture()
