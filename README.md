# live-preview

Eine Mod für Claude Code: die Website deines Projekts als Panel direkt im Terminal.

- **Adressfeld oben im Panel:** Adresse, Port oder Datei eingeben (`localhost:5173`, `3000`, `https://…`, `index.html`) und Enter drücken.
- **Elemente auswählen:** Rechtsklick (oder Modus „Auswählen“) auf ein Element in der Vorschau. Mit deiner nächsten Nachricht bekommt Claude HTML, Stile und, wo die Seite sie verrät, die Fundstelle im Code.
- **Claude kann die Adresse selbst setzen:** „Zeig localhost:3000 in der Vorschau“. Lokale Adressen und Dateien im Projekt lädt es direkt, externe Seiten nur nach deiner Bestätigung.

## Installation

Am Prompt einer Claude-Code-Sitzung im Terminal:

```
/plugin install live-preview --marketplace OliveiraCodeing/live-preview
```

Die Frage „Add marketplace?“ mit `y` bestätigen, dann den Scope wählen (Enter für den Benutzer-Scope).

Aus der Shell:

```
claude plugin install live-preview --marketplace OliveiraCodeing/live-preview
```

In der Desktop-App (dort läuft `/plugin` nicht): auf + neben dem Eingabefeld klicken, dann Plugins, Add marketplace mit `OliveiraCodeing/live-preview`, dann Add plugin.

## Voraussetzungen

- Ein Terminal mit dem kitty-Grafikprotokoll, z. B. **kitty** oder **Ghostty**. Andere Terminals zeigen statt des Bildes nur einen Platzhaltertext.
- **Node.js 22** oder neuer.
- Google Chrome, Chromium, Microsoft Edge oder Brave (die Vorschau startet einen unsichtbaren Browser). Ein anderer Pfad lässt sich mit der Umgebungsvariable `CHROME_PATH` setzen.

## Benutzung

| Befehl | Wirkung |
| --- | --- |
| `/vorschau` | Panel mit leerem Adressfeld öffnen |
| `/vorschau 5173` | `http://localhost:5173/` laden |
| `/vorschau https://example.com` | Adresse laden |
| `/vorschau index.html` | Datei aus dem Projektordner laden |
| `/vorschau aus` | Vorschau schließen |

Im Panel: Linksklick bedient die Seite, Rechtsklick wählt ein Element aus, Mausrad scrollt, die px-Schaltfläche wechselt die Zoomstufe, ↻ lädt neu.
