/** Ein im Vorschau-Panel ausgewähltes Element, das mit der nächsten Nachricht mitgeht. */
export type Picked = {
  id: number
  /** Kurzform für die Liste im Panel, z. B. `<button.btn> „Kaufen"`. */
  label: string
  /** Fundstelle im Code, wenn die Seite sie verrät (`src/Hero.tsx:42`), sonst leer. */
  source: string
  /** Der ganze Textblock, den das Modell liest. */
  detail: string
}

export type View = {
  url: string
  title: string
  status: 'idle' | 'starting' | 'live' | 'error' | 'stopped'
  message: string
  /** `pick`: Klick wählt ein Element aus. `use`: Klick bedient die Seite. */
  mode: 'pick' | 'use'
  /** Seitenbreite als Vielfaches der Panelbreite: 1 = schmal, 2 = Desktop-Layout. */
  zoom: number
}

declare module 'claude-code' {
  interface PluginState {
    'live-preview': { view: Shaped<View>; picks: Shaped<Picked[]> }
  }
}
