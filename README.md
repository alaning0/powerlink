# Powerlink

Obsidian plugin that turns a URL into a markdown note using OpenAI.

Paste a link, or pull a recent URL from your [Ideas API](https://alaning-me-api.alaning0.workers.dev/api/ideas). Powerlink generates a summary (configurable prompt), then inserts it into the current note or creates a new note in a folder you choose.

## Features

- **Ribbon / command** — open the Powerlink flow
- **URL picker** — paste a URL or load recent Ideas API links
- **Destinations**
  - Insert into the current note at the cursor
  - Create a new note in a configured folder (OpenAI suggests the filename)
- **After new note** — open it, insert a `[[wikilink]]` into the current note, or dismiss
- **Delete from Ideas** — optional: remove a processed Ideas API link after success
- **Advanced (desktop only)** — for YouTube / Instagram:
  - Runs `yt-dlp` with a cookies file (or browser cookies)
  - Prefers captions; falls back to OpenAI Whisper on extracted audio
  - Feeds the transcript into the same note-generation prompt
- **Bulk import (desktop only)** — process multiple URLs from Ideas API at once:
  - Multi-select checklist with all ideas from the API
  - Sequential processing (one at a time)
  - Automatically uses Advanced mode for YouTube/Instagram URLs
  - Progress display with cancel option
  - Summary of created/failed/deleted notes at the end

Normal mode works on mobile. Advanced and Bulk import modes register only on desktop (`Platform.isDesktopApp`).

## Install (manual)

1. Build or download `main.js`, `manifest.json`, and `styles.css`
2. Copy them into `VaultFolder/.obsidian/plugins/powerlink/`
3. Enable **Powerlink** under Settings → Community plugins

## Develop

Requirements: Node.js 18+, npm.

```bash
npm install
npm run dev    # watch build → main.js
```

Reload Obsidian (or use a hot-reload plugin) after changes. Production build:

```bash
npm run build
```

## Settings

| Setting | Purpose |
|---------|---------|
| Ideas API URL | Endpoint returning `{ ideas: [...] }` |
| OpenAI API key | Chat (+ Whisper in Advanced) |
| OpenAI model | Chat model id |
| Prompt | Instructions for the note body |
| Notes folder | Vault folder for new notes |
| Delete from Ideas after success | DELETE the idea id after a successful process |
| **Advanced** | |
| yt-dlp path | Absolute path recommended (e.g. `/opt/homebrew/bin/yt-dlp`) |
| ffmpeg location | e.g. `/opt/homebrew/bin/ffmpeg` (Obsidian often lacks Homebrew on `PATH`) |
| Cookies file | Netscape cookies.txt for `--cookies` (preferred) |
| Cookies from browser | Fallback `--cookies-from-browser` (often blocked inside Obsidian) |
| Whisper model | e.g. `whisper-1` |

Plugin settings (including API keys) live in `data.json` and are **not** committed.

### Exporting cookies (Advanced)

From Terminal (outside Obsidian):

```bash
yt-dlp --cookies-from-browser safari --cookies /path/to/yt-cookies.txt --skip-download "https://www.instagram.com/"
```

Point **Cookies file** at that path. Re-export when logins expire.

## License

0BSD — see [LICENSE](LICENSE).
