const $ = id => document.getElementById(id);
let player, ready = false, loop = false, repeats = 0;
let localVideo = null;

function route() {
  const hash = location.hash.slice(1);
  const page = ['mp3', 'repeater', 'local-repeater'].includes(hash) ? hash : 'home';
  for (const id of ['home', 'mp3', 'repeater', 'local-repeater']) {
    const el = $(id);
    if (el) el.hidden = id !== page;
  }
  if (page !== 'repeater' && ready && player && typeof player.pauseVideo === 'function') {
    player.pauseVideo();
  }
  if (page !== 'local-repeater' && localVideo && !localVideo.paused) {
    localVideo.pause();
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* --- YouTube A-B Repeater Logic --- */
function videoId(value) {
  try {
    const u = new URL(value);
    let id;
    if (u.hostname === 'youtu.be') id = u.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname)) {
      id = u.searchParams.get('v') || (/\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname) || [])[1];
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}
function format(t) {
  t = Math.max(0, t || 0);
  return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
}
function seconds(s) {
  const parts = s.trim().split(':');
  if (parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((a, p) => a * 60 + Number(p), 0);
}
function message(s) { $('loop-message').textContent = s; }

let apiPromise;
function loadAPI() {
  return apiPromise ||= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(Error('YouTube could not load. Check your connection and try again.')); };
    document.head.append(s);
    setTimeout(() => {
      if (!window.YT?.Player) { apiPromise = null; reject(Error('YouTube took too long to load. Please try again.')); }
    }, 15000);
  });
}
function resetLoop() {
  loop = false;
  repeats = 0;
  $('loop-count').textContent = '0 repeats';
  $('toggle-loop').textContent = 'Start loop ↺';
}
let playerTimeout, loadGeneration = 0;
function playerControls(enabled) {
  for (const id of ['set-a', 'set-b', 'toggle-loop', 'speed']) $(id).disabled = !enabled;
}
function playerFailure(text) {
  clearTimeout(playerTimeout);
  ready = false;
  resetLoop();
  playerControls(false);
  $('video-placeholder').hidden = true;
  message(text);
}

$('load-form').onsubmit = async e => {
  e.preventDefault();
  const id = videoId($('video-url').value);
  if (!id) return message('Please enter a valid YouTube video link.');
  if (!['http:', 'https:'].includes(location.protocol)) {
    return playerFailure('YouTube cannot play from a file opened directly. Start the toolbox with Start toolbox.cmd, then use the address it opens in Chrome or Edge.');
  }
  const generation = ++loadGeneration;
  clearTimeout(playerTimeout);
  ready = false;
  resetLoop();
  playerControls(false);
  message('Loading YouTube…');
  try {
    await loadAPI();
    if (generation !== loadGeneration) return;
    if (player) { player.destroy(); player = null; }
    const iframe = document.createElement('iframe');
    iframe.id = 'player';
    iframe.title = 'YouTube video player';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.style.border = '0';
    const url = new URL('https://www.youtube.com/embed/' + id);
    url.search = new URLSearchParams({
      enablejsapi: '1',
      origin: location.origin,
      widget_referrer: location.href.split('#')[0],
      playsinline: '1'
    });
    iframe.src = url.href;
    const placeholder = $('video-placeholder');
    placeholder.hidden = true;
    $('player')?.remove();
    $('video-shell').prepend(iframe);
    playerTimeout = setTimeout(() => {
      if (generation === loadGeneration && !ready) {
        playerFailure('YouTube did not finish connecting. If error 153 appears, open this HTTP/HTTPS page in Chrome or Edge. A local file or a preview that removes referrer information cannot run the embedded player.');
      }
    }, 15000);
    player = new YT.Player(iframe, {
      events: {
        onReady: () => {
          if (generation !== loadGeneration) return;
          clearTimeout(playerTimeout);
          ready = true;
          playerControls(true);
          message('Set A and B, then start your loop.');
          updateRates();
        },
        onStateChange: e => {
          if (generation !== loadGeneration || !ready) return;
          if (e.data === 1) updateRates();
          if (e.data === 0 && loop) {
            player.seekTo(seconds($('point-a').value), true);
            player.playVideo();
            repeats++;
            $('loop-count').textContent = repeats + ' repeats';
          }
        },
        onError: e => {
          if (generation !== loadGeneration) return;
          playerFailure(({
            100: 'This video is unavailable.',
            101: 'This video does not allow embedded playback.',
            150: 'This video does not allow embedded playback.',
            153: 'YouTube error 153: this browser did not provide the page identity. Open the toolbox over HTTP/HTTPS in Chrome or Edge, rather than as a local file or an app preview.'
          })[e.data] || 'YouTube cannot play this video. Try another link.');
        }
      }
    });
  } catch (e) {
    if (generation === loadGeneration) playerFailure(e.message);
  }
};

