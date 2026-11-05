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
        raise ValueError('Enter a valid YouTube or YouTube Music link.')
    value = value.strip()
    if not value:
        raise ValueError('Enter a valid YouTube or YouTube Music link.')
    if not re.match(r'^https?://', value, re.IGNORECASE):
        value = 'https://' + value
    u = urlparse(value)
    if u.scheme not in ('http', 'https') or u.username or u.password:
        raise ValueError('Enter a valid YouTube or YouTube Music link.')
    host = (u.hostname or '').lower()
    video = ''
    if host == 'youtu.be':
        video = u.path.strip('/').split('/')[0]
    elif host in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.music.youtube.com', 'm.music.youtube.com', 'www.youtube-nocookie.com'):
        video = parse_qs(u.query).get('v', [''])[0]
        if not video:
            match = re.fullmatch(r'/(?:shorts|embed|live)/([\w-]{11})/?', u.path)
            video = match[1] if match else ''
    if not re.fullmatch(r'[\w-]{11}', video):
        if parse_qs(u.query).get('list') or 'playlist' in u.path:
            raise ValueError('Playlists are not supported. Please paste a direct track or video link.')
        raise ValueError('Enter a valid YouTube or YouTube Music link, not a playlist.')
    return 'https://www.youtube.com/watch?v=' + video

def clean_web_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError('Enter a valid website or video link.')
    value = value.strip()
    if not value:
        raise ValueError('Enter a valid website or video link.')
    if not re.match(r'^https?://', value, re.IGNORECASE):
        value = 'https://' + value
    u = urlparse(value)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
        raise ValueError('Enter a valid website or video link (http:// or https://).')
    return value

def format_duration(seconds):
    if seconds is None:
        return 'Unknown duration'
    try:
        s = int(round(float(seconds)))
    except (TypeError, ValueError):
        return 'Unknown duration'
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f'{h}h {m:02d}m {s:02d}s'
    return f'{m:02d}:{s:02d}'

def format_bytes(b):
    if not b:
        return None
    for unit in ['B', 'KB', 'MB', 'GB']:
        if b < 1024.0:
            return f'{b:.1f} {unit}'
        b /= 1024.0
    return f'{b:.1f} TB'

def probe_ffprobe_duration(url):
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        return None
    ffprobe = Path(ffmpeg).parent / 'ffprobe.exe'
    if not ffprobe.exists():
        ffprobe = shutil.which('ffprobe')
    if not ffprobe or not Path(ffprobe).exists():
        return None
    try:
        res = subprocess.run([
            str(ffprobe), '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            url
        ], capture_output=True, text=True, timeout=8)
        val = res.stdout.strip()
        if val:
            return float(val)
    except Exception:
        pass
    return None

