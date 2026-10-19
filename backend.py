"""Local YouTube conversion service. All jobs live in a disposable temp folder."""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
if (ROOT / '.deps').exists():
    sys.path.insert(0, str(ROOT / '.deps'))

def canonical_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError('Enter a valid YouTube video link.')
    u = urlparse(value)
    if u.scheme not in ('http', 'https') or u.username or u.password:
        raise ValueError('Enter a valid YouTube video link.')
    if u.hostname == 'youtu.be':
        video = u.path.strip('/').split('/')[0]
    elif u.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
        video = parse_qs(u.query).get('v', [''])[0]
        if not video:
            match = re.fullmatch(r'/(?:shorts|embed|live)/([\w-]{11})/?', u.path)
            video = match[1] if match else ''
    else:
        video = ''
    if not re.fullmatch(r'[\w-]{11}', video):
        raise ValueError('Enter a valid YouTube video link, not a playlist.')
    return 'https://www.youtube.com/watch?v=' + video

def ffmpeg_path():
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None

def dependency_status():
    import importlib.util
    missing = []
    if not importlib.util.find_spec('yt_dlp'):
        missing.append('yt-dlp')
    if not ffmpeg_path():
        missing.append('FFmpeg')
    if not (shutil.which('node') or shutil.which('deno')):
        missing.append('Node.js 22+ or Deno')
    return missing

def write_status(folder, **values):
    temporary = folder / 'status.tmp'
    temporary.write_text(json.dumps(values), encoding='utf-8')
    for attempt in range(6):
        try:
            temporary.replace(folder / 'status.json')
            break
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(.03)

def stop_process(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        # Stop only this job's worker and its FFmpeg child when closing the app.
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=15)
    else:
        process.kill()
    process.wait(timeout=15)

