Jesse's Toolbox — YouTube conversion backend

1. Extract the entire ZIP into a writable folder.
2. Run Setup backend.cmd once. It installs yt-dlp and FFmpeg support into .deps inside this folder.
3. If setup reports a missing JavaScript runtime, install Node.js 22+ from https://nodejs.org/ and reopen the launcher.
4. Run Start toolbox.cmd. Keep its window open.
5. Open YouTube to MP3, paste a YouTube or YouTube Music link, choose 128/192/320 kbps, and convert. Click Download MP3 when ready.
6. Open Local video A–B repeater to loop clips from your drive with frame nudges, practice pauses, and zero buffering.

Python 3.10+ and internet access are required. Setup can also be rerun to update the downloader when YouTube changes.
The local backend chooses a free port and stays bound to 127.0.0.1. It serves the UI and conversion API together. This Python backend is included in the ZIP; it is not hosted by Sites.
Single-track/video conversion only, up to two hours or 200 MB of source audio. Two jobs may run concurrently. Playlists and live streams are excluded.
Files are stored in .cache; completed jobs older than one hour are removed when another job starts. Closing the server stops active jobs and deletes its temporary session files. Download files before closing it.
YouTube may reject private, age-restricted, unavailable, or otherwise blocked videos. No browser cookies are accessed.

Verification: URL validation and local API tests passed, including authentication and private-file access checks. A generated WAV was encoded and the downloaded MP3 decoded successfully with FFmpeg. A live Big Buck Bunny YouTube conversion completed and returned a 15,231,212-byte MP3.