def probe_media_from_url(url):
    url = clean_web_url(url)
    import yt_dlp
    videos = []
    seen_urls = set()

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'extract_flat': 'in_playlist',
        'noplaylist': False,
        'socket_timeout': 15,
        'ffmpeg_location': ffmpeg_path(),
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                entries = info.get('entries')
                if entries:
                    for entry in entries:
                        if not entry:
                            continue
                        e_url = entry.get('url') or entry.get('webpage_url') or url
                        if e_url in seen_urls:
                            continue
                        seen_urls.add(e_url)
                        dur = entry.get('duration')
                        videos.append({
                            'id': f'vid_{len(videos)+1}',
                            'title': entry.get('title') or 'Untitled Video',
                            'duration': round(dur, 1) if dur else None,
                            'duration_str': format_duration(dur),
                            'thumbnail': entry.get('thumbnail'),
                            'url': e_url,
                            'extractor': info.get('extractor', 'web'),
                            'formats': [
                                {'format_id': 'best', 'label': 'Best Available Quality (MP4)', 'resolution': 'Best', 'ext': 'mp4'},
                                {'format_id': 'audio', 'label': 'Audio Only (MP3)', 'resolution': 'Audio', 'ext': 'mp3'}
                            ]
                        })
                else:
                    title = info.get('title') or 'Video'
                    dur = info.get('duration')
                    thumb = info.get('thumbnail')
                    v_url = info.get('webpage_url') or url
                    seen_urls.add(v_url)

                    formats_list = []
                    formats = info.get('formats') or []
                    res_seen = set()
                    for f in reversed(formats):
                        if f.get('vcodec') == 'none':
                            continue
                        res = f.get('resolution') or (f"{f.get('height')}p" if f.get('height') else None)
                        if res and res not in res_seen:
                            res_seen.add(res)
                            fs = f.get('filesize') or f.get('filesize_approx')
                            formats_list.append({
                                'format_id': str(f.get('format_id')),
                                'label': f"{res} (MP4)" + (f" - {format_bytes(fs)}" if fs else ""),
                                'resolution': res,
                                'ext': 'mp4',
                                'filesize': fs,
                                'filesize_str': format_bytes(fs)
                            })
                    if not formats_list:
                        formats_list.append({
                            'format_id': 'best',
                            'label': 'Best Video (MP4)',
                            'resolution': 'Best',
                            'ext': 'mp4'
                        })
                    formats_list.append({
                        'format_id': 'audio',
                        'label': 'Audio Only (MP3)',
                        'resolution': 'Audio',
                        'ext': 'mp3'
                    })

                    videos.append({
                        'id': f'vid_{len(videos)+1}',
                        'title': title,
                        'duration': round(dur, 1) if dur else None,
                        'duration_str': format_duration(dur),
                        'thumbnail': thumb,
                        'url': v_url,
                        'extractor': info.get('extractor', 'web'),
                        'formats': formats_list
                    })
    except Exception:
        pass

    try:
        import urllib.request
        from urllib.parse import urljoin
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            found_media = []
            for p in [
                r'''<source[^>]+src=["']([^"']+)["']''',
                r'''<video[^>]+src=["']([^"']+)["']''',
                r'''<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']''',
                r'''<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url)?["']'''
            ]:
                for m in re.findall(p, html, re.I):
                    full = urljoin(url, m)
                    if any(full.lower().endswith(ext) or ext in full.lower() for ext in ['.mp4', '.webm', '.m3u8', '.mov', '.m4v']):
                        if full not in seen_urls:
                            seen_urls.add(full)
                            found_media.append(full)

            for media_url in found_media:
                dur = probe_ffprobe_duration(media_url)
                name = Path(urlparse(media_url).path).name or 'Video File'
                videos.append({
                    'id': f'vid_{len(videos)+1}',
                    'title': name,
                    'duration': round(dur, 1) if dur else None,
                    'duration_str': format_duration(dur),
                    'thumbnail': None,
                    'url': media_url,
                    'extractor': 'html5',
                    'formats': [{
                        'format_id': 'best',
                        'label': 'Original Video (MP4)',
                        'resolution': 'Original',
                        'ext': 'mp4'
                    }]
                })
    except Exception:
        pass

    for v in videos:
        if v.get('duration') is None and v.get('url'):
            dur = probe_ffprobe_duration(v['url'])
            if dur:
                v['duration'] = round(dur, 1)
                v['duration_str'] = format_duration(dur)

    return videos

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