def encode_mp3(source, target, bitrate):
    process = subprocess.run([ffmpeg_path(), '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-y', '-i', str(source), '-vn', '-map_metadata', '-1', '-codec:a', 'libmp3lame',
        '-b:a', str(bitrate) + 'k', str(target)], capture_output=True, timeout=600,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if process.returncode or not target.exists() or target.stat().st_size == 0:
        raise RuntimeError('FFmpeg could not convert the downloaded audio.')

def worker(folder, url, bitrate):
    import yt_dlp
    last = 0
    def progress(info):
        nonlocal last
        if info.get('downloaded_bytes', 0) > 200 * 1024 * 1024:
            raise ValueError('Audio exceeds the 200 MB download limit.')
        if time.monotonic() - last < .5:
            return
        last = time.monotonic()
        total = info.get('total_bytes') or info.get('total_bytes_estimate')
        percent = min(99, round(info.get('downloaded_bytes', 0) * 100 / total)) if total else None
        write_status(folder, state='downloading', message='Downloading audio…', percent=percent)
    def allowed(info, *, incomplete=False):
        if info.get('is_live'):
            return 'Live streams are not supported.'
        if (info.get('duration') or 0) > 7200:
            return 'Choose a video shorter than two hours.'
    runtimes = {'node': {'path': shutil.which('node')}} if shutil.which('node') else {'deno': {}}
    options = {'format': 'bestaudio/best', 'outtmpl': str(folder / 'source.%(ext)s'),
        'noplaylist': True, 'quiet': True, 'no_warnings': True, 'cachedir': False,
        'socket_timeout': 20, 'retries': 2, 'fragment_retries': 2,
        'max_filesize': 200 * 1024 * 1024, 'match_filter': allowed,
        'progress_hooks': [progress], 'js_runtimes': runtimes}
    write_status(folder, state='downloading', message='Getting video details…', percent=None)
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
        if not info:
            raise ValueError('This video could not be downloaded.')
        source = Path(downloader.prepare_filename(info))
    if not source.exists():
        raise ValueError('No audio was downloaded. The video may exceed the size limit.')
    write_status(folder, state='converting', message='Converting to MP3…', percent=None)
    encode_mp3(source, folder / 'audio.mp3', bitrate)
    source.unlink(missing_ok=True)
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', info.get('title') or 'youtube-audio')[:120].strip('. ')
    write_status(folder, state='complete', message='Your MP3 is ready.', percent=100,
                 filename=(title or 'youtube-audio') + '.mp3')

class ToolboxServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self):
        super().__init__(('127.0.0.1', 0), Handler)
        self.token = secrets.token_urlsafe(32)
        self.jobs = {}
        self.lock = threading.Lock()
        (ROOT / '.cache').mkdir(exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(prefix='jobs-', dir=ROOT / '.cache')
    def close_jobs(self):
        with self.lock:
            for job in self.jobs.values():
                process = job.get('process')
                if process and process.poll() is None:
                    stop_process(process)
        self.scratch.cleanup()
    def convert(self, job):
        folder = job['folder']
        try:
            env = dict(os.environ)
            env['PYTHONPATH'] = str(ROOT / '.deps') + os.pathsep + env.get('PYTHONPATH', '')
            with (folder / 'worker.log').open('wb') as log:
                with self.lock:
                    if job.get('cancelled'):
                        return
                    job['process'] = subprocess.Popen([sys.executable, str(ROOT / 'backend.py'),
                        '--worker', str(folder), job['url'], str(job['bitrate'])],
                        stdout=log, stderr=log, env=env,
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    code = job['process'].wait(timeout=1200)
                except subprocess.TimeoutExpired:
                    stop_process(job['process'])
                    raise RuntimeError('Conversion timed out. Try a shorter video.')
            if job.get('cancelled'):
                return
            if code:
                detail = (folder / 'status.json').read_text(encoding='utf-8') if (folder / 'status.json').exists() else '{}'
                if json.loads(detail).get('state') != 'error':
                    raise RuntimeError('The downloader stopped. Try again or update the backend dependencies.')
        except Exception as error:
            if not job.get('cancelled'):
                write_status(folder, state='error', message=str(error)[:800])
        finally:
            job['finished'] = time.time()
            job['active'] = False

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def valid_host(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'
    def json_response(self, status, body):
        content = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)
    def authenticated(self):
        origin = self.headers.get('Origin')
        expected = f'http://127.0.0.1:{self.server.server_port}'
        return self.valid_host() and (not origin or origin == expected) and secrets.compare_digest(
            self.headers.get('X-Toolbox-Token', ''), self.server.token)
    def do_GET(self):
        if not self.valid_host():
            return self.json_response(403, {'error': 'Use the local address printed by the launcher.'})
        path = urlparse(self.path).path
        if path == '/api/health':
            missing = dependency_status()
            return self.json_response(200, {'ready': not missing, 'missing': missing, 'token': self.server.token})
        match = re.fullmatch(r'/api/jobs/([a-f0-9]{32})(/download)?', path)
        if match:
            job = self.server.jobs.get(match[1])
            if not job:
                return self.json_response(404, {'error': 'This conversion has expired. Convert the video again.'})
            try:
                data = json.loads((job['folder'] / 'status.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                data = {'state': 'queued', 'message': 'Starting conversion…'}
            if not match[2]:
                if not self.authenticated():
                    return self.json_response(403, {'error': 'Refresh the toolbox and try again.'})
                return self.json_response(200, data)
            target = job['folder'] / 'audio.mp3'
            if data['state'] != 'complete' or not target.exists():
                return self.json_response(409, {'error': 'The MP3 is not ready.'})
            from urllib.parse import quote
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Disposition', "attachment; filename=\"youtube-audio.mp3\"; filename*=UTF-8''" + quote(data['filename']))
            self.send_header('Content-Length', str(target.stat().st_size))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                with target.open('rb') as file:
                    shutil.copyfileobj(file, self.wfile)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if path not in ('/', '/index.html', '/style.css', '/app.js'):
            return self.send_error(404)
        super().do_GET()
    def do_HEAD(self):
        if not self.valid_host() or urlparse(self.path).path not in ('/', '/index.html', '/style.css', '/app.js'):
            return self.send_error(404)
        super().do_HEAD()
    def do_POST(self):
        if not self.authenticated():
            return self.json_response(403, {'error': 'Refresh the toolbox and try again.'})
        if self.path != '/api/jobs':
            return self.send_error(404)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8192:
                raise ValueError('Invalid request size.')
            body = json.loads(self.rfile.read(length))
            url = canonical_url(body.get('url'))
            bitrate = int(body.get('bitrate', 192))
            if bitrate not in (128, 192, 320):
                raise ValueError('Choose 128, 192, or 320 kbps.')
        except (ValueError, TypeError, AttributeError):
            return self.json_response(400, {'error': 'Enter a valid YouTube link and choose an available MP3 quality.'})
        missing = dependency_status()
        if missing:
            return self.json_response(503, {'error': 'Run Setup backend.cmd. Missing: ' + ', '.join(missing)})
        with self.server.lock:
            for job_id, job in list(self.server.jobs.items()):
                if job.get('finished', float('inf')) < time.time() - 3600:
                    shutil.rmtree(job['folder'], ignore_errors=True)
                    del self.server.jobs[job_id]
            if sum(j['active'] for j in self.server.jobs.values()) >= 2:
                return self.json_response(429, {'error': 'Two conversions are already running. Wait for one to finish.'})
            job_id = secrets.token_hex(16)
            folder = Path(self.server.scratch.name) / job_id
            folder.mkdir()
            job = {'folder': folder, 'url': url, 'bitrate': bitrate, 'active': True}
            write_status(folder, state='queued', message='Starting conversion…', percent=None)
            self.server.jobs[job_id] = job
        threading.Thread(target=self.server.convert, args=(job,), daemon=True).start()
        self.json_response(202, {'id': job_id})

if __name__ == '__main__' and len(sys.argv) == 5 and sys.argv[1] == '--worker':
    folder = Path(sys.argv[2])
    try:
        worker(folder, canonical_url(sys.argv[3]), int(sys.argv[4]))
    except Exception as error:
        text = re.sub(r'\x1b\[[0-9;]*m', '', str(error))
        write_status(folder, state='error', message=text[:800])
        raise SystemExit(1)
