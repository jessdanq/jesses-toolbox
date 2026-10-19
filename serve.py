from backend import ToolboxServer
from pathlib import Path
import os
import webbrowser
import sys
import threading
from urllib.request import build_opener, ProxyHandler

os.chdir(Path(__file__).resolve().parent)

try:
    server = ToolboxServer()
except OSError as error:
    print('Cannot start a local server:', error, flush=True)
    raise SystemExit(1)

url = f'http://127.0.0.1:{server.server_port}/'
# Start accepting requests before launching the browser. Use the exact IPv4
# address we bound, avoiding localhost DNS/IPv6 and system proxy ambiguity.
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    opener = build_opener(ProxyHandler({}))
    with opener.open(url, timeout=5) as response:
        if response.status != 200 or b"Jesse's Toolbox" not in response.read():
            raise RuntimeError('The local server returned an unexpected page.')
    for asset in ['style.css', 'app.js']:
        with opener.open(url + asset, timeout=5) as response:
            if response.status != 200 or not response.read():
                raise RuntimeError('Could not load ' + asset)
    with opener.open(url + 'api/health', timeout=5) as response:
        import json
        health = json.load(response)
    if health['missing']:
        print('MP3 backend setup needed: ' + ', '.join(health['missing']), flush=True)
    print("Jesse's Toolbox is ready: " + url, flush=True)
    if '--check' not in sys.argv:
        print('Keep this window open. Press Ctrl+C to stop.', flush=True)
        if not webbrowser.open(url):
            print('Copy the address above into Chrome or Edge.', flush=True)
        while thread.is_alive():
            thread.join(timeout=0.5)
except KeyboardInterrupt:
    pass
except Exception as error:
    print('Local connection check failed: ' + str(error), flush=True)
    print('The browser has not been opened. Check whether security software blocks Python loopback connections.', flush=True)
    raise SystemExit(1)
finally:
    server.shutdown()
    server.server_close()
    server.close_jobs()
