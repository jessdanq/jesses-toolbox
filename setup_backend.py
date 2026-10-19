from pathlib import Path
import subprocess
import sys
import os
import tempfile

root = Path(__file__).resolve().parent
print('Installing conversion dependencies into this toolbox folder…', flush=True)
(root / '.cache').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='setup-', dir=root / '.cache') as temp:
    env = dict(os.environ, TEMP=temp, TMP=temp)
    result = subprocess.run([sys.executable, '-m', 'pip', 'install', '--upgrade',
        '--target', str(root / '.deps'), 'yt-dlp[default]', 'imageio-ffmpeg'], env=env)
if result.returncode:
    raise SystemExit(result.returncode)
sys.path.insert(0, str(root / '.deps'))
from backend import dependency_status
missing = dependency_status()
if missing:
    print('Still needed: ' + ', '.join(missing))
    print('Install Node.js 22 or newer from https://nodejs.org/, then reopen the launcher.')
    raise SystemExit(1)
print('Backend ready. Run Start toolbox.cmd.')