function updateRates() {
  const rates = player.getAvailablePlaybackRates();
  const selected = String(player.getPlaybackRate());
  $('speed').replaceChildren(...rates.map(r => {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = r + '×' + (r === 1 ? ' Normal' : '');
    return o;
  }));
  $('speed').value = selected;
}

$('speed').onchange = () => player.setPlaybackRate(Number($('speed').value));
for (const point of ['a', 'b']) {
  $('set-' + point).onclick = () => {
    $('point-' + point).value = format(player.getCurrentTime());
    resetLoop();
    message('Point ' + point.toUpperCase() + ' set. Start the loop when ready.');
  };
  $('point-' + point).onchange = () => {
    resetLoop();
    message('Loop points updated. Start the loop when ready.');
  };
}

$('toggle-loop').onclick = () => {
  if (loop) {
    loop = false;
    $('toggle-loop').textContent = 'Start loop ↺';
    message('Loop paused. Video playback continues.');
    return;
  }
  const a = seconds($('point-a').value), b = seconds($('point-b').value), duration = player.getDuration();
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b - a < .5 || b > duration) {
    return message('Use valid times, with B at least 0.5 seconds after A and within the video.');
  }
  loop = true;
  repeats = 0;
  $('loop-count').textContent = '0 repeats';
  $('toggle-loop').textContent = 'Stop loop ■';
  player.seekTo(a, true);
  player.playVideo();
  message('Looping ' + format(a) + ' → ' + format(b) + '.');
};

setInterval(() => {
  if (!ready) return;
  const t = player.getCurrentTime();
  $('current-time').textContent = format(t);
  if (loop && player.getPlayerState() === 1 && t >= seconds($('point-b').value)) {
    player.seekTo(seconds($('point-a').value), true);
    repeats++;
    $('loop-count').textContent = repeats + ' repeats';
  }
}, 80);

/* --- YouTube to MP3 Backend Logic --- */
let backendToken, converting = false;
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Toolbox-Token': backendToken || '',
      ...options.headers
    }
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'The conversion service returned an error.');
  return data;
}

async function checkBackend() {
  try {
    const health = await api('/api/health');
    backendToken = health.token;
    $('backend-status').textContent = health.ready
      ? '● Local conversion backend ready'
      : 'Setup needed: run Setup backend.cmd. Missing ' + health.missing.join(', ') + '.';
    $('convert').disabled = !health.ready;
    return health.ready;
  } catch {
    $('backend-status').textContent = 'Start the app using Start toolbox.cmd to connect to the local conversion backend.';
    $('convert').disabled = true;
    return false;
  }
}
checkBackend();

$('convert-form').onsubmit = async e => {
  e.preventDefault();
  if (converting) return;
  const id = videoId($('audio-url').value);
  if (!id) {
    $('convert-message').textContent = 'Please paste a valid YouTube video link.';
    return;
  }
  if (!await checkBackend()) return;
  converting = true;
  $('convert').disabled = true;
  $('audio-url').disabled = true;
  $('quality').disabled = true;
  $('mp3-download').hidden = true;
  $('conversion-bar').hidden = false;
  $('conversion-bar').removeAttribute('value');
  $('convert-orb').classList.add('recording');
  $('convert-state').textContent = 'STARTING';
  $('convert-progress').textContent = 'One moment…';
  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=' + id, bitrate: Number($('quality').value) })
    });
    const deadline = Date.now() + 21 * 60 * 1000;
    while (true) {
      if (Date.now() > deadline) throw Error('Conversion timed out. Try a shorter video.');
      const status = await api('/api/jobs/' + job.id);
      $('convert-message').textContent = status.message;
      $('convert-state').textContent = status.state.toUpperCase();
      if (Number.isFinite(status.percent)) {
        $('conversion-bar').value = status.percent;
        $('convert-progress').textContent = status.percent + '%';
      } else {
        $('conversion-bar').removeAttribute('value');
        $('convert-progress').textContent = status.state === 'converting' ? 'Encoding MP3…' : 'Getting audio…';
      }
      if (status.state === 'complete') {
        const link = $('mp3-download');
        link.href = '/api/jobs/' + job.id + '/download';
        link.download = status.filename;
        link.hidden = false;
        $('convert-progress').textContent = 'Ready to listen';
        break;
      }
      if (status.state === 'error') throw Error(status.message);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    $('convert-state').textContent = 'COULD NOT CONVERT';
    $('convert-message').textContent = error.message;
    $('convert-progress').textContent = 'Try another link';
    $('conversion-bar').hidden = true;
  } finally {
    converting = false;
    $('convert').disabled = false;
    $('audio-url').disabled = false;
    $('quality').disabled = false;
    $('convert-orb').classList.remove('recording');
  }
};
window.addEventListener('beforeunload', e => {
  if (converting) { e.preventDefault(); e.returnValue = ''; }
});

