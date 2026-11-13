// Die unsichtbare Fläche über dem Vorschaubild: meldet Zeiger und Tasten an
// das Hooks-Modul. Positionen in Zellen, mit Bruchteil wo das Terminal ihn kennt.
import type { ClientModule } from 'claude-code'

type Props = { cols: number; rows: number }
type State = { isWired: true }

const Pad: ClientModule<Props, State> = (props, surface) => {
  const { Box } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ isWired: true })

    let down: { x: number; y: number; row: number; isPick: boolean } | undefined
    let isDragged = false
    let drag = 0
    let quietUntil = 0

    surface.onPointer(ev => {
      const x = ev.fine?.x ?? ev.x + 0.5
      const y = ev.fine?.y ?? ev.y + 0.5

      if (ev.type === 'down') {
        if (ev.button === 'left' || ev.button === 'right') {
          // Der Rechtsklick wählt aus, der Linksklick bedient.
          down = { x, y, row: ev.y, isPick: ev.button === 'right' }
          isDragged = false
          drag += 1
        }
        return
      }

      if (ev.type === 'move') {
        if (down !== undefined) {
          const total = down.row - ev.y
          if (total !== 0 || isDragged) {
            isDragged = true
            // Die Summe seit dem Drücken, nicht der Schritt: ein Post kann
            // einen unzugestellten ersetzen.
            surface.post({ t: 'drag', id: drag, x: down.x, y: down.y, total })
          }
          return
        }
        if (Date.now() >= quietUntil) {
          surface.post({ t: 'hover', x, y })
        }
        return
      }

      if (ev.type === 'up') {
        if (down !== undefined && !isDragged) {
          // Kurz keine Hover-Posts, damit keiner den Klick im selben Frame ersetzt.
          quietUntil = Date.now() + 150
          surface.post({ t: 'click', x, y, pick: down.isPick })
        }
        down = undefined
        return
      }

      if (ev.type === 'leave' && down === undefined) {
        surface.post({ t: 'leave' })
      }
    })

    surface.onKey(ev => {
      surface.post({ t: 'key', key: ev.key, ctrl: ev.ctrl === true })
    })
  }

  return <Box width={props.cols} height={props.rows} />
}

export default Pad
