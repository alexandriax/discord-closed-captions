# Discord Closed Captions Extension

Chrome extension for adding closed captions to Discord calls via OpenAI's GPT-Live-Transcribe.

![Discord Closed Captions Extension settings](docs/screenshot.jpg)

The extension captures the audio already playing in a Discord Web tab, sends
it directly to OpenAI for live transcription, and draws streaming captions over
the call. It is fully self-contained: there is no local relay, hosted backend,
Discord bot, or Discord account token.

> [!IMPORTANT]
> Bring your own OpenAI API key. API usage is billed to that OpenAI account and
> is separate from a ChatGPT subscription. Tell everyone in the call that live
> transcription is enabled and get their consent before starting.

## Features

- One-click start and stop from the Chrome toolbar
- Live partial captions and finalized caption segments
- A readable caption overlay inside Discord, including fullscreen calls
- Continued Discord audio playback while tab capture is active
- Direct Realtime API connection using `gpt-live-transcribe`
- No stored audio, transcripts, Discord credentials, or call history
- Session-only API key storage by default
- Optional passphrase-encrypted local API key vault
- Language, vocabulary, and call-context hints

## How it works

```mermaid
flowchart LR
    A["Discord Web tab audio"] --> B["Chrome tab capture"]
    B --> C["24 kHz mono PCM"]
    K["User-owned OpenAI API key"] --> T["Short-lived Realtime token"]
    T --> D["OpenAI Realtime API<br/>gpt-live-transcribe"]
    C --> D
    D --> E["Streaming transcript events"]
    E --> F["Caption overlay in Discord"]
```

The standard API key is used from a trusted extension context to call OpenAI's
Realtime client-secret endpoint. The resulting short-lived credential
authenticates the browser WebSocket. The standard key is never sent to Discord,
the Discord content script, a project server, or a URL.

Only the tab's rendered output is captured. In a typical call, that includes
the remote participant and Discord notification sounds. The local microphone
is normally not played into the tab, so it is not normally transcribed by this
extension.

## Requirements

- Chrome 116 or newer
- Discord Web at [discord.com/app](https://discord.com/app)
- An [OpenAI API key](https://platform.openai.com/api-keys) with API billing and
  access to `gpt-live-transcribe`

The native Discord desktop application is not supported because Chrome cannot
capture another application's audio with the tab-capture API.

## Install from source

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository's `extension/` directory.
5. Pin **Discord Closed Captions Extension** to the toolbar.

The options page opens after the first installation.

## Configure the OpenAI API key

Enter an API key in the extension options and choose one of the storage modes:

### Until Chrome closes — recommended

The plaintext key is kept in `chrome.storage.session`, which is memory-backed,
restricted to trusted extension contexts, and cleared when Chrome restarts or
the extension reloads. Nothing secret is persisted to disk by the extension.

### Encrypted vault

The extension encrypts the API key with AES-256-GCM using a key derived from a
separate passphrase with PBKDF2-SHA-256. Only the ciphertext, salt, IV, and
format metadata are persisted in `chrome.storage.local`. The plaintext key is
placed in trusted session storage only after the vault is unlocked.

Use a strong, unique passphrase. It cannot be recovered if forgotten.

Neither mode uses `chrome.storage.sync`, and the options page never restores a
saved API key into an HTML input.

### Security boundary

These controls protect against Discord page scripts, accidental browser sync,
casual storage inspection, and—when the encrypted vault is locked—offline
profile copying. They do not make a browser extension equivalent to server-side
key custody. Malicious extension code, a compromised extension update, a
debugger, or malware running with the user's privileges could use an unlocked
key.

For additional containment, use a dedicated OpenAI project and API key, set a
low project budget and notification thresholds, review usage regularly, and
rotate the key if anything looks unexpected.

## Use captions

1. Join a call in Discord Web.
2. Confirm everyone has consented to live transcription.
3. Click the extension's toolbar icon in the active Discord tab.
4. Watch the status indicator turn green when live captions are ready.
5. Click the toolbar icon again—or the close button above the captions—to stop.

Chrome displays its normal capture indicator while the extension is listening
to the selected tab. Captions and audio are not retained after they are shown.

## Caption settings

The extension options include:

| Setting | Purpose |
| --- | --- |
| Expected languages | Comma-separated language codes such as `en, es` |
| Vocabulary hints | Names, places, acronyms, and other expected terms |
| Call context | Short, non-sensitive context that can improve transcription |

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Limits toolbar actions to the user-selected active tab |
| `tabCapture` | Captures audio from the active Discord Web tab after a toolbar click |
| `offscreen` | Keeps audio processing active outside the Discord page |
| `storage` | Stores preferences, session key state, and optional encrypted vault data |
| `https://discord.com/*` | Injects and updates the caption overlay |
| `https://api.openai.com/*` | Creates a short-lived session credential and connects to transcription |

The content security policy permits network connections only to OpenAI. The
extension contains no remote JavaScript and accepts messages only from its own
extension ID.

## Privacy and consent

While captions are active, captured tab audio is sent directly to OpenAI for
processing. Review [OpenAI's API data usage policies](https://openai.com/policies/api-data-usage-policies/)
for current service details.

The extension itself does not record calls or persist audio or transcripts.
Recording and interception laws vary by location; this project is not legal
advice. Do not use it on calls where you are not a participant or where the
other participants have not consented.

## Troubleshooting

### Clicking the icon opens settings

The API key is missing or the encrypted vault is locked. Save a session key or
unlock the vault, return to the Discord tab, and click the icon again.

### OpenAI rejects the session

Verify that the key is active, belongs to an API project with billing enabled,
and can access `gpt-live-transcribe`. ChatGPT subscriptions do not include API
credits.

### No captions appear

- Confirm the active tab is on `https://discord.com/`.
- Confirm the call audio is actually playing from that tab.
- Reload the unpacked extension after pulling code changes, then re-enter or
  unlock the API key.
- Check the extension service worker and offscreen-document consoles from
  `chrome://extensions` for sanitized error messages.

### The other participant cannot see captions

The overlay is local to the person running the extension. Each participant who
wants captions should install and run it themselves.

## Development

The runtime extension has no npm dependencies. Node.js 20 or newer is used for
checks, tests, local UI preview, and packaging.

```bash
npm install
npm run check
npm test
```

Preview the options page without installing the extension:

```bash
npm run preview
```

Create a distributable zip in the ignored `dist/` directory:

```bash
npm run package:extension
```

The checks validate all JavaScript syntax and keep the package and extension
versions aligned. Unit tests cover PCM conversion, settings normalization,
encrypted-vault round trips, Realtime session configuration, token exchange,
and transcript event mapping.

## Repository layout

```text
.
├── docs/                 # README assets
├── extension/            # Manifest V3 extension source
│   ├── key-vault.js      # Session and passphrase-encrypted BYOK storage
│   ├── openai-realtime.js # Direct OpenAI Realtime client
│   ├── offscreen.js      # Tab audio capture and streaming lifecycle
│   └── content.js        # Discord caption overlay
├── scripts/              # Checks, preview server, and packaging
├── test/unit/            # Deterministic unit tests
├── LICENSE
├── package.json
└── README.md
```

## References

- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI Realtime WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket)
- [OpenAI API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key)
- [Chrome tab capture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

## License

[MIT](LICENSE)