/* =========================================================
   --- Local Video A-B Repeater Logic ---
   ========================================================= */
localVideo = $('local-video');
let localFileUrl = null;
let localLoadedFile = null;
let localReady = false;
let localLooping = false;
let localRepeats = 0;
let localPointA = 0;
let localPointB = 5;
let localDelayTimer = null;
let localIsDelaying = false;
let isScrubbing = false;

function formatLocal(t, frac = true) {
  t = Math.max(0, Number(t) || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  if (!frac) return m + ':' + String(s).padStart(2, '0');
  const tenths = Math.floor((t % 1) * 10);
  return m + ':' + String(s).padStart(2, '0') + '.' + tenths;
}

function parseLocal(s) {
  if (typeof s === 'number') return Math.max(0, s);
  const str = String(s || '').trim();
  if (!str) return NaN;
  const parts = str.split(':');
  if (parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((a, p) => a * 60 + Number(p), 0);
}

function localMessage(s) {
  const el = $('local-loop-message');
  if (el) el.textContent = s;
}

function setLocalControls(enabled) {
  const ids = [
    'local-play-btn', 'local-step-back', 'local-step-fwd',
    'local-mute-btn', 'local-fullscreen-btn',
    'local-point-a', 'local-set-a', 'local-nudge-a-down', 'local-nudge-a-up', 'local-jump-a',
    'local-point-b', 'local-set-b', 'local-nudge-b-down', 'local-nudge-b-up', 'local-jump-b',
    'local-speed', 'local-repeat-delay', 'local-toggle-loop', 'local-reset-repeats'
  ];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = !enabled;
  }
}

function updateTimelineLoopRegion() {
  const dur = localVideo?.duration;
  const region = $('timeline-loop-region');
  if (!region) return;
  if (!dur || !Number.isFinite(dur) || dur <= 0) {
    region.hidden = true;
    return;
  }
  region.hidden = false;
  const leftPct = Math.max(0, Math.min(100, (localPointA / dur) * 100));
  const rightPct = Math.max(0, Math.min(100, (localPointB / dur) * 100));
  const widthPct = Math.max(0, rightPct - leftPct);
  region.style.left = leftPct + '%';
  region.style.width = widthPct + '%';
  const span = $('local-loop-span');
  if (span) span.textContent = `Loop: ${formatLocal(localPointA)} → ${formatLocal(localPointB)}`;
}

function updatePlayhead() {
  if (!localReady || isScrubbing || !localVideo) return;
  const dur = localVideo.duration || 0;
  const cur = localVideo.currentTime || 0;
  const curEl = $('local-current-time');
  if (curEl) curEl.textContent = formatLocal(cur);
  if (dur > 0) {
    const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
    const head = $('timeline-playhead');
    if (head) head.style.left = pct + '%';
  }
}

function setPointA(val) {
  if (!localVideo) return;
  const dur = localVideo.duration || 1000;
  let newA = Math.max(0, Math.min(dur - 0.2, Number(val) || 0));
  if (newA >= localPointB - 0.2) {
    localPointB = Math.min(dur, newA + 2);
    $('local-point-b').value = formatLocal(localPointB);
  }
  localPointA = newA;
  $('local-point-a').value = formatLocal(localPointA);
  updateTimelineLoopRegion();
  localMessage(`Point A set to ${formatLocal(localPointA)}.`);
}

function setPointB(val) {
  if (!localVideo) return;
  const dur = localVideo.duration || 1000;
  let newB = Math.min(dur, Math.max(0.2, Number(val) || 0));
  if (newB <= localPointA + 0.2) {
    localPointA = Math.max(0, newB - 2);
    $('local-point-a').value = formatLocal(localPointA);
  }
  localPointB = newB;
  $('local-point-b').value = formatLocal(localPointB);
  updateTimelineLoopRegion();
  localMessage(`Point B set to ${formatLocal(localPointB)}.`);
}

function startLocalLoop() {
  if (!localReady || !localVideo) return;
  if (localPointB <= localPointA) {
    localMessage('Point B must be after Point A.');
    return;
  }
  localLooping = true;
  localIsDelaying = false;
  clearTimeout(localDelayTimer);
  const btn = $('local-toggle-loop');
  if (btn) {
    btn.textContent = 'Stop loop ■';
    btn.classList.add('looping');
  }
  if (localVideo.currentTime < localPointA || localVideo.currentTime >= localPointB) {
    localVideo.currentTime = localPointA;
  }
  localVideo.play().catch(() => {});
  localMessage(`Looping ${formatLocal(localPointA)} → ${formatLocal(localPointB)}.`);
}

function stopLocalLoop(messageText = 'Loop stopped. Video continues playing.') {
  localLooping = false;
  localIsDelaying = false;
  clearTimeout(localDelayTimer);
  const btn = $('local-toggle-loop');
  if (btn) {
    btn.textContent = 'Start loop ↺';
    btn.classList.remove('looping');
  }
  if (messageText) localMessage(messageText);
}

function loadVideoFile(file) {
  if (!file) return;
  const isVideo = (file.type && file.type.startsWith('video/')) ||
                  /\.(mp4|webm|mov|mkv|m4v|avi|ogv|ts|flv|wmv|3gp|m4p|mpg|mpeg)$/i.test(file.name || '');
  if (!isVideo && file.size === 0) {
    localMessage('Please select a valid video file.');
    return;
  }
  stopLocalLoop('');
  if (localFileUrl) URL.revokeObjectURL(localFileUrl);
  localLoadedFile = file;
  localFileUrl = URL.createObjectURL(file);
  localVideo.src = localFileUrl;
  localVideo.load();

  $('drop-content-empty').hidden = true;
  $('drop-content-loaded').hidden = false;
  $('local-file-name').textContent = file.name;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  $('local-file-meta').textContent = `${mb} MB • Loading video…`;
  $('local-video-placeholder').hidden = true;
  localMessage('Loading video metadata…');
  
  if (fileInput) fileInput.value = '';
}

// File Pickers Wiring
const fileInput = $('local-file-input');
function openFilePicker() {
  if (fileInput) fileInput.click();
}

$('btn-browse-file').onclick = e => { e.stopPropagation(); openFilePicker(); };
$('btn-placeholder-browse').onclick = e => { e.stopPropagation(); openFilePicker(); };
$('btn-change-file').onclick = e => { e.stopPropagation(); openFilePicker(); };
$('drop-content-empty').onclick = () => openFilePicker();
$('local-video-placeholder').onclick = () => openFilePicker();

fileInput.onchange = () => {
  if (fileInput.files?.[0]) loadVideoFile(fileInput.files[0]);
};

// Global & Container Drag-and-Drop
const dropzone = $('local-dropzone');
const videoShell = $('local-video-shell');

window.addEventListener('dragover', e => {
  if (location.hash === '#local-repeater') {
    e.preventDefault();
  }
});

let dragCounter = 0;
window.addEventListener('dragenter', e => {
  if (location.hash === '#local-repeater') {
    dragCounter++;
    dropzone?.classList.add('dragover');
  }
});

window.addEventListener('dragleave', e => {
  if (location.hash === '#local-repeater') {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropzone?.classList.remove('dragover');
    }
  }
});

