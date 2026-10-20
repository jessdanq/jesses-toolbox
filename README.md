# Jesse's Toolbox

A modern, fast, and personal digital toolbox with everyday practice and media tools.

---

## Tools

### 1. YouTube to MP3 (`#mp3`)
- Converts YouTube and YouTube Music audio directly on your local computer using `yt-dlp` and `FFmpeg`.
- Supports standard YouTube (`youtube.com`, `youtu.be`) and YouTube Music (`music.youtube.com`) track links.
- Selectable bitrates: **128 kbps**, **192 kbps**, and **320 kbps**.
- Clean status indicators, progress tracking, and direct MP3 download.

### 2. YouTube A–B Repeater (`#repeater`)
- Practice with any YouTube clip.
- Precise start (A) and end (B) loop points.
- Adjustable playback rate (0.25× – 2×) and loop repetition counter.

### 3. Local Video A–B Repeater (`#local-repeater`)
- Play and repeat sections of any local video file from your drive (`.mp4`, `.webm`, `.mov`, `.mkv`, `.m4v`).
- **100% In-Browser & Private**: Video never leaves your computer; zero network lag or buffering.
- **Interactive Scrubber & Timeline**: Visual colored interval highlight for the looped section with draggable/clickable A and B flag pins.
- **Frame-Accurate Controls**: `[-0.1s]` and `[+0.1s]` nudge buttons, direct timestamp input, and instant "Go to A" / "Go to B" jumps.
- **Practice Delay Option**: Set pauses between repeats (0s, 0.5s, 1s, 2s, 3s) to reset your posture or hands.
- **Keyboard Shortcuts**:
  - <kbd>Space</kbd>: Play / Pause
  - <kbd>L</kbd>: Start / Stop Loop
  - <kbd>A</kbd> or <kbd>[</kbd>: Set Point A
  - <kbd>B</kbd> or <kbd>]</kbd>: Set Point B
  - <kbd>←</kbd> / <kbd>→</kbd>: Seek ±2s (<kbd>Shift</kbd> for ±0.5s)
  - <kbd>,</kbd> / <kbd>.</kbd>: Step frame backward / forward 0.1s
  - <kbd>0</kbd>: Jump to Point A
  - <kbd>M</kbd>: Mute / Unmute

### 4. Instagram Follow-Back Checker (`#ig-checker`)
- Find out who doesn't follow you back, see fans/admirers, and view mutual follows.
- **100% On-Device & Safe**: Uses your official Instagram data download (`followers_1.json` & `following.json`).
- **Zero Credentials & Zero Ban Risk**: No passwords, cookies, or account connections required; runs completely offline in your browser.
- **Interactive Tools**: Live search filtering, one-click username list copying, and CSV export.


---

## Getting Started

### Prerequisites
- Python 3.10+
- Modern web browser (Chrome, Edge, Firefox, Brave)

### Setup & Launch
1. Run `Setup backend.cmd` once to install backend dependencies (`yt-dlp` and `FFmpeg`) into `.deps`.
2. Run `Start toolbox.cmd` (or `python serve.py`).
3. Keep the terminal window open; the app will launch automatically in your browser.