def encode_mp4(source, target):
    process = subprocess.run([ffmpeg_path(), '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-y', '-i', str(source), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(target)],
        capture_output=True, timeout=900,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if process.returncode or not target.exists() or target.stat().st_size == 0:
        raise RuntimeError('FFmpeg could not process the downloaded video.')

def format_time_slug(seconds_val):
    seconds_val = max(0, int(round(seconds_val)))
    m, s = divmod(seconds_val, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}h{m:02d}m{s:02d}s"
    return f"{m}m{s:02d}s"

def worker(folder, url, bitrate=192, fmt='mp3', start=None, end=None, format_id=None, is_generic=False, custom_title=None):
    import yt_dlp
    last = 0
    is_clip = (start is not None and end is not None)
    if is_clip:
        start = max(0.0, float(start))
        end = float(end)
        if end <= start or (end - start) < 0.5:
            raise ValueError('End time (Point B) must be at least 0.5s after Start time (Point A).')
    max_bytes = 2000 * 1024 * 1024

    def progress(info):
        nonlocal last
        if info.get('downloaded_bytes', 0) > max_bytes:
            raise ValueError('Media exceeds the 2 GB download limit.')
        if time.monotonic() - last < .5:
            return
        last = time.monotonic()
        total = info.get('total_bytes') or info.get('total_bytes_estimate')
        percent = min(99, round(info.get('downloaded_bytes', 0) * 100 / total)) if total else None
        msg = 'Downloading clip segment…' if is_clip else ('Downloading video…' if fmt == 'mp4' else 'Downloading audio…')
        write_status(folder, state='downloading', message=msg, percent=percent)

    def allowed(info, *, incomplete=False):
        if info.get('is_live'):
            return 'Live streams are not supported.'
        if is_clip:
            if (end - start) > 7200:
                return 'Selected clip duration cannot exceed two hours.'
        elif not is_generic and (info.get('duration') or 0) > 14400:
            return 'Choose a video shorter than four hours.'

    runtimes = {'node': {'path': shutil.which('node')}} if shutil.which('node') else {'deno': {}}
    if format_id == 'audio':
        fmt = 'mp3'
    
    if fmt == 'mp4':
        if format_id and format_id not in ('best', 'audio'):
            format_opt = f"{format_id}+bestaudio/best"
        else:
            format_opt = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
    else:
        format_opt = 'bestaudio/best'

    options = {
        'format': format_opt,
        'outtmpl': str(folder / 'source.%(ext)s'),
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'cachedir': False,
        'socket_timeout': 20,
        'retries': 2,
        'fragment_retries': 2,
        'max_filesize': max_bytes,
        'match_filter': allowed,
        'progress_hooks': [progress],
        'js_runtimes': runtimes,
        'ffmpeg_location': ffmpeg_path(),
    }
    if is_clip:
        options['download_ranges'] = yt_dlp.utils.download_range_func(None, [(start, end)])
        options['force_keyframes_at_cuts'] = True

    write_status(folder, state='downloading', message='Getting video details…', percent=None)
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
        if not info:
            raise ValueError('This video could not be downloaded.')
        source = Path(downloader.prepare_filename(info))

    if not source.exists():
        candidates = [p for p in folder.glob('source.*') if not p.name.endswith('.part') and not p.name.endswith('.ytdl')]
        if candidates:
            source = candidates[0]
        else:
            raise ValueError('No media was downloaded. The video may exceed size limits or be restricted.')

    if fmt == 'mp4':
        write_status(folder, state='converting', message='Processing MP4 clip…' if is_clip else 'Processing MP4 video…', percent=None)
        target = folder / 'clip.mp4'
        encode_mp4(source, target)
        target_file = 'clip.mp4'
        ext = 'mp4'
    else:
        write_status(folder, state='converting', message='Encoding MP3 clip…' if is_clip else 'Converting to MP3…', percent=None)
        target = folder / 'audio.mp3'
        encode_mp3(source, target, bitrate)
        target_file = 'audio.mp3'
        ext = 'mp3'

    source.unlink(missing_ok=True)
    raw_title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', custom_title or info.get('title') or 'video')[:100].strip('. ')
    if is_clip:
        time_slug = f"[{format_time_slug(start)} - {format_time_slug(end)}]"
        filename = f"{raw_title} {time_slug}.{ext}"
    else:
        filename = f"{raw_title}.{ext}"

    write_status(folder, state='complete',
                 message='Your A–B clip is ready.' if is_clip else 'Your download is ready.',
                 percent=100,
                 filename=filename,
                 target_file=target_file)

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
                        '--worker', str(folder)],
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


IG_CACHE_FILE = ROOT / 'instagram_cache.json'

def load_ig_cache():
    if IG_CACHE_FILE.exists():
        try:
            data = json.loads(IG_CACHE_FILE.read_text(encoding='utf-8'))
            if isinstance(data, dict):
                data.setdefault('accounts', {})
                data.setdefault('followers', [])
                data.setdefault('following', [])
                data.setdefault('ignored', [])
                data.setdefault('previousNotFollowingBack', [])
                data.setdefault('reviewedNew', [])
                data.setdefault('lastUpdated', None)
                return data
        except (OSError, ValueError):
            pass
    return {'accounts': {}, 'followers': [], 'following': [], 'ignored': [], 'previousNotFollowingBack': [], 'reviewedNew': [], 'lastUpdated': None}

def save_ig_cache(data):
    temporary = ROOT / 'instagram_cache.tmp'
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    for attempt in range(6):
        try:
            temporary.replace(IG_CACHE_FILE)
            break
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(.03)