window.addEventListener('drop', e => {
  if (location.hash === '#local-repeater') {
    e.preventDefault();
    dragCounter = 0;
    dropzone?.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      loadVideoFile(files[0]);
    }
  }
});

// Video Element Events
localVideo.onloadedmetadata = () => {
  localReady = true;
  setLocalControls(true);
  const dur = localVideo.duration || 0;
  const mb = localLoadedFile ? (localLoadedFile.size / (1024 * 1024)).toFixed(1) + ' MB' : '';
  const res = localVideo.videoWidth ? `${localVideo.videoWidth}×${localVideo.videoHeight}` : '';
  const metaParts = [res, mb, formatLocal(dur, false)].filter(Boolean);
  $('local-file-meta').textContent = metaParts.join(' • ');

  localPointA = 0;
  localPointB = Math.min(dur, Math.max(0.5, dur > 10 ? 5 : dur));
  $('local-point-a').value = formatLocal(localPointA);
  $('local-point-b').value = formatLocal(localPointB);
  $('local-duration').textContent = formatLocal(dur);
  $('local-current-time').textContent = formatLocal(0);
  localRepeats = 0;
  $('local-loop-count').textContent = '0 repeats';
  updateTimelineLoopRegion();
  updatePlayhead();
  localMessage('Video ready. Set A and B points, then start your loop.');
};