def verify_instagram_user(username):
    username = username.strip().lower()
    if username in ('instagram_user', 'facebook_user') or username.isdigit() or len(username) > 100:
        res = {'username': username, 'exists': False, 'reason': 'placeholder'}
        try:
            current = load_ig_cache()
            current['accounts'][username] = {'status': 'inactive', 'reason': 'placeholder', 'timestamp': int(time.time() * 1000)}
            save_ig_cache(current)
        except Exception:
            pass
        return res
    import urllib.request
    import ssl
    url = f'https://www.instagram.com/{username}/'
    headers = {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, context=ctx, timeout=7) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
            title_m = re.search(r'<title>(.*?)</title>', content, re.IGNORECASE)
            title = title_m.group(1) if title_m else ''
            lower_title = title.lower()
            has_user = f'&#064;{username}' in lower_title or f'@{username}' in lower_title or f'({username})' in lower_title
            og_desc = 'og:description' in content
            exists = bool(has_user or og_desc)
            res = {'username': username, 'exists': exists, 'checked': True}
            try:
                current = load_ig_cache()
                current['accounts'][username] = {'status': 'active' if exists else 'inactive', 'timestamp': int(time.time() * 1000)}
                save_ig_cache(current)
            except Exception:
                pass
            return res
    except urllib.error.HTTPError as e:
        if e.code == 404:
            res = {'username': username, 'exists': False, 'checked': True}
            try:
                current = load_ig_cache()
                current['accounts'][username] = {'status': 'inactive', 'timestamp': int(time.time() * 1000)}
                save_ig_cache(current)
            except Exception:
                pass
            return res
        if e.code == 429:
            return {'username': username, 'error': 'Rate limited by Instagram', 'rate_limited': True}
        return {'username': username, 'error': f'HTTP {e.code}'}
    except Exception as e:
        return {'username': username, 'error': str(e)}

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
        if path == '/api/ig/data':
            if not self.authenticated():
                return self.json_response(403, {'error': 'Refresh the toolbox and try again.'})
            return self.json_response(200, load_ig_cache())
        if path == '/api/ig/verify':
            if not self.authenticated():
                return self.json_response(403, {'error': 'Refresh the toolbox and try again.'})
            query = parse_qs(urlparse(self.path).query)
            user = query.get('username', [''])[0].strip().lower()
            if not re.fullmatch(r'[a-zA-Z0-9._]{1,100}', user):
                return self.json_response(400, {'error': 'Enter a valid Instagram username.'})
            result = verify_instagram_user(user)
            return self.json_response(200, result)
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
            target_name = data.get('target_file') or ('clip.mp4' if data.get('filename', '').endswith('.mp4') else 'audio.mp3')
            target = job['folder'] / target_name
            if data['state'] != 'complete' or not target.exists():
                return self.json_response(409, {'error': 'The download is not ready.'})
            from urllib.parse import quote
            self.send_response(200)
            content_type = 'video/mp4' if target_name.endswith('.mp4') else 'audio/mpeg'
            self.send_header('Content-Type', content_type)
            safe_filename = data.get('filename', 'download')
            safe_ascii = re.sub(r'[^\x20-\x7e]', '_', safe_filename)
            self.send_header('Content-Disposition', f'attachment; filename="{safe_ascii}"; filename*=UTF-8\'\'{quote(safe_filename)}')
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
        path = urlparse(self.path).path
        if path == '/api/ig/data':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 30 * 1024 * 1024:
                    raise ValueError('Request size exceeds 30 MB limit.')
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError('Expected JSON object.')
                current = load_ig_cache()
                if 'accounts' in payload and isinstance(payload['accounts'], dict):
                    current['accounts'].update(payload['accounts'])
                if 'followers' in payload and isinstance(payload['followers'], list):
                    current['followers'] = payload['followers']
                if 'following' in payload and isinstance(payload['following'], list):
                    current['following'] = payload['following']
                if 'ignored' in payload and isinstance(payload['ignored'], list):
                    current['ignored'] = payload['ignored']
                if 'previousNotFollowingBack' in payload and isinstance(payload['previousNotFollowingBack'], list):
                    current['previousNotFollowingBack'] = payload['previousNotFollowingBack']
                if 'reviewedNew' in payload and isinstance(payload['reviewedNew'], list):
                    current['reviewedNew'] = payload['reviewedNew']
                if 'lastUpdated' in payload:
                    current['lastUpdated'] = payload['lastUpdated']
                save_ig_cache(current)
                return self.json_response(200, {'ok': True, 'saved': True})
            except Exception as e:
                return self.json_response(400, {'error': f'Could not save Instagram data: {str(e)}'})
        if path == '/api/audio/encode-mp3':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 200 * 1024 * 1024:
                    raise ValueError('Audio payload exceeds size limit (200 MB).')
                query = parse_qs(urlparse(self.path).query)
                bitrate = int(query.get('bitrate', ['192'])[0])
                if bitrate not in (128, 192, 320):
                    bitrate = 192
                filename = query.get('filename', ['looped-audio.mp3'])[0]
                filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', filename)[:120].strip('. ') or 'looped-audio.mp3'
                if not filename.lower().endswith('.mp3'):
                    filename += '.mp3'
                
                ffmpeg = ffmpeg_path()
                if not ffmpeg:
                    raise RuntimeError('FFmpeg is not available.')

                wav_bytes = self.rfile.read(length)
                proc = subprocess.Popen([
                    ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error',
                    '-y', '-f', 'wav', '-i', 'pipe:0',
                    '-codec:a', 'libmp3lame', '-b:a', f'{bitrate}k',
                    '-f', 'mp3', 'pipe:1'
                ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

                out_mp3, err = proc.communicate(input=wav_bytes, timeout=180)
                if proc.returncode != 0 or not out_mp3:
                    raise RuntimeError('FFmpeg conversion failed: ' + err.decode('utf-8', errors='ignore')[:300])

                from urllib.parse import quote
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Disposition', f'attachment; filename="audio.mp3"; filename*=UTF-8\'\'{quote(filename)}')
                self.send_header('Content-Length', str(len(out_mp3)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(out_mp3)
                return
            except Exception as e:
                return self.json_response(400, {'error': f'Could not encode MP3: {str(e)}'})

        if path == '/api/probe':
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('Invalid request size.')
                body = json.loads(self.rfile.read(length))
                url = clean_web_url(body.get('url'))
                videos = probe_media_from_url(url)
                return self.json_response(200, {'ok': True, 'videos': videos})
            except Exception as e:
                return self.json_response(400, {'error': str(e) or 'Could not inspect webpage for videos.'})

        if path != '/api/jobs':
            return self.send_error(404)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Invalid request size.')
            body = json.loads(self.rfile.read(length))
            is_generic = bool(body.get('is_generic', False))
            url = clean_web_url(body.get('url')) if is_generic else canonical_url(body.get('url'))
            format_id = body.get('format_id')
            custom_title = body.get('title')
            fmt = str(body.get('format', 'mp3')).lower()
            if format_id == 'audio':
                fmt = 'mp3'
            if fmt not in ('mp3', 'mp4'):
                raise ValueError('Format must be mp3 or mp4.')
            bitrate = int(body.get('bitrate', 192))
            if bitrate not in (128, 192, 320):
                bitrate = 192
            start = body.get('start')
            end = body.get('end')
            if start is not None or end is not None:
                if start is None or end is None:
                    raise ValueError('Both start (Point A) and end (Point B) are required for clip downloads.')
                start = max(0.0, float(start))
                end = float(end)
                if end <= start or (end - start) < 0.5:
                    raise ValueError('End time (Point B) must be at least 0.5s after Start time (Point A).')
                if (end - start) > 7200:
                    raise ValueError('Clip duration cannot exceed two hours.')
        except (ValueError, TypeError, AttributeError) as e:
            return self.json_response(400, {'error': str(e) or 'Enter a valid YouTube link and parameters.'})
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
            job_config = {
                'url': url,
                'format': fmt,
                'format_id': format_id,
                'is_generic': is_generic,
                'title': custom_title,
                'bitrate': bitrate,
                'start': start,
                'end': end
            }
            (folder / 'job.json').write_text(json.dumps(job_config), encoding='utf-8')
            job = {'folder': folder, 'url': url, 'bitrate': bitrate, 'format': fmt, 'active': True}
            write_status(folder, state='queued', message='Starting download…', percent=None)
            self.server.jobs[job_id] = job
        threading.Thread(target=self.server.convert, args=(job,), daemon=True).start()
        self.json_response(202, {'id': job_id})

if __name__ == '__main__' and len(sys.argv) >= 3 and sys.argv[1] == '--worker':
    folder = Path(sys.argv[2])
    try:
        if len(sys.argv) == 5:
            worker(folder, canonical_url(sys.argv[3]), int(sys.argv[4]))
        else:
            job_file = folder / 'job.json'
            if not job_file.exists():
                raise ValueError('Job configuration not found.')
            cfg = json.loads(job_file.read_text(encoding='utf-8'))
            is_gen = bool(cfg.get('is_generic', False))
            url_val = clean_web_url(cfg['url']) if is_gen else canonical_url(cfg['url'])
            worker(folder,
                   url=url_val,
                   bitrate=int(cfg.get('bitrate', 192)),
                   fmt=str(cfg.get('format', 'mp3')),
                   start=cfg.get('start'),
                   end=cfg.get('end'),
                   format_id=cfg.get('format_id'),
                   is_generic=is_gen,
                   custom_title=cfg.get('title'))
    except Exception as error:
        text = re.sub(r'\x1b\[[0-9;]*m', '', str(error))
        write_status(folder, state='error', message=text[:800])
        raise SystemExit(1)