localVideo.onerror = () => {
  localReady = false;
  setLocalControls(false);
  stopLocalLoop('');
  $('local-video-placeholder').hidden = false;
  localMessage('Could not play this video. Your browser may lack the necessary codec.');
};

localVideo.onplay = () => {
  $('local-play-btn').textContent = '⏸ Pause';
};
localVideo.onpause = () => {
  if (!localIsDelaying) $('local-play-btn').textContent = '▶ Play';
};

localVideo.onprogress = () => {
  if (localVideo.buffered.length > 0 && localVideo.duration) {
    const end = localVideo.buffered.end(localVideo.buffered.length - 1);
    $('timeline-buffered').style.width = (end / localVideo.duration * 100) + '%';
  }
};

// Tight Loop Checker (High Frequency for accurate repeat boundaries)
setInterval(() => {
  if (!localReady || !localVideo) return;
  updatePlayhead();
  if (localLooping && !localIsDelaying && !localVideo.paused) {
    if (localVideo.currentTime >= localPointB) {
      localRepeats++;
      $('local-loop-count').textContent = `${localRepeats} repeats`;
      const delay = Number($('local-repeat-delay').value || 0);
      if (delay > 0) {
        localIsDelaying = true;
        localVideo.pause();
        localVideo.currentTime = localPointA;
        localMessage(`Loop finished (${localRepeats} repeats) — pausing ${delay}s…`);
        localDelayTimer = setTimeout(() => {
          localIsDelaying = false;
          if (localLooping) {
            localVideo.currentTime = localPointA;
            localVideo.play().catch(() => {});
            localMessage(`Looping ${formatLocal(localPointA)} → ${formatLocal(localPointB)}.`);
          }
        }, delay * 1000);
      } else {
        localVideo.currentTime = localPointA;
        if (localVideo.paused) localVideo.play().catch(() => {});
      }
    }
  }
}, 30);

// Transport buttons
$('local-play-btn').onclick = () => {
  if (!localReady || !localVideo) return;
  if (localVideo.paused) localVideo.play().catch(() => {});
  else localVideo.pause();
};

$('local-step-back').onclick = () => {
  if (!localReady || !localVideo) return;
  localVideo.pause();
  localVideo.currentTime = Math.max(0, localVideo.currentTime - 0.1);
};
$('local-step-fwd').onclick = () => {
  if (!localReady || !localVideo) return;
  localVideo.pause();
  localVideo.currentTime = Math.min(localVideo.duration || 0, localVideo.currentTime + 0.1);
};

// Click directly on video to play/pause
localVideo.onclick = () => {
  if (!localReady || !localVideo) return;
  if (localVideo.paused) localVideo.play().catch(() => {});
  else localVideo.pause();
};

// Points Setting & Nudging
$('local-set-a').onclick = () => setPointA(localVideo.currentTime);
$('local-set-b').onclick = () => setPointB(localVideo.currentTime);
$('local-nudge-a-down').onclick = () => setPointA(localPointA - 0.1);
$('local-nudge-a-up').onclick = () => setPointA(localPointA + 0.1);
$('local-nudge-b-down').onclick = () => setPointB(localPointB - 0.1);
$('local-nudge-b-up').onclick = () => setPointB(localPointB + 0.1);
$('local-jump-a').onclick = () => {
  if (!localReady || !localVideo) return;
  localVideo.currentTime = localPointA;
};
$('local-jump-b').onclick = () => {
  if (!localReady || !localVideo) return;
  localVideo.currentTime = localPointB;
};

$('local-point-a').onchange = () => {
  const s = parseLocal($('local-point-a').value);
  if (Number.isFinite(s)) setPointA(s);
  else $('local-point-a').value = formatLocal(localPointA);
};
$('local-point-b').onchange = () => {
  const s = parseLocal($('local-point-b').value);
  if (Number.isFinite(s)) setPointB(s);
  else $('local-point-b').value = formatLocal(localPointB);
};

// Loop toggle button
$('local-toggle-loop').onclick = () => {
  if (localLooping) stopLocalLoop();
  else startLocalLoop();
};

// Speed & Delay controls
$('local-speed').onchange = () => {
  if (!localReady || !localVideo) return;
  localVideo.playbackRate = Number($('local-speed').value);
  if ('preservesPitch' in localVideo) localVideo.preservesPitch = true;
};
$('local-reset-repeats').onclick = () => {
  localRepeats = 0;
  $('local-loop-count').textContent = '0 repeats';
};

// Volume & Fullscreen
$('local-volume').oninput = () => {
  if (!localVideo) return;
  localVideo.volume = Number($('local-volume').value);
  localVideo.muted = false;
  $('local-mute-btn').textContent = localVideo.volume === 0 ? '🔇' : '🔊';
};
$('local-mute-btn').onclick = () => {
  if (!localVideo) return;
  localVideo.muted = !localVideo.muted;
  $('local-mute-btn').textContent = localVideo.muted ? '🔇' : '🔊';
};
$('local-fullscreen-btn').onclick = () => {
  const shell = $('local-video-shell');
  if (!shell) return;
  const req = shell.requestFullscreen || shell.webkitRequestFullscreen || shell.msRequestFullscreen;
  if (!document.fullscreenElement) {
    if (req) req.call(shell);
  } else {
    document.exitFullscreen?.();
  }
};

// Timeline Scrubber Click & Drag
const track = $('timeline-track');
const hoverTime = $('timeline-hover-time');

function seekFromEvent(e) {
  if (!localReady || !localVideo || !localVideo.duration) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  localVideo.currentTime = ratio * localVideo.duration;
  $('timeline-playhead').style.left = (ratio * 100) + '%';
  $('local-current-time').textContent = formatLocal(localVideo.currentTime);
}

track.addEventListener('mousedown', e => {
  if (!localReady) return;
  isScrubbing = true;
  seekFromEvent(e);
});

window.addEventListener('mousemove', e => {
  if (isScrubbing) seekFromEvent(e);
});

window.addEventListener('mouseup', () => {
  isScrubbing = false;
});

track.addEventListener('mousemove', e => {
  if (!localReady || !localVideo || !localVideo.duration) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const t = ratio * localVideo.duration;
  hoverTime.hidden = false;
  hoverTime.style.left = (ratio * 100) + '%';
  hoverTime.textContent = formatLocal(t);
});

track.addEventListener('mouseleave', () => {
  hoverTime.hidden = true;
});

// Keyboard Shortcuts
window.addEventListener('keydown', e => {
  if (location.hash !== '#local-repeater' || !localReady || !localVideo) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (localVideo.paused) localVideo.play().catch(() => {});
    else localVideo.pause();
  } else if (e.code === 'KeyL') {
    e.preventDefault();
    if (localLooping) stopLocalLoop();
    else startLocalLoop();
  } else if (e.code === 'KeyA' || e.key === '[') {
    e.preventDefault();
    setPointA(localVideo.currentTime);
  } else if (e.code === 'KeyB' || e.key === ']') {
    e.preventDefault();
    setPointB(localVideo.currentTime);
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    const step = e.shiftKey ? 0.5 : 2;
    localVideo.currentTime = Math.max(0, localVideo.currentTime - step);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    const step = e.shiftKey ? 0.5 : 2;
    localVideo.currentTime = Math.min(localVideo.duration || 0, localVideo.currentTime + step);
  } else if (e.key === ',' || e.key === '<') {
    e.preventDefault();
    localVideo.pause();
    localVideo.currentTime = Math.max(0, localVideo.currentTime - 0.1);
  } else if (e.key === '.' || e.key === '>') {
    e.preventDefault();
    localVideo.pause();
    localVideo.currentTime = Math.min(localVideo.duration || 0, localVideo.currentTime + 0.1);
  } else if (e.code === 'Digit0') {
    e.preventDefault();
    localVideo.currentTime = localPointA;
  } else if (e.code === 'KeyM') {
    e.preventDefault();
    localVideo.muted = !localVideo.muted;
    $('local-mute-btn').textContent = localVideo.muted ? '🔇' : '🔊';
  }
});

// Initialize route now that all components are loaded
route();
