const $ = id => document.getElementById(id);
let player, ready = false, loop = false, repeats = 0;
let localVideo = null;
let looperPlaying = false;

function route() {
  const hash = location.hash.slice(1);
  const sections = Array.from(document.querySelectorAll('main > section'));
  const validPages = sections.map(s => s.id);
  const page = validPages.includes(hash) ? hash : 'home';
  for (const s of sections) {
    s.hidden = s.id !== page;
  }
  if (page !== 'repeater' && ready && player && typeof player.pauseVideo === 'function') {
    player.pauseVideo();
  }
  if (page !== 'local-repeater' && localVideo && !localVideo.paused) {
    localVideo.pause();
  }
  if (page !== 'audio-looper' && typeof stopLooper === 'function' && looperPlaying) {
    stopLooper();
  }
  if (page === 'expense-splitter' && typeof renderExpenseSplitter === 'function') renderExpenseSplitter();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* --- YouTube A-B Repeater Logic --- */
function videoId(value) {
  try {
    let raw = (value || '').trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) {
      raw = 'https://' + raw;
    }
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') {
      id = u.pathname.split('/')[1];
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.music.youtube.com', 'm.music.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
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
  const inputVal = ($('audio-url').value || '').trim();
  const id = videoId(inputVal);
  if (!id) {
    if (inputVal.includes('list=') || inputVal.includes('/playlist')) {
      $('convert-message').textContent = 'Playlists are not supported. Please paste a direct track or video link.';
    } else {
      $('convert-message').textContent = 'Please paste a valid YouTube or YouTube Music link.';
    }
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
  if (['#local-repeater', '#ig-checker', '#audio-looper', '#metadata-editor', '#expense-splitter'].includes(location.hash)) {
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

// Route initialization moved to end of file after all modules load

/* =========================================================
   --- Instagram Follow-Back Checker Logic ---
   ========================================================= */
let igFollowersMap = null;
let igFollowingMap = null;
let igAccountsCache = {};
let igIgnoredSet = new Set();
let igPreviousNotFollowingBack = [];
let igReviewedNewSet = new Set();
let igCurrentTab = 'not-following-back';
let igHideInactive = true;
let trickleRunning = false;
let trickleAbort = false;
let igDataLoadedFromDisk = false;

let igFilteredLists = {
  'not-following-back': [],
  'fans': [],
  'mutuals': [],
  'inactive': [],
  'ignored': [],
  'all-following': [],
  'all-followers': []
};

function showSaveStatus(text) {
  const el = $('ig-save-status-text');
  if (el) el.textContent = text;
}

async function persistInstagramData(updates) {
  try {
    await api('/api/ig/data', {
      method: 'POST',
      body: JSON.stringify(updates)
    });
    showSaveStatus('Saved to instagram_cache.json ✓');
  } catch (err) {
    console.error('Failed to save Instagram cache:', err);
    showSaveStatus('Error saving to repository');
  }
}

async function loadInstagramDataFromDisk() {
  try {
    showSaveStatus('Loading from repository…');
    const data = await api('/api/ig/data');
    if (data && typeof data === 'object') {
      igAccountsCache = data.accounts || {};
      igIgnoredSet = new Set(Array.isArray(data.ignored) ? data.ignored : []);
      igPreviousNotFollowingBack = Array.isArray(data.previousNotFollowingBack) ? data.previousNotFollowingBack : [];
      igReviewedNewSet = new Set(Array.isArray(data.reviewedNew) ? data.reviewedNew : []);
      if (Array.isArray(data.followers) && data.followers.length &&
          Array.isArray(data.following) && data.following.length) {
        igFollowersMap = new Map(data.followers.map(f => [f.username, f]));
        igFollowingMap = new Map(data.following.map(f => [f.username, f]));

        $('slot-followers-name').textContent = 'Saved in repo (' + igFollowersMap.size + ' followers)';
        $('slot-followers-badge').textContent = 'Repo ✓';
        $('slot-followers-badge').classList.add('ready');

        $('slot-following-name').textContent = 'Saved in repo (' + igFollowingMap.size + ' following)';
        $('slot-following-badge').textContent = 'Repo ✓';
        $('slot-following-badge').classList.add('ready');

        igDataLoadedFromDisk = true;
        computeInstagramComparison();
        const dateStr = data.lastUpdated ? new Date(data.lastUpdated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        showSaveStatus('Loaded from instagram_cache.json ' + (dateStr ? '(' + dateStr + ') ' : '') + '✓');
      } else {
        showSaveStatus('Ready (drop files to save into instagram_cache.json)');
      }
    }
  } catch (err) {
    console.warn('Could not load Instagram cache from disk:', err);
    showSaveStatus('Ready for files');
  }
}

function updateAccountStatus(username, status) {
  username = username.toLowerCase();
  igAccountsCache[username] = { status, timestamp: Date.now() };
  persistInstagramData({
    accounts: {
      [username]: { status, timestamp: Date.now() }
    }
  });
}

function isPlaceholderUser(u) {
  return u === 'instagram_user' || u === 'facebook_user' || /^\d+$/.test(u) || !u;
}

function extractInstagramAccounts(jsonObj) {
  const accounts = new Map();
  function addEntry(username, href, timestamp) {
    if (!username && href) {
      const match = /instagram\.com\/(?:_u\/)?([a-zA-Z0-9._]+)/.exec(href);
      if (match) username = match[1];
    }
    if (!username) return;
    username = String(username).trim().toLowerCase().replace(/^@/, '');
    if (!username || username === 'unknown') return;
    if (!accounts.has(username)) {
      accounts.set(username, {
        username: username,
        url: href || 'https://www.instagram.com/' + username + '/',
        timestamp: timestamp ? Number(timestamp) : null
      });
    }
  }
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string') {
          addEntry(item, null, null);
        } else if (item && typeof item === 'object') {
          if (Array.isArray(item.string_list_data)) {
            for (const s of item.string_list_data) {
              addEntry(s.value || item.title, s.href, s.timestamp);
            }
          } else {
            addEntry(item.value || item.title || item.username, item.href, item.timestamp);
          }
        }
      }
    } else if (typeof node === 'object') {
      if (Array.isArray(node.relationships_following)) {
        walk(node.relationships_following);
      } else if (Array.isArray(node.relationships_followers)) {
        walk(node.relationships_followers);
      } else {
        for (const key of Object.keys(node)) {
          if (Array.isArray(node[key])) walk(node[key]);
        }
      }
    }
  }
  walk(jsonObj);
  return accounts;
}

function processInstagramJson(file, text) {
  try {
    const data = JSON.parse(text);
    const accounts = extractInstagramAccounts(data);
    const fname = file.name.toLowerCase();

    const isFollowing = fname.includes('following') || (data && !!data.relationships_following);
    const isFollowers = fname.includes('follower') || (data && !!data.relationships_followers);

    if (isFollowing) {
      igFollowingMap = accounts;
      $('slot-following-name').textContent = file.name + ' (' + accounts.size + ' following)';
      $('slot-following-badge').textContent = 'Ready ✓';
      $('slot-following-badge').classList.add('ready');
    } else if (isFollowers) {
      igFollowersMap = accounts;
      $('slot-followers-name').textContent = file.name + ' (' + accounts.size + ' followers)';
      $('slot-followers-badge').textContent = 'Ready ✓';
      $('slot-followers-badge').classList.add('ready');
    } else {
      if (!igFollowersMap) {
        igFollowersMap = accounts;
        $('slot-followers-name').textContent = file.name + ' (' + accounts.size + ' accounts)';
        $('slot-followers-badge').textContent = 'Ready ✓';
        $('slot-followers-badge').classList.add('ready');
      } else {
        igFollowingMap = accounts;
        $('slot-following-name').textContent = file.name + ' (' + accounts.size + ' accounts)';
        $('slot-following-badge').textContent = 'Ready ✓';
        $('slot-following-badge').classList.add('ready');
      }
    }

    if (igFollowersMap && igFollowingMap) {
      const currentNfb = Array.from(igFollowingMap.keys()).filter(u => !igFollowersMap.has(u));
      computeInstagramComparison();
      persistInstagramData({
        followers: Array.from(igFollowersMap.values()),
        following: Array.from(igFollowingMap.values()),
        previousNotFollowingBack: currentNfb,
        lastUpdated: new Date().toISOString()
      });
    }
  } catch (err) {
    alert('Could not parse ' + file.name + ': ' + err.message);
  }
}

function computeInstagramComparison() {
  const rawNotFollowingBack = [];
  const fans = [];
  const mutuals = [];
  const inactive = [];
  const ignored = [];
  const allFollowing = Array.from(igFollowingMap.values());
  const allFollowers = Array.from(igFollowersMap.values());

  let newAccountsCount = 0;

  for (const [u, d] of igFollowingMap) {
    if (!igFollowersMap.has(u)) {
      if (igIgnoredSet.has(u)) {
        ignored.push(d);
      } else if (isPlaceholderUser(u) || igAccountsCache[u]?.status === 'inactive') {
        inactive.push(d);
      } else {
        const isNew = igPreviousNotFollowingBack.length > 0 &&
                      !igPreviousNotFollowingBack.includes(u) &&
                      !igReviewedNewSet.has(u);
        d.isNew = isNew;
        if (isNew) newAccountsCount++;
        rawNotFollowingBack.push(d);
      }
    } else {
      mutuals.push(d);
    }
  }

  // Update New Accounts Banner
  const banner = $('ig-new-banner');
  const countEl = $('ig-new-count');
  if (banner && countEl) {
    if (newAccountsCount > 0) {
      countEl.textContent = newAccountsCount;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  for (const [u, d] of igFollowersMap) {
    if (!igFollowingMap.has(u)) {
      fans.push(d);
    }
  }

  const sortAlpha = (a, b) => a.username.localeCompare(b.username);
  rawNotFollowingBack.sort(sortAlpha);
  fans.sort(sortAlpha);
  mutuals.sort(sortAlpha);
  inactive.sort(sortAlpha);
  allFollowing.sort(sortAlpha);
  allFollowers.sort(sortAlpha);

  ignored.sort(sortAlpha);
  igFilteredLists['not-following-back'] = rawNotFollowingBack;
  igFilteredLists['fans'] = fans;
  igFilteredLists['mutuals'] = mutuals;
  igFilteredLists['inactive'] = inactive;
  igFilteredLists['ignored'] = ignored;
  igFilteredLists['all-following'] = allFollowing;
  igFilteredLists['all-followers'] = allFollowers;

  $('stat-following').textContent = allFollowing.length.toLocaleString();
  $('stat-followers').textContent = allFollowers.length.toLocaleString();
  $('stat-not-following-back').textContent = rawNotFollowingBack.length.toLocaleString();
  $('stat-fans').textContent = fans.length.toLocaleString();
  $('stat-mutuals').textContent = mutuals.length.toLocaleString();

  $('tab-cnt-nfb').textContent = rawNotFollowingBack.length;
  $('tab-cnt-fans').textContent = fans.length;
  $('tab-cnt-mutuals').textContent = mutuals.length;
  $('tab-cnt-inactive').textContent = inactive.length;
  if ($('tab-cnt-ignored')) $('tab-cnt-ignored').textContent = ignored.length;
  $('tab-cnt-following').textContent = allFollowing.length;
  $('tab-cnt-followers').textContent = allFollowers.length;

  $('ig-results').hidden = false;
  renderInstagramList();
}

function renderInstagramList() {
  const container = $('ig-list-container');
  container.innerHTML = '';
  const query = ($('ig-search').value || '').trim().toLowerCase();

  let list = igFilteredLists[igCurrentTab] || [];
  if (query) {
    list = list.filter(item => item.username.toLowerCase().includes(query));
  }

  $('ig-list-count').textContent = 'Showing ' + list.length + ' accounts';

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'ig-empty-state';
    empty.textContent = query ? 'No usernames match "' + query + '".' : 'No accounts in this list.';
    container.appendChild(empty);
    return;
  }

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'ig-user-row' + (item.isNew ? ' ig-row-new' : '');

    const info = document.createElement('div');
    info.className = 'ig-user-info';

    const avatar = document.createElement('div');
    avatar.className = 'ig-user-avatar';
    avatar.textContent = item.username.charAt(0);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ig-user-name';
    nameSpan.textContent = '@' + item.username;

    info.appendChild(avatar);
    info.appendChild(nameSpan);

    if (item.isNew) {
      const newPill = document.createElement('span');
      newPill.className = 'ig-status-pill pill-new';
      newPill.textContent = '✦ NEW';
      info.appendChild(newPill);
    }

    if (igCurrentTab === 'ignored') {
      const ignPill = document.createElement('span');
      ignPill.className = 'ig-status-pill pill-ignored';
      ignPill.textContent = 'Ignored';
      info.appendChild(ignPill);
    } else {
      const userStatus = igAccountsCache[item.username]?.status;
      const pill = document.createElement('span');
      pill.className = 'ig-status-pill ' + (userStatus === 'active' ? 'pill-active' : (userStatus === 'inactive' ? 'pill-inactive' : 'pill-unverified'));
      pill.textContent = userStatus === 'active' ? 'Active' : (userStatus === 'inactive' ? 'Inactive' : 'Unchecked');
      info.appendChild(pill);
    }

    if (item.timestamp) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'ig-user-date';
      const d = new Date(item.timestamp * 1000);
      dateSpan.textContent = 'Followed ' + d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      info.appendChild(dateSpan);
    }

    const actions = document.createElement('div');
    actions.className = 'ig-user-actions';

    if (igCurrentTab === 'ignored') {
      const unignoreBtn = document.createElement('button');
      unignoreBtn.type = 'button';
      unignoreBtn.className = 'ig-action-sm-btn restore-btn';
      unignoreBtn.textContent = '↩ Unignore';
      unignoreBtn.title = 'Remove from ignore list and return to active view';
      unignoreBtn.onclick = () => {
        igIgnoredSet.delete(item.username);
        persistInstagramData({ ignored: Array.from(igIgnoredSet) });
        computeInstagramComparison();
      };
      actions.appendChild(unignoreBtn);
    } else if (igCurrentTab === 'inactive') {
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'ig-action-sm-btn restore-btn';
      restoreBtn.textContent = 'Restore ↺';
      restoreBtn.onclick = () => {
        updateAccountStatus(item.username, 'active');
        computeInstagramComparison();
      };
      actions.appendChild(restoreBtn);
    } else {
      // Add Ignore Button on Not Following Back rows
      if (igCurrentTab === 'not-following-back') {
        const ignoreBtn = document.createElement('button');
        ignoreBtn.type = 'button';
        ignoreBtn.className = 'ig-action-sm-btn ignore-btn';
        ignoreBtn.textContent = '🚫 Ignore';
        ignoreBtn.title = 'Add this account to your ignore list';
        ignoreBtn.onclick = () => {
          igIgnoredSet.add(item.username);
          persistInstagramData({ ignored: Array.from(igIgnoredSet) });
          computeInstagramComparison();
        };
        actions.appendChild(ignoreBtn);
      }
      const verifyBtn = document.createElement('button');
      verifyBtn.type = 'button';
      verifyBtn.className = 'ig-action-sm-btn';
      verifyBtn.textContent = 'Verify';
      verifyBtn.title = 'Check if this account still exists on Instagram';
      verifyBtn.onclick = async () => {
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Checking…';
        pill.className = 'ig-status-pill pill-checking';
        pill.textContent = 'Checking…';
        try {
          const res = await api('/api/ig/verify?username=' + encodeURIComponent(item.username));
          if (res.rate_limited) {
            alert('Instagram rate limit encountered. Please wait a bit before checking again.');
            return;
          }
          const st = res.exists ? 'active' : 'inactive';
          updateAccountStatus(item.username, st);
          computeInstagramComparison();
        } catch (e) {
          alert('Could not verify @' + item.username + ': ' + e.message);
          computeInstagramComparison();
        }
      };
      actions.appendChild(verifyBtn);

      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'ig-action-sm-btn dismiss-btn';
      dismissBtn.textContent = '✕ Dismiss';
      dismissBtn.title = 'Mark as inactive and hide from this list';
      dismissBtn.onclick = () => {
        updateAccountStatus(item.username, 'inactive');
        computeInstagramComparison();
      };
      actions.appendChild(dismissBtn);
    }

    const link = document.createElement('a');
    link.className = 'ig-action-sm-btn';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Instagram ↗';

    actions.appendChild(link);
    row.appendChild(info);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

async function toggleTrickleCheck() {
  const btn = $('ig-trickle-toggle-btn');
  const dot = $('ig-pulse-dot');
  const statusText = $('ig-trickle-status-text');
  const progressWrap = $('ig-progress-wrap');
  const progressFill = $('ig-progress-fill');

  if (trickleRunning) {
    trickleAbort = true;
    trickleRunning = false;
    btn.textContent = '▶ Resume Trickle Check';
    btn.classList.remove('running');
    dot.classList.remove('running');
    statusText.textContent = 'Trickle check paused.';
    return;
  }

  const queue = (igFilteredLists['not-following-back'] || []).filter(u => {
    return !igAccountsCache[u.username] || (igAccountsCache[u.username].status !== 'active' && igAccountsCache[u.username].status !== 'inactive');
  });

  if (!queue.length) {
    statusText.textContent = 'All accounts in this list have already been checked!';
    return;
  }

  trickleRunning = true;
  trickleAbort = false;
  btn.textContent = '⏸ Pause Check';
  btn.classList.add('running');
  dot.classList.add('running');
  progressWrap.hidden = false;

  let inactiveFound = 0;
  const total = queue.length;

  for (let i = 0; i < queue.length; i++) {
    if (trickleAbort) break;
    const user = queue[i];
    const pct = Math.round(((i + 1) / total) * 100);
    progressFill.style.width = pct + '%';
    statusText.textContent = 'Checking ' + (i + 1) + ' / ' + total + ' (@' + user.username + ') • ' + inactiveFound + ' inactive accounts found so far…';

    try {
      const res = await api('/api/ig/verify?username=' + encodeURIComponent(user.username));
      if (res.rate_limited) {
        statusText.textContent = 'Instagram rate limit encountered. Pausing trickle check automatically.';
        break;
      }
      const st = res.exists ? 'active' : 'inactive';
      if (!res.exists) inactiveFound++;
      updateAccountStatus(user.username, st);
      computeInstagramComparison();
    } catch (e) {
      console.warn('Error checking @' + user.username, e);
    }

    await new Promise(r => setTimeout(r, 2600));
  }

  trickleRunning = false;
  btn.textContent = '▶ Start Trickle Check';
  btn.classList.remove('running');
  dot.classList.remove('running');
  if (!trickleAbort) {
    statusText.textContent = 'Trickle check completed! Found ' + inactiveFound + ' inactive/deleted accounts.';
    setTimeout(() => { progressWrap.hidden = true; }, 3000);
  }
}

// Event Listeners for Instagram Follow Checker
const igDropzone = $('ig-combined-dropzone');
const igFileInput = $('ig-file-input');

if (igDropzone && igFileInput) {
  ['dragenter', 'dragover'].forEach(name => {
    igDropzone.addEventListener(name, e => {
      e.preventDefault();
      igDropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(name => {
    igDropzone.addEventListener(name, e => {
      e.preventDefault();
      igDropzone.classList.remove('dragover');
    });
  });

  // Make entire dropzone clickable
  igDropzone.onclick = e => {
    if (e.target.tagName !== 'INPUT') {
      igFileInput.click();
    }
  };

  igDropzone.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    igDropzone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    let foundJson = false;
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.json')) {
        foundJson = true;
        f.text().then(txt => processInstagramJson(f, txt));
      } else if (lower.endsWith('.zip')) {
        alert('You dropped a ZIP file (' + f.name + '). Please extract the ZIP file first on your computer and drop the "followers_1.json" and "following.json" files.');
      }
    }
    if (!foundJson && files.length && !files[0].name.toLowerCase().endsWith('.zip')) {
      alert('Please select or drop JSON files (e.g. followers_1.json and following.json).');
    }
  });

  igFileInput.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.json')) {
        f.text().then(txt => processInstagramJson(f, txt));
      }
    }
    igFileInput.value = '';
  });

  $('slot-followers').onclick = () => igFileInput.click();
  $('slot-following').onclick = () => igFileInput.click();

  // Tab switching
  document.querySelectorAll('.ig-tab').forEach(tabBtn => {
    tabBtn.onclick = () => {
      document.querySelectorAll('.ig-tab').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      igCurrentTab = tabBtn.dataset.tab;
      renderInstagramList();
    };
  });

  // Hide inactive toggle
  $('ig-hide-inactive-toggle').onchange = (e) => {
    igHideInactive = e.target.checked;
    computeInstagramComparison();
  };

  // Trickle check button
  $('ig-trickle-toggle-btn').onclick = toggleTrickleCheck;

  // Search input
  $('ig-search').oninput = () => renderInstagramList();

  // Copy list button
  $('ig-copy-btn').onclick = async () => {
    const query = ($('ig-search').value || '').trim().toLowerCase();
    const list = (igFilteredLists[igCurrentTab] || []).filter(item => {
      return !query || item.username.toLowerCase().includes(query);
    });
    const usernames = list.map(item => '@' + item.username).join('\n');
    try {
      await navigator.clipboard.writeText(usernames);
      const hint = $('ig-copy-feedback');
      hint.hidden = false;
      setTimeout(() => hint.hidden = true, 2500);
    } catch {
      prompt('Copy usernames below:', usernames);
    }
  };

  // Export CSV button
  $('ig-csv-btn').onclick = () => {
    const list = igFilteredLists[igCurrentTab] || [];
    let csv = 'username,url,status,followed_date\n';
    for (const item of list) {
      const date = item.timestamp ? new Date(item.timestamp * 1000).toISOString() : '';
      const st = igAccountsCache[item.username]?.status || 'unverified';
      csv += item.username + ',' + item.url + ',' + st + ',' + date + '\n';
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'instagram-' + igCurrentTab + '.csv';
    a.click();
    URL.revokeObjectURL(u);
  };

  // Reload from repo button
  $('ig-reload-repo-btn').onclick = () => {
    loadInstagramDataFromDisk();
  };

  // Mark all as reviewed button
  $('ig-mark-reviewed-btn').onclick = () => {
    const list = igFilteredLists['not-following-back'] || [];
    for (const item of list) {
      if (item.isNew) {
        igReviewedNewSet.add(item.username);
        item.isNew = false;
      }
    }
    persistInstagramData({ reviewedNew: Array.from(igReviewedNewSet) });
    const banner = $('ig-new-banner');
    if (banner) banner.hidden = true;
    renderInstagramList();
  };

  // Manual Add to Ignore List
  const manualIgnoreInput = $('ig-manual-ignore-input');
  const manualIgnoreBtn = $('ig-manual-ignore-btn');
  const handleManualIgnore = () => {
    const val = (manualIgnoreInput.value || '').trim().toLowerCase().replace(/^@/, '');
    if (!val) return;
    igIgnoredSet.add(val);
    manualIgnoreInput.value = '';
    persistInstagramData({ ignored: Array.from(igIgnoredSet) });
    computeInstagramComparison();
  };
  if (manualIgnoreBtn) manualIgnoreBtn.onclick = handleManualIgnore;
  if (manualIgnoreInput) {
    manualIgnoreInput.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleManualIgnore();
      }
    };
  }

  // Reset button
  $('ig-reset-btn').onclick = async () => {
    if (trickleRunning) toggleTrickleCheck();
    if (!confirm('Clear Instagram data from repository file (instagram_cache.json)?')) return;
    igFollowersMap = null;
    igFollowingMap = null;
    igAccountsCache = {};
    igIgnoredSet.clear();
    igPreviousNotFollowingBack = [];
    igReviewedNewSet.clear();
    $('slot-followers-name').textContent = 'Waiting for followers_1.json…';
    $('slot-followers-badge').textContent = 'Missing';
    $('slot-followers-badge').classList.remove('ready');
    $('slot-following-name').textContent = 'Waiting for following.json…';
    $('slot-following-badge').textContent = 'Missing';
    $('slot-following-badge').classList.remove('ready');
    $('ig-results').hidden = true;
    $('ig-search').value = '';
    await persistInstagramData({ accounts: {}, followers: [], following: [], ignored: [], previousNotFollowingBack: [], reviewedNew: [], lastUpdated: null });
    showSaveStatus('Repository data cleared');
  };
}

// Automatically load repository data once backend connects
const origCheckBackend = checkBackend;
checkBackend = async function() {
  const ready = await origCheckBackend();
  if (ready) {
    loadInstagramDataFromDisk();
  }
  return ready;
};
// Trigger load immediately if backend token already exists, or run checkBackend
if (backendToken) {
  loadInstagramDataFromDisk();
} else {
  checkBackend();
}


/* =========================================================
   --- MP3 Cutter & Seamless Audio Looper Studio Logic ---
   ========================================================= */

let looperCtx = null;
let looperBuffer = null;
let looperSource = null;
let looperGainNode = null;
let looperIsLooping = false;
let looperStartTime = 0;
let looperStartOffset = 0;
let looperCurrentPos = 0;
let looperPointA = 0;
let looperPointB = 8;
let looperRepeats = 0;
let looperBpm = 120;
let looperBars = 4;
let looperVolume = 1;
let looperMuted = false;
let looperZoom = 1;
let looperViewStart = 0;
let looperViewEnd = 0;
let looperLoadedFile = null;
let looperPeaks = null;
let looperDragMode = null; // 'drag-a', 'drag-b', 'drag-region', 'scrub'
let looperDragStartX = 0;
let looperDragStartA = 0;
let looperDragStartB = 0;
let looperRafId = null;

function getAudioContext() {
  if (!looperCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    looperCtx = new AudioCtx();
    looperGainNode = looperCtx.createGain();
    looperGainNode.connect(looperCtx.destination);
  }
  if (looperCtx.state === 'suspended') {
    looperCtx.resume().catch(() => {});
  }
  return looperCtx;
}

function formatLooperTime(sec, showMs = true) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  if (!showMs) {
    return m + ':' + String(s).padStart(2, '0');
  }
  return m + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}

function parseLooperTime(str) {
  if (!str) return NaN;
  const parts = str.trim().split(':');
  if (parts.length === 1) return Number(parts[0]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return NaN;
}

function setLooperStatus(msg) {
  const el = $('looper-message');
  if (el) el.textContent = msg;
}

function setLooperControls(enabled) {
  const ids = [
    'looper-play-btn', 'looper-step-back', 'looper-step-fwd', 'looper-mute-btn',
    'looper-toggle-loop', 'looper-auto-detect-btn', 'looper-set-a', 'looper-set-b',
    'looper-nudge-a-down-fine', 'looper-nudge-a-up-fine', 'looper-jump-a',
    'looper-nudge-b-down-fine', 'looper-nudge-b-up-fine', 'looper-jump-b',
    'looper-point-a', 'looper-point-b', 'looper-zoom-in', 'looper-zoom-out',
    'looper-zoom-fit', 'looper-snap-loop-view', 'looper-snap-zero', 'looper-crossfade',
    'btn-export-cut', 'btn-export-extended', 'looper-reset-repeats'
  ];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = !enabled;
  }
  document.querySelectorAll('.bar-btn').forEach(btn => btn.disabled = !enabled);
}

// Peak Precomputation for ultra-fast canvas drawing
function computeLooperPeaks(buffer, totalBuckets = 2400) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / totalBuckets));
  const peaks = new Float32Array(totalBuckets * 2); // [min0, max0, min1, max1, ...]

  for (let i = 0; i < totalBuckets; i++) {
    const start = i * step;
    const end = Math.min(start + step, data.length);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = data[j];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  return { peaks, totalBuckets };
}

// BPM Detection Algorithm
function detectAudioBpm(audioBuffer) {
  try {
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const targetRate = 2000;
    const step = Math.max(1, Math.floor(sampleRate / targetRate));
    const downsampledLength = Math.floor(data.length / step);
    const downsampled = new Float32Array(downsampledLength);
    for (let i = 0; i < downsampledLength; i++) {
      downsampled[i] = data[i * step];
    }

    const windowSize = Math.floor(targetRate * 0.03); // 30ms window
    const envelope = new Float32Array(downsampledLength);
    let sum = 0;
    for (let i = 0; i < downsampledLength; i++) {
      sum += Math.abs(downsampled[i]);
      if (i >= windowSize) sum -= Math.abs(downsampled[i - windowSize]);
      envelope[i] = sum / windowSize;
    }

    const onsets = new Float32Array(downsampledLength);
    for (let i = 1; i < downsampledLength; i++) {
      const diff = envelope[i] - envelope[i - 1];
      if (diff > 0) onsets[i] = diff;
    }

    const minLag = Math.floor(targetRate * (60 / 180)); // 180 BPM
    const maxLag = Math.floor(targetRate * (60 / 65));  // 65 BPM
    let bestLag = minLag;
    let maxCorr = -1;
    const testLen = Math.min(downsampledLength - maxLag, targetRate * 50);

    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let corr = 0;
      for (let i = 0; i < testLen; i += 4) {
        corr += onsets[i] * onsets[i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }
    const bpm = Math.round(60 / (bestLag / targetRate));
    return Math.max(65, Math.min(185, bpm));
  } catch {
    return 120;
  }
}

// Zero-Crossing Search Helper
function findNearestZeroCrossing(timeSec, searchRadiusSec = 0.035) {
  if (!looperBuffer) return timeSec;
  const data = looperBuffer.getChannelData(0);
  const sr = looperBuffer.sampleRate;
  const centerSample = Math.max(1, Math.min(data.length - 2, Math.round(timeSec * sr)));
  const radiusSamples = Math.round(searchRadiusSec * sr);
  const minSample = Math.max(1, centerSample - radiusSamples);
  const maxSample = Math.min(data.length - 2, centerSample + radiusSamples);

  let bestSample = centerSample;
  let minAmp = Math.abs(data[centerSample]);

  for (let i = minSample; i <= maxSample; i++) {
    // Prefer positive-slope zero crossings
    if (data[i] <= 0 && data[i + 1] >= 0) {
      const dist = Math.abs(i - centerSample) / radiusSamples;
      const score = Math.abs(data[i]) + dist * 0.02;
      if (score < minAmp) {
        minAmp = score;
        bestSample = i;
      }
    }
  }
  return bestSample / sr;
}

// 🪄 Auto-Detect Point B for Seamless Loop
function autoDetectLooperPointB() {
  if (!looperBuffer) return;
  const sr = looperBuffer.sampleRate;
  const data = looperBuffer.getChannelData(0);
  const dur = looperBuffer.duration;

  const barSec = (60 / looperBpm) * 4;
  const expectedLoopLen = looperBars * barSec;
  let targetB = looperPointA + expectedLoopLen;
  if (targetB > dur - 0.05) {
    targetB = Math.max(looperPointA + 0.5, dur - 0.05);
  }

  // Ref slice around Point A
  const sampleA = Math.round(looperPointA * sr);
  const refLen = Math.min(1024, data.length - sampleA - 1);
  const refSlice = data.subarray(sampleA, sampleA + refLen);

  // Search window around target B (+/- 0.15s)
  const targetSample = Math.round(targetB * sr);
  const searchRadius = Math.round(0.18 * sr);
  const startSearch = Math.max(sampleA + 500, targetSample - searchRadius);
  const endSearch = Math.min(data.length - refLen - 1, targetSample + searchRadius);

  let bestSample = targetSample;
  let bestScore = -Infinity;

  for (let s = startSearch; s <= endSearch; s++) {
    // Zero-crossing condition
    if ($('looper-snap-zero')?.checked) {
      if (!(data[s] <= 0 && data[s + 1] >= 0)) continue;
    }

    // Normalized cross-correlation
    let dot = 0;
    let norm = 0;
    for (let k = 0; k < refLen; k += 4) {
      const v = data[s + k];
      dot += refSlice[k] * v;
      norm += v * v;
    }
    const score = norm > 0 ? (dot / Math.sqrt(norm)) : -1;
    // Slight penalty for distance from exact bar beat
    const beatDistPenalty = (Math.abs(s - targetSample) / searchRadius) * 0.15;
    const finalScore = score - beatDistPenalty;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestSample = s;
    }
  }

  const detectedB = bestSample / sr;
  setLooperPointB(detectedB);
  const actualLen = (detectedB - looperPointA).toFixed(3);
  setLooperStatus(`🪄 Auto-detected seamless ${looperBars}-bar loop ending at ${formatLooperTime(detectedB)} (${actualLen}s).`);
}

function setLooperPointA(val) {
  if (!looperBuffer) return;
  const dur = looperBuffer.duration;
  let newA = Math.max(0, Math.min(dur - 0.05, Number(val) || 0));
  if ($('looper-snap-zero')?.checked) {
    newA = findNearestZeroCrossing(newA);
  }
  if (newA >= looperPointB - 0.05) {
    looperPointB = Math.min(dur, newA + 2);
    $('looper-point-b').value = formatLooperTime(looperPointB);
  }
  looperPointA = newA;
  $('looper-point-a').value = formatLooperTime(looperPointA);
  updateLooperLoopReadout();
  drawLooperWaveform();
  if (looperIsLooping && looperPlaying) {
    restartLooperNode();
  }
}

function setLooperPointB(val) {
  if (!looperBuffer) return;
  const dur = looperBuffer.duration;
  let newB = Math.min(dur, Math.max(0.05, Number(val) || 0));
  if ($('looper-snap-zero')?.checked) {
    newB = findNearestZeroCrossing(newB);
  }
  if (newB <= looperPointA + 0.05) {
    looperPointA = Math.max(0, newB - 2);
    $('looper-point-a').value = formatLooperTime(looperPointA);
  }
  looperPointB = newB;
  $('looper-point-b').value = formatLooperTime(looperPointB);
  updateLooperLoopReadout();
  drawLooperWaveform();
  if (looperIsLooping && looperPlaying) {
    restartLooperNode();
  }
}

function updateLooperLoopReadout() {
  const span = $('looper-loop-span');
  if (span) {
    const len = Math.max(0, looperPointB - looperPointA).toFixed(3);
    span.textContent = `Loop: ${formatLooperTime(looperPointA)} → ${formatLooperTime(looperPointB)} (${len}s)`;
  }
}

// Playback Engine
function startLooperPlayback(loop = false) {
  if (!looperBuffer) return;
  const ctx = getAudioContext();
  stopLooper(false);

  looperIsLooping = loop;
  looperSource = ctx.createBufferSource();
  looperSource.buffer = looperBuffer;
  looperSource.connect(looperGainNode);

  if (loop) {
    looperSource.loop = true;
    looperSource.loopStart = looperPointA;
    looperSource.loopEnd = looperPointB;
    if (looperCurrentPos < looperPointA || looperCurrentPos >= looperPointB) {
      looperCurrentPos = looperPointA;
    }
  } else {
    looperSource.loop = false;
    looperSource.onended = () => {
      if (looperPlaying && !looperIsLooping) {
        stopLooper(true);
      }
    };
  }

  looperStartTime = ctx.currentTime;
  looperStartOffset = looperCurrentPos;
  looperSource.start(0, looperStartOffset);
  looperPlaying = true;

  $('looper-play-btn').textContent = '⏸ Pause';
  if (loop) {
    $('looper-toggle-loop').textContent = 'Stop Loop ■';
    $('looper-toggle-loop').classList.add('looping');
    setLooperStatus(`Looping ${formatLooperTime(looperPointA)} → ${formatLooperTime(looperPointB)} seamlessly.`);
  } else {
    setLooperStatus('Playing audio…');
  }

  startLooperAnimation();
}

function stopLooper(resetPos = false) {
  if (looperSource) {
    try {
      looperSource.onended = null;
      looperSource.stop();
      looperSource.disconnect();
    } catch {}
    looperSource = null;
  }
  looperPlaying = false;
  looperIsLooping = false;
  $('looper-play-btn').textContent = '▶ Play';
  $('looper-toggle-loop').textContent = 'Start Loop ↺';
  $('looper-toggle-loop').classList.remove('looping');
  cancelAnimationFrame(looperRafId);

  if (resetPos) {
    looperCurrentPos = looperPointA;
  }
  drawLooperWaveform();
}

function restartLooperNode() {
  if (!looperPlaying || !looperIsLooping) return;
  startLooperPlayback(true);
}

function startLooperAnimation() {
  cancelAnimationFrame(looperRafId);
  function tick() {
    if (!looperPlaying || !looperBuffer) return;
    const ctx = getAudioContext();
    const elapsed = ctx.currentTime - looperStartTime;

    if (looperIsLooping) {
      const loopLen = looperPointB - looperPointA;
      if (loopLen > 0) {
        const totalPos = (looperStartOffset - looperPointA) + elapsed;
        const currentReps = Math.floor(totalPos / loopLen);
        if (currentReps !== looperRepeats && currentReps >= 0) {
          looperRepeats = currentReps;
          $('looper-loop-count').textContent = `${looperRepeats} repeats`;
        }
        looperCurrentPos = looperPointA + (totalPos % loopLen);
      }
    } else {
      looperCurrentPos = Math.min(looperBuffer.duration, looperStartOffset + elapsed);
      if (looperCurrentPos >= looperBuffer.duration) {
        stopLooper(true);
        return;
      }
    }

    $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
    drawLooperWaveform();
    looperRafId = requestAnimationFrame(tick);
  }
  looperRafId = requestAnimationFrame(tick);
}

// Canvas Waveform Drawing
function drawLooperWaveform() {
  const canvas = $('looper-canvas');
  if (!canvas || !looperBuffer || !looperPeaks) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  ctx.save();
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const midY = h / 2;
  const dur = looperBuffer.duration;

  const viewStart = looperViewStart;
  const viewEnd = looperViewEnd || dur;
  const viewDur = Math.max(0.1, viewEnd - viewStart);

  function timeToX(t) {
    return ((t - viewStart) / viewDur) * w;
  }
  function xToTime(x) {
    return viewStart + (x / w) * viewDur;
  }

  // Clear Canvas Background
  ctx.fillStyle = '#16241e';
  ctx.fillRect(0, 0, w, h);

  // Subtle Center Line
  ctx.strokeStyle = '#22382e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  // Draw Audio Waveform Peaks
  const { peaks, totalBuckets } = looperPeaks;
  const startBucket = Math.max(0, Math.floor((viewStart / dur) * totalBuckets));
  const endBucket = Math.min(totalBuckets, Math.ceil((viewEnd / dur) * totalBuckets));

  ctx.fillStyle = '#4a705b';
  for (let i = startBucket; i < endBucket; i++) {
    const bucketTime = (i / totalBuckets) * dur;
    const x = timeToX(bucketTime);
    const colW = Math.max(1, (w / (endBucket - startBucket)) * 0.9);
    const minVal = peaks[i * 2];
    const maxVal = peaks[i * 2 + 1];
    const topY = midY - maxVal * (midY * 0.88);
    const botY = midY - minVal * (midY * 0.88);
    ctx.fillRect(x, topY, colW, Math.max(1, botY - topY));
  }

  // Loop Region Overlay (A to B)
  const xA = timeToX(looperPointA);
  const xB = timeToX(looperPointB);
  const loopW = Math.max(0, xB - xA);

  if (loopW > 0) {
    // Highlighted Loop Waveform Fill
    ctx.fillStyle = 'rgba(46, 125, 87, 0.28)';
    ctx.fillRect(xA, 0, loopW, h);

    // Re-draw peaks in loop region with brighter highlight
    ctx.fillStyle = '#78b593';
    const loopStartBucket = Math.max(0, Math.floor((looperPointA / dur) * totalBuckets));
    const loopEndBucket = Math.min(totalBuckets, Math.ceil((looperPointB / dur) * totalBuckets));
    for (let i = Math.max(startBucket, loopStartBucket); i < Math.min(endBucket, loopEndBucket); i++) {
      const bucketTime = (i / totalBuckets) * dur;
      const x = timeToX(bucketTime);
      const colW = Math.max(1, (w / (endBucket - startBucket)) * 0.9);
      const minVal = peaks[i * 2];
      const maxVal = peaks[i * 2 + 1];
      const topY = midY - maxVal * (midY * 0.88);
      const botY = midY - minVal * (midY * 0.88);
      ctx.fillRect(x, topY, colW, Math.max(1, botY - topY));
    }

    // Border lines for A and B
    ctx.strokeStyle = '#9be6bd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xA, 0);
    ctx.lineTo(xA, h);
    ctx.moveTo(xB, 0);
    ctx.lineTo(xB, h);
    ctx.stroke();

    // Flag A
    ctx.fillStyle = '#245342';
    ctx.strokeStyle = '#e5efcf';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(xA, 16, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e5efcf';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', xA, 16);

    // Flag B
    ctx.fillStyle = '#245342';
    ctx.beginPath();
    ctx.arc(xB, 16, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e5efcf';
    ctx.fillText('B', xB, 16);
  }

  // Playhead Line
  const playX = timeToX(looperCurrentPos);
  if (playX >= 0 && playX <= w) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// Canvas Mouse Interactions (Scrub, Drag A/B flags, Drag Region)
const looperCanvas = $('looper-canvas');
const looperHoverTime = $('looper-hover-time');

if (looperCanvas) {
  function getCanvasTimeFromEvent(e) {
    const rect = looperCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const viewDur = (looperViewEnd || looperBuffer.duration) - looperViewStart;
    return looperViewStart + (x / rect.width) * viewDur;
  }

  looperCanvas.addEventListener('mousedown', e => {
    if (!looperBuffer) return;
    const rect = looperCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const viewDur = (looperViewEnd || looperBuffer.duration) - looperViewStart;
    const timeX = (t) => ((t - looperViewStart) / viewDur) * rect.width;

    const xA = timeX(looperPointA);
    const xB = timeX(looperPointB);

    if (Math.abs(x - xA) <= 14) {
      looperDragMode = 'drag-a';
    } else if (Math.abs(x - xB) <= 14) {
      looperDragMode = 'drag-b';
    } else if (x > xA && x < xB && e.shiftKey) {
      looperDragMode = 'drag-region';
      looperDragStartX = getCanvasTimeFromEvent(e);
      looperDragStartA = looperPointA;
      looperDragStartB = looperPointB;
    } else {
      looperDragMode = 'scrub';
      looperCurrentPos = getCanvasTimeFromEvent(e);
      if (looperPlaying) {
        startLooperPlayback(looperIsLooping);
      } else {
        $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
        drawLooperWaveform();
      }
    }
  });

  window.addEventListener('mousemove', e => {
    if (!looperDragMode || !looperBuffer) return;
    const t = getCanvasTimeFromEvent(e);
    if (looperDragMode === 'drag-a') {
      setLooperPointA(t);
    } else if (looperDragMode === 'drag-b') {
      setLooperPointB(t);
    } else if (looperDragMode === 'drag-region') {
      const delta = t - looperDragStartX;
      const len = looperDragStartB - looperDragStartA;
      let newA = Math.max(0, Math.min(looperBuffer.duration - len, looperDragStartA + delta));
      let newB = newA + len;
      setLooperPointA(newA);
      setLooperPointB(newB);
    } else if (looperDragMode === 'scrub') {
      looperCurrentPos = t;
      $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
      drawLooperWaveform();
      if (looperPlaying && !looperIsLooping) {
        startLooperPlayback(false);
      }
    }
  });

  window.addEventListener('mouseup', () => {
    looperDragMode = null;
  });

  looperCanvas.addEventListener('mousemove', e => {
    if (!looperBuffer) return;
    const rect = looperCanvas.getBoundingClientRect();
    const t = getCanvasTimeFromEvent(e);
    looperHoverTime.hidden = false;
    looperHoverTime.style.left = (e.clientX - rect.left) + 'px';
    looperHoverTime.textContent = formatLooperTime(t);
  });

  looperCanvas.addEventListener('mouseleave', () => {
    looperHoverTime.hidden = true;
  });
}

// Load and Decode Audio File
async function loadAudioLooperFile(file) {
  if (!file) return;
  stopLooper(true);
  looperLoadedFile = file;

  $('audio-drop-empty').hidden = true;
  $('audio-drop-loaded').hidden = false;
  $('audio-file-name').textContent = file.name;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  $('audio-file-meta').textContent = `${mb} MB • Decoding audio…`;
  $('looper-placeholder').hidden = true;
  setLooperStatus('Decoding audio waveform with Web Audio API…');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = getAudioContext();
    looperBuffer = await ctx.decodeAudioData(arrayBuffer);

    const dur = looperBuffer.duration;
    looperPeaks = computeLooperPeaks(looperBuffer, 2400);

    // BPM Detection
    setLooperStatus('Analyzing tempo & rhythm onsets…');
    looperBpm = detectAudioBpm(looperBuffer);
    $('looper-bpm-display').textContent = `Tempo: ~${looperBpm} BPM`;

    // Defaults: Loop 4 bars
    const barSec = (60 / looperBpm) * 4;
    looperPointA = 0;
    looperPointB = Math.min(dur, Math.max(1, looperBars * barSec));
    if ($('looper-snap-zero')?.checked) {
      looperPointB = findNearestZeroCrossing(looperPointB);
    }

    looperViewStart = 0;
    looperViewEnd = dur;
    looperCurrentPos = 0;
    looperRepeats = 0;

    $('looper-duration').textContent = formatLooperTime(dur);
    $('looper-current-time').textContent = formatLooperTime(0);
    $('looper-point-a').value = formatLooperTime(looperPointA);
    $('looper-point-b').value = formatLooperTime(looperPointB);
    $('looper-loop-count').textContent = '0 repeats';

    const chStr = looperBuffer.numberOfChannels === 2 ? 'Stereo' : 'Mono';
    $('audio-file-meta').textContent = `${mb} MB • ${formatLooperTime(dur, false)} • ${chStr} • ~${looperBpm} BPM`;

    updateLooperLoopReadout();
    setLooperControls(true);
    drawLooperWaveform();
    setLooperStatus('Audio ready! Set A and B or click "🪄 Auto-Detect Loop" to create a seamless loop.');
  } catch (err) {
    console.error('Error decoding audio:', err);
    setLooperStatus('Could not decode audio file: ' + err.message);
    alert('Could not decode this audio file. Please ensure it is a valid MP3, WAV, M4A, or AAC file.');
  }
}

// Convert AudioBuffer to WAV File Blob
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

// Render Seamless Loop or Single Cut into an AudioBuffer using OfflineAudioContext
async function renderLoopedBuffer(mode = 'cut', targetDurationOrReps = 180, crossfadeMs = 15) {
  if (!looperBuffer) return null;
  const sr = looperBuffer.sampleRate;
  const numCh = looperBuffer.numberOfChannels;
  const loopDur = looperPointB - looperPointA;
  const crossfadeSec = Math.min(loopDur * 0.4, (Number(crossfadeMs) || 0) / 1000);

  let totalReps = 1;
  if (mode === 'extended') {
    if (typeof targetDurationOrReps === 'string' && targetDurationOrReps.startsWith('rep')) {
      totalReps = Math.max(1, parseInt(targetDurationOrReps.replace('rep', ''), 10) || 5);
    } else {
      const targetSec = Number(targetDurationOrReps) || 180;
      totalReps = Math.max(1, Math.ceil(targetSec / loopDur));
    }
  }

  // Calculate total rendered length accounting for crossfade overlap
  const totalLengthSec = mode === 'cut'
    ? loopDur
    : (totalReps * loopDur - (totalReps - 1) * crossfadeSec);
  const totalSamples = Math.ceil(totalLengthSec * sr);

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offlineCtx = new OfflineCtx(numCh, totalSamples, sr);

  for (let i = 0; i < totalReps; i++) {
    const src = offlineCtx.createBufferSource();
    src.buffer = looperBuffer;

    const gain = offlineCtx.createGain();
    src.connect(gain);
    gain.connect(offlineCtx.destination);

    const startTime = mode === 'cut' ? 0 : i * (loopDur - crossfadeSec);

    // Apply micro crossfade at iteration seams
    if (mode === 'extended' && crossfadeSec > 0) {
      if (i > 0) {
        // Fade in
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(1, startTime + crossfadeSec);
      }
      if (i < totalReps - 1) {
        // Fade out
        const fadeOutStart = startTime + loopDur - crossfadeSec;
        gain.gain.setValueAtTime(1, fadeOutStart);
        gain.gain.linearRampToValueAtTime(0, startTime + loopDur);
      }
    }

    src.start(startTime, looperPointA, loopDur);
  }

  return await offlineCtx.startRendering();
}

// Download/Export Helper
async function triggerAudioExport(mode = 'cut') {
  if (!looperBuffer) return;
  const exportBar = $('looper-export-bar');
  const exportStatus = $('looper-export-status');
  const cutBtn = $('btn-export-cut');
  const extBtn = $('btn-export-extended');

  cutBtn.disabled = true;
  extBtn.disabled = true;
  if (exportBar) {
    exportBar.hidden = false;
    exportBar.removeAttribute('value');
  }

  try {
    const baseName = (looperLoadedFile?.name || 'track').replace(/\.[^/.]+$/, '');
    const quality = $('looper-export-quality')?.value || '192';
    const crossfade = Number($('looper-crossfade')?.value || 15);
    const targetLength = $('looper-export-length')?.value || '180';

    if (exportStatus) exportStatus.textContent = 'Rendering seamless loop audio…';

    const renderedBuffer = await renderLoopedBuffer(mode, targetLength, crossfade);
    if (!renderedBuffer) throw Error('Could not render audio.');

    if (exportStatus) exportStatus.textContent = 'Preparing audio stream…';
    const wavBlob = audioBufferToWav(renderedBuffer);

    const outSuffix = mode === 'cut' ? '-cut' : '-looped';
    const outName = `${baseName}${outSuffix}`;

    // If local backend is ready and MP3 requested, encode via FFmpeg
    if (backendToken && quality !== 'wav') {
      if (exportStatus) exportStatus.textContent = 'Encoding MP3 via local FFmpeg…';
      const bitrate = quality;
      const res = await fetch(`/api/audio/encode-mp3?bitrate=${bitrate}&filename=${encodeURIComponent(outName)}.mp3`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Toolbox-Token': backendToken
        },
        body: wavBlob
      });

      if (!res.ok) {
        throw Error('Server encoding error ' + res.status);
      }

      const mp3Blob = await res.blob();
      const u = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `${outName}.mp3`;
      a.click();
      URL.revokeObjectURL(u);
      if (exportStatus) exportStatus.textContent = `✓ Exported ${outName}.mp3 successfully!`;
    } else {
      // Direct WAV download
      const u = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `${outName}.wav`;
      a.click();
      URL.revokeObjectURL(u);
      if (exportStatus) exportStatus.textContent = `✓ Exported ${outName}.wav successfully!`;
    }
  } catch (err) {
    console.error('Export error:', err);
    if (exportStatus) exportStatus.textContent = 'Export error: ' + err.message;
    alert('Export error: ' + err.message);
  } finally {
    cutBtn.disabled = false;
    extBtn.disabled = false;
    if (exportBar) exportBar.hidden = true;
  }
}

// UI Event Wiring for Audio Looper
const audioFileInput = $('audio-file-input');
const audioDropzone = $('audio-dropzone');

if (audioDropzone && audioFileInput) {
  ['dragenter', 'dragover'].forEach(name => {
    audioDropzone.addEventListener(name, e => {
      e.preventDefault();
      audioDropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(name => {
    audioDropzone.addEventListener(name, e => {
      e.preventDefault();
      audioDropzone.classList.remove('dragover');
    });
  });

  audioDropzone.addEventListener('drop', e => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadAudioLooperFile(file);
  });

  audioFileInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) loadAudioLooperFile(file);
    audioFileInput.value = '';
  });

  $('btn-audio-browse')?.addEventListener('click', e => {
    e.stopPropagation();
    audioFileInput.click();
  });
  $('btn-audio-placeholder-browse')?.addEventListener('click', () => audioFileInput.click());
  $('btn-change-audio')?.addEventListener('click', () => audioFileInput.click());

  // Transport buttons
  $('looper-play-btn').onclick = () => {
    if (looperPlaying && !looperIsLooping) stopLooper(false);
    else startLooperPlayback(false);
  };
  $('looper-step-back').onclick = () => {
    if (!looperBuffer) return;
    looperCurrentPos = Math.max(0, looperCurrentPos - 0.05);
    $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
    drawLooperWaveform();
  };
  $('looper-step-fwd').onclick = () => {
    if (!looperBuffer) return;
    looperCurrentPos = Math.min(looperBuffer.duration, looperCurrentPos + 0.05);
    $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
    drawLooperWaveform();
  };
  $('looper-toggle-loop').onclick = () => {
    if (looperIsLooping && looperPlaying) stopLooper(false);
    else startLooperPlayback(true);
  };

  // Nudge & Points Setting
  $('looper-set-a').onclick = () => setLooperPointA(looperCurrentPos);
  $('looper-set-b').onclick = () => setLooperPointB(looperCurrentPos);
  $('looper-nudge-a-down-fine').onclick = () => setLooperPointA(looperPointA - 0.01);
  $('looper-nudge-a-up-fine').onclick = () => setLooperPointA(looperPointA + 0.01);
  $('looper-nudge-b-down-fine').onclick = () => setLooperPointB(looperPointB - 0.01);
  $('looper-nudge-b-up-fine').onclick = () => setLooperPointB(looperPointB + 0.01);
  $('looper-jump-a').onclick = () => {
    looperCurrentPos = looperPointA;
    $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
    drawLooperWaveform();
  };
  $('looper-jump-b').onclick = () => {
    looperCurrentPos = looperPointB;
    $('looper-current-time').textContent = formatLooperTime(looperCurrentPos);
    drawLooperWaveform();
  };

  $('looper-point-a').onchange = () => {
    const s = parseLooperTime($('looper-point-a').value);
    if (Number.isFinite(s)) setLooperPointA(s);
    else $('looper-point-a').value = formatLooperTime(looperPointA);
  };
  $('looper-point-b').onchange = () => {
    const s = parseLooperTime($('looper-point-b').value);
    if (Number.isFinite(s)) setLooperPointB(s);
    else $('looper-point-b').value = formatLooperTime(looperPointB);
  };

  // Smart Loop Assistant Buttons
  $('looper-auto-detect-btn').onclick = autoDetectLooperPointB;

  document.querySelectorAll('.bar-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.bar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      looperBars = parseInt(btn.dataset.bars, 10) || 4;
      autoDetectLooperPointB();
    };
  });

  // Zoom Tools
  $('looper-zoom-in').onclick = () => {
    if (!looperBuffer) return;
    const dur = looperBuffer.duration;
    const center = (looperViewStart + looperViewEnd) / 2;
    const currentSpan = looperViewEnd - looperViewStart;
    const newSpan = Math.max(0.5, currentSpan * 0.65);
    looperViewStart = Math.max(0, center - newSpan / 2);
    looperViewEnd = Math.min(dur, center + newSpan / 2);
    const zoomPct = Math.round((dur / (looperViewEnd - looperViewStart)) * 100);
    $('looper-zoom-level').textContent = zoomPct + '%';
    drawLooperWaveform();
  };

  $('looper-zoom-out').onclick = () => {
    if (!looperBuffer) return;
    const dur = looperBuffer.duration;
    const center = (looperViewStart + looperViewEnd) / 2;
    const currentSpan = looperViewEnd - looperViewStart;
    const newSpan = Math.min(dur, currentSpan * 1.5);
    looperViewStart = Math.max(0, center - newSpan / 2);
    looperViewEnd = Math.min(dur, center + newSpan / 2);
    const zoomPct = Math.round((dur / (looperViewEnd - looperViewStart)) * 100);
    $('looper-zoom-level').textContent = zoomPct + '%';
    drawLooperWaveform();
  };

  $('looper-zoom-fit').onclick = () => {
    if (!looperBuffer) return;
    looperViewStart = 0;
    looperViewEnd = looperBuffer.duration;
    $('looper-zoom-level').textContent = '100%';
    drawLooperWaveform();
  };

  $('looper-snap-loop-view').onclick = () => {
    if (!looperBuffer) return;
    const padding = (looperPointB - looperPointA) * 0.15;
    looperViewStart = Math.max(0, looperPointA - padding);
    looperViewEnd = Math.min(looperBuffer.duration, looperPointB + padding);
    const dur = looperBuffer.duration;
    const zoomPct = Math.round((dur / (looperViewEnd - looperViewStart)) * 100);
    $('looper-zoom-level').textContent = zoomPct + '%';
    drawLooperWaveform();
  };

  // Volume & Mute
  $('looper-volume').oninput = () => {
    looperVolume = Number($('looper-volume').value);
    if (looperGainNode) looperGainNode.gain.value = looperMuted ? 0 : looperVolume;
  };
  $('looper-mute-btn').onclick = () => {
    looperMuted = !looperMuted;
    if (looperGainNode) looperGainNode.gain.value = looperMuted ? 0 : looperVolume;
    $('looper-mute-btn').textContent = looperMuted ? '🔇' : '🔊';
  };

  $('looper-reset-repeats').onclick = () => {
    looperRepeats = 0;
    $('looper-loop-count').textContent = '0 repeats';
  };

  // Export Buttons
  $('btn-export-cut').onclick = () => triggerAudioExport('cut');
  $('btn-export-extended').onclick = () => triggerAudioExport('extended');
}

// Window resize re-draws canvas
window.addEventListener('resize', () => {
  if (looperBuffer) drawLooperWaveform();
});


// ============================================================================
// 05. METADATA EDITOR & INSTAGRAM AI LABEL STRIPPER (ON-DEVICE LOSSLESS ENGINE)
// ============================================================================

// Binary byte stream utilities for direct browser Uint8Array manipulation
function metaConcatU8(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const res = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    res.set(a, off);
    off += a.length;
  }
  return res;
}

function metaReadU16BE(u8, off) {
  return (u8[off] << 8) | u8[off + 1];
}

function metaReadU16LE(u8, off) {
  return u8[off] | (u8[off + 1] << 8);
}

function metaReadU32BE(u8, off) {
  return ((u8[off] << 24) >>> 0) + (u8[off + 1] << 16) + (u8[off + 2] << 8) + u8[off + 3];
}

function metaReadU32LE(u8, off) {
  return ((u8[off + 3] << 24) >>> 0) + (u8[off + 2] << 16) + (u8[off + 1] << 8) + u8[off];
}

function metaWriteU32LE(u8, off, val) {
  u8[off] = val & 0xFF;
  u8[off + 1] = (val >> 8) & 0xFF;
  u8[off + 2] = (val >> 16) & 0xFF;
  u8[off + 3] = (val >> 24) & 0xFF;
}

function metaEscapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMetaBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------------- EXIF / TIFF Parser ----------------
function parseExifTiff(uint8, tiffStart = 0) {
  const tags = [];
  let gps = null;
  if (!uint8 || uint8.length < tiffStart + 8) return { tags, gps };

  const isLE = uint8[tiffStart] === 0x49 && uint8[tiffStart + 1] === 0x49;
  const isBE = uint8[tiffStart] === 0x4D && uint8[tiffStart + 1] === 0x4D;
  if (!isLE && !isBE) return { tags, gps };

  const readU16 = off => isLE ? metaReadU16LE(uint8, tiffStart + off) : metaReadU16BE(uint8, tiffStart + off);
  const readU32 = off => isLE ? metaReadU32LE(uint8, tiffStart + off) : metaReadU32BE(uint8, tiffStart + off);

  const magic = readU16(2);
  if (magic !== 42 && magic !== 0x2A) return { tags, gps };

  const ifd0Offset = readU32(4);

  const TAG_NAMES = {
    0x010E: 'ImageDescription',
    0x010F: 'Make',
    0x0110: 'Model',
    0x0112: 'Orientation',
    0x011A: 'XResolution',
    0x011B: 'YResolution',
    0x0131: 'Software',
    0x0132: 'DateTime',
    0x013B: 'Artist',
    0x8298: 'Copyright',
    0x829A: 'ExposureTime',
    0x829D: 'FNumber',
    0x8827: 'ISOSpeedRatings',
    0x9003: 'DateTimeOriginal',
    0x9004: 'DateTimeDigitized',
    0x920A: 'FocalLength',
    0x9286: 'UserComment',
    0xA002: 'PixelXDimension',
    0xA003: 'PixelYDimension',
    0xA434: 'LensModel',
    0x8769: 'ExifIFDPointer',
    0x8825: 'GPSInfoIFDPointer'
  };

  const GPS_TAG_NAMES = {
    0x0001: 'GPSLatitudeRef',
    0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef',
    0x0004: 'GPSLongitude',
    0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude',
    0x0007: 'GPSTimeStamp',
    0x001D: 'GPSDateStamp'
  };

  function parseIFD(offset, isGps = false) {
    if (offset <= 0 || offset + 2 > uint8.length - tiffStart) return;
    const numEntries = readU16(offset);
    let cur = offset + 2;

    for (let i = 0; i < numEntries; i++) {
      if (cur + 12 > uint8.length - tiffStart) break;
      const tagId = readU16(cur);
      const type = readU16(cur + 2);
      const count = readU32(cur + 4);
      const valOffset = cur + 8;

      let val = null;
      let rawOffset = readU32(valOffset);

      if (type === 2) { // ASCII
        const dataStart = count <= 4 ? valOffset : rawOffset;
        if (dataStart + count <= uint8.length - tiffStart) {
          const strBytes = uint8.subarray(tiffStart + dataStart, tiffStart + dataStart + count);
          val = new TextDecoder('utf-8', { fatal: false }).decode(strBytes).replace(/\0+$/, '').trim();
        }
      } else if (type === 3) { // SHORT
        val = readU16(valOffset);
      } else if (type === 4) { // LONG
        val = rawOffset;
      } else if (type === 5 || type === 10) { // RATIONAL / SRATIONAL
        if (rawOffset + 8 <= uint8.length - tiffStart) {
          const num = readU32(rawOffset);
          const den = readU32(rawOffset + 4);
          val = den !== 0 ? (num / den) : 0;
          if (count > 1 && rawOffset + count * 8 <= uint8.length - tiffStart) {
            const arr = [val];
            for (let j = 1; j < count; j++) {
              const n = readU32(rawOffset + j * 8);
              const d = readU32(rawOffset + j * 8 + 4);
              arr.push(d !== 0 ? n / d : 0);
            }
            val = arr;
          }
        }
      }

      const tagName = isGps ? (GPS_TAG_NAMES[tagId] || ('GPS_0x' + tagId.toString(16))) : (TAG_NAMES[tagId] || ('0x' + tagId.toString(16)));
      if (val !== null && val !== undefined) {
        tags.push({ tagId, name: tagName, value: val, category: isGps ? 'location' : 'camera' });
      }

      if (!isGps && tagId === 0x8769) {
        parseIFD(rawOffset, false);
      } else if (!isGps && tagId === 0x8825) {
        parseIFD(rawOffset, true);
      }

      cur += 12;
    }
  }

  parseIFD(ifd0Offset, false);

  const latRef = tags.find(t => t.name === 'GPSLatitudeRef')?.value;
  const latVal = tags.find(t => t.name === 'GPSLatitude')?.value;
  const lonRef = tags.find(t => t.name === 'GPSLongitudeRef')?.value;
  const lonVal = tags.find(t => t.name === 'GPSLongitude')?.value;
  const altVal = tags.find(t => t.name === 'GPSAltitude')?.value;

  if (Array.isArray(latVal) && Array.isArray(lonVal)) {
    let lat = (latVal[0] || 0) + (latVal[1] || 0) / 60 + (latVal[2] || 0) / 3600;
    if (latRef === 'S') lat = -lat;
    let lon = (lonVal[0] || 0) + (lonVal[1] || 0) / 60 + (lonVal[2] || 0) / 3600;
    if (lonRef === 'W') lon = -lon;
    gps = {
      latitude: lat,
      longitude: lon,
      altitude: typeof altVal === 'number' ? altVal : (Array.isArray(altVal) ? altVal[0] : null),
      text: lat.toFixed(5) + '°, ' + lon.toFixed(5) + '°',
      mapUrl: 'https://www.google.com/maps?q=' + lat + ',' + lon
    };
  } else if (tags.some(t => t.category === 'location')) {
    gps = {
      latitude: null,
      longitude: null,
      altitude: null,
      text: 'GPS metadata present',
      mapUrl: '#'
    };
  }

  return { tags, gps };
}

// ---------------- XMP Text Parser ----------------
function parseXmpText(xmpString) {
  const aiIndicators = [];
  const tags = [];

  const AI_REGEX = /compositeWithTrainedAlgorithmicMedia|algorithmicMedia|trainedAlgorithmicMedia|virtualRecording|c2pa|Generative Fill|Firefly|Midjourney|DALL-E|Stable Diffusion/gi;
  let match;
  while ((match = AI_REGEX.exec(xmpString)) !== null) {
    if (!aiIndicators.includes(match[0])) aiIndicators.push(match[0]);
  }

  const patterns = [
    { name: 'XMP DigitalSourceType', reg: /<(?:\w+:)?DigitalSourceType>([^<]+)<\/(?:\w+:)?DigitalSourceType>/i, cat: 'ai' },
    { name: 'XMP Creator Tool', reg: /<(?:\w+:)?CreatorTool>([^<]+)<\/(?:\w+:)?CreatorTool>/i, cat: 'camera' },
    { name: 'XMP History Software', reg: /stEvt:softwareAgent="([^"]+)"/i, cat: 'camera' },
    { name: 'XMP Credit', reg: /<(?:\w+:)?Credit>([^<]+)<\/(?:\w+:)?Credit>/i, cat: 'camera' },
    { name: 'XMP Document ID', reg: /<(?:\w+:)?DocumentID>([^<]+)<\/(?:\w+:)?DocumentID>/i, cat: 'all' }
  ];

  for (const p of patterns) {
    const m = xmpString.match(p.reg);
    if (m) {
      tags.push({ name: p.name, value: m[1].trim(), category: p.cat });
    }
  }

  return { aiIndicators, tags };
}

// ---------------- JPEG Binary Inspector & Strippers ----------------
function inspectJpeg(uint8) {
  let pos = 2; // skip 0xFFD8
  const len = uint8.length;
  let hasAi = false;
  let hasC2pa = false;
  let hasGps = false;
  const c2paDetails = [];
  const allTags = [];
  let gpsInfo = null;

  while (pos < len - 1) {
    if (uint8[pos] !== 0xFF) break;
    const marker = uint8[pos + 1];
    pos += 2;

    if (marker === 0xD8) continue;
    if (marker === 0xD9 || marker === 0xDA) break;
    if (marker >= 0xD0 && marker <= 0xD7) continue;

    if (pos + 2 > len) break;
    const segLen = (uint8[pos] << 8) | uint8[pos + 1];
    const payload = uint8.subarray(pos + 2, pos + segLen);

    // APP11: JUMBF / C2PA Manifest
    if (marker === 0xEB) {
      hasC2pa = true;
      hasAi = true;
      c2paDetails.push('APP11 C2PA Manifest (JUMBF block: ' + segLen + ' bytes)');
      allTags.push({ name: 'C2PA JUMBF Manifest', value: 'Embedded credentials (' + segLen + ' bytes)', category: 'ai' });
    }

    // APP1: EXIF or XMP
    if (marker === 0xE1) {
      if (payload.length > 6 && String.fromCharCode(...payload.subarray(0, 4)) === 'Exif') {
        const exifRes = parseExifTiff(payload, 6);
        allTags.push(...exifRes.tags);
        if (exifRes.gps) {
          hasGps = true;
          gpsInfo = exifRes.gps;
        }
      }
      const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
      if (payload.length > xmpHeader.length && String.fromCharCode(...payload.subarray(0, xmpHeader.length)) === xmpHeader) {
        const xmpText = new TextDecoder('utf-8', { fatal: false }).decode(payload.subarray(xmpHeader.length));
        const xmpRes = parseXmpText(xmpText);
        if (xmpRes.aiIndicators.length > 0) {
          hasAi = true;
          c2paDetails.push(...xmpRes.aiIndicators.map(ind => 'XMP AI Indicator: "' + ind + '"'));
        }
        allTags.push(...xmpRes.tags);
      }
    }

    // APP13: IPTC
    if (marker === 0xED) {
      allTags.push({ name: 'IPTC Data (APP13)', value: segLen + ' bytes embedded', category: 'all' });
    }

    pos += segLen;
  }

  return { hasAi, hasC2pa, hasGps, c2paDetails, allTags, gpsInfo };
}

function stripJpegAi(uint8) {
  const parts = [];
  parts.push(uint8.subarray(0, 2)); // SOI 0xFFD8

  let pos = 2;
  const len = uint8.length;

  while (pos < len - 1) {
    if (uint8[pos] !== 0xFF) {
      parts.push(uint8.subarray(pos));
      break;
    }
    const marker = uint8[pos + 1];
    pos += 2;

    if (marker === 0xD8) continue;
    if (marker === 0xD9) {
      parts.push(new Uint8Array([0xFF, 0xD9]));
      break;
    }
    if (marker === 0xDA) {
      parts.push(uint8.subarray(pos - 2));
      break;
    }
    if (marker >= 0xD0 && marker <= 0xD7) {
      parts.push(new Uint8Array([0xFF, marker]));
      continue;
    }

    if (pos + 2 > len) break;
    const segLen = (uint8[pos] << 8) | uint8[pos + 1];
    const segEnd = pos + segLen;
    const payload = uint8.subarray(pos + 2, segEnd);

    // 1. Strip APP11 (C2PA/JUMBF) completely
    if (marker === 0xEB) {
      pos = segEnd;
      continue;
    }

    // 2. Sanitize APP1 XMP if it contains AI markers
    if (marker === 0xE1) {
      const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
      if (payload.length > xmpHeader.length && String.fromCharCode(...payload.subarray(0, xmpHeader.length)) === xmpHeader) {
        const xmpText = new TextDecoder('utf-8', { fatal: false }).decode(payload.subarray(xmpHeader.length));
        if (/compositeWithTrainedAlgorithmicMedia|algorithmicMedia|trainedAlgorithmicMedia|virtualRecording|c2pa|Generative Fill|Midjourney|DALL-E|Firefly|Stable Diffusion/i.test(xmpText)) {
          let cleanedXmp = xmpText
            .replace(/<[^>]*DigitalSourceType[^>]*>[^<]*<\/[^>]*DigitalSourceType>/gi, '')
            .replace(/<[^>]*c2pa:[^>]*>[\s\S]*?<\/[^>]*c2pa:[^>]*>/gi, '')
            .replace(/<[^>]*CreatorTool[^>]*>[^<]*(Generative Fill|Midjourney|DALL-E|Firefly|Stable Diffusion)[^<]*<\/[^>]*CreatorTool>/gi, '<xmp:CreatorTool>Adobe Photoshop</xmp:CreatorTool>')
            .replace(/stEvt:softwareAgent="[^"]*(Generative Fill|Midjourney|DALL-E|Firefly|Stable Diffusion)[^"]*"/gi, 'stEvt:softwareAgent="Adobe Photoshop"');

          const headerBytes = new TextEncoder().encode(xmpHeader);
          const xmpBytes = new TextEncoder().encode(cleanedXmp);
          const newPayload = metaConcatU8([headerBytes, xmpBytes]);
          const newLen = newPayload.length + 2;
          const lenBytes = new Uint8Array([(newLen >> 8) & 0xFF, newLen & 0xFF]);
          parts.push(new Uint8Array([0xFF, 0xE1]), lenBytes, newPayload);
          pos = segEnd;
          continue;
        }
      }
    }

    // Keep all other segments
    parts.push(uint8.subarray(pos - 2, segEnd));
    pos = segEnd;
  }

  return metaConcatU8(parts);
}

function stripJpegGps(uint8) {
  const copy = new Uint8Array(uint8);
  let pos = 2;
  const len = copy.length;

  while (pos < len - 1) {
    if (copy[pos] !== 0xFF) break;
    const marker = copy[pos + 1];
    pos += 2;

    if (marker === 0xDA || marker === 0xD9) break;
    if (pos + 2 > len) break;
    const segLen = (copy[pos] << 8) | copy[pos + 1];
    const segEnd = pos + segLen;

    if (marker === 0xE1) {
      const payloadStart = pos + 2;
      if (segLen > 8 && String.fromCharCode(...copy.subarray(payloadStart, payloadStart + 4)) === 'Exif') {
        const tiffStart = payloadStart + 6;
        const isLE = copy[tiffStart] === 0x49 && copy[tiffStart + 1] === 0x49;
        const readU16 = off => isLE ? metaReadU16LE(copy, tiffStart + off) : metaReadU16BE(copy, tiffStart + off);
        const readU32 = off => isLE ? metaReadU32LE(copy, tiffStart + off) : metaReadU32BE(copy, tiffStart + off);

        const ifd0 = readU32(4);
        if (ifd0 > 0 && tiffStart + ifd0 + 2 <= segEnd) {
          const numEntries = readU16(ifd0);
          let cur = ifd0 + 2;
          for (let i = 0; i < numEntries; i++) {
            if (tiffStart + cur + 12 > segEnd) break;
            const tagId = readU16(cur);
            if (tagId === 0x8825) { // GPS Info IFD Pointer
              for (let k = 0; k < 12; k++) copy[tiffStart + cur + k] = 0;
            }
            cur += 12;
          }
        }
      }
    }

    pos = segEnd;
  }

  return copy;
}

function stripJpegAll(uint8, keepIcc = true) {
  const parts = [];
  parts.push(uint8.subarray(0, 2)); // SOI

  let pos = 2;
  const len = uint8.length;

  while (pos < len - 1) {
    if (uint8[pos] !== 0xFF) {
      parts.push(uint8.subarray(pos));
      break;
    }
    const marker = uint8[pos + 1];
    pos += 2;

    if (marker === 0xD8) continue;
    if (marker === 0xD9) {
      parts.push(new Uint8Array([0xFF, 0xD9]));
      break;
    }
    if (marker === 0xDA) {
      parts.push(uint8.subarray(pos - 2));
      break;
    }
    if (marker >= 0xD0 && marker <= 0xD7) {
      parts.push(new Uint8Array([0xFF, marker]));
      continue;
    }

    if (pos + 2 > len) break;
    const segLen = (uint8[pos] << 8) | uint8[pos + 1];
    const segEnd = pos + segLen;

    // Drop all APPx markers (EXIF, XMP, IPTC, JUMBF, thumbnails) except optional ICC APP2
    if (marker >= 0xE0 && marker <= 0xEF) {
      if (keepIcc && marker === 0xE2) {
        parts.push(uint8.subarray(pos - 2, segEnd));
      }
      pos = segEnd;
      continue;
    }
    if (marker === 0xFE) { // COM
      pos = segEnd;
      continue;
    }

    parts.push(uint8.subarray(pos - 2, segEnd));
    pos = segEnd;
  }

  return metaConcatU8(parts);
}

function clearJpegExifTag(uint8, targetTagId) {
  const copy = new Uint8Array(uint8);
  let pos = 2;
  const len = copy.length;

  while (pos < len - 1) {
    if (copy[pos] !== 0xFF) break;
    const marker = copy[pos + 1];
    pos += 2;

    if (marker === 0xDA || marker === 0xD9) break;
    if (pos + 2 > len) break;
    const segLen = (copy[pos] << 8) | copy[pos + 1];
    const segEnd = pos + segLen;

    if (marker === 0xE1 && segLen > 8) {
      const payloadStart = pos + 2;
      if (String.fromCharCode(...copy.subarray(payloadStart, payloadStart + 4)) === 'Exif') {
        const tiffStart = payloadStart + 6;
        const isLE = copy[tiffStart] === 0x49 && copy[tiffStart + 1] === 0x49;
        const readU16 = off => isLE ? metaReadU16LE(copy, tiffStart + off) : metaReadU16BE(copy, tiffStart + off);
        const readU32 = off => isLE ? metaReadU32LE(copy, tiffStart + off) : metaReadU32BE(copy, tiffStart + off);

        function scanIfd(offset) {
          if (offset <= 0 || tiffStart + offset + 2 > segEnd) return;
          const numEntries = readU16(offset);
          let cur = offset + 2;
          for (let i = 0; i < numEntries; i++) {
            if (tiffStart + cur + 12 > segEnd) break;
            const tagId = readU16(cur);
            if (tagId === targetTagId) {
              for (let k = 0; k < 12; k++) copy[tiffStart + cur + k] = 0;
            } else if (tagId === 0x8769 || tagId === 0x8825) {
              scanIfd(readU32(cur + 8));
            }
            cur += 12;
          }
        }
        scanIfd(readU32(4));
      }
    }
    pos = segEnd;
  }
  return copy;
}

// ---------------- PNG Inspector & Strippers ----------------
function inspectPng(uint8) {
  let pos = 8;
  const len = uint8.length;
  let hasAi = false;
  let hasC2pa = false;
  let hasGps = false;
  const c2paDetails = [];
  const allTags = [];
  let gpsInfo = null;

  while (pos < len) {
    if (pos + 8 > len) break;
    const chunkLen = metaReadU32BE(uint8, pos);
    const chunkType = String.fromCharCode(...uint8.subarray(pos + 4, pos + 8));
    const dataStart = pos + 8;
    const dataEnd = dataStart + chunkLen;

    if (chunkType === 'c2pa' || chunkType === 'jumb') {
      hasC2pa = true;
      hasAi = true;
      c2paDetails.push('PNG ' + chunkType + ' chunk (' + chunkLen + ' bytes)');
      allTags.push({ name: 'PNG ' + chunkType, value: 'C2PA credentials (' + chunkLen + ' bytes)', category: 'ai' });
    } else if (chunkType === 'iTXt' || chunkType === 'tEXt') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8.subarray(dataStart, dataEnd));
      if (/compositeWithTrainedAlgorithmicMedia|algorithmicMedia|trainedAlgorithmicMedia|c2pa|Generative Fill|Midjourney|DALL-E/i.test(text)) {
        hasAi = true;
        c2paDetails.push('PNG ' + chunkType + ' contains AI provenance tags');
      }
      allTags.push({ name: 'PNG ' + chunkType, value: text.slice(0, 120), category: 'camera' });
    } else if (chunkType === 'eXIf') {
      const exif = parseExifTiff(uint8, dataStart);
      allTags.push(...exif.tags);
      if (exif.gps) {
        hasGps = true;
        gpsInfo = exif.gps;
      }
    }

    pos = dataEnd + 4;
  }

  return { hasAi, hasC2pa, hasGps, c2paDetails, allTags, gpsInfo };
}

function stripPngAi(uint8) {
  const parts = [];
  parts.push(uint8.subarray(0, 8)); // PNG signature

  let pos = 8;
  const len = uint8.length;

  while (pos < len) {
    if (pos + 8 > len) break;
    const chunkLen = metaReadU32BE(uint8, pos);
    const chunkType = String.fromCharCode(...uint8.subarray(pos + 4, pos + 8));
    const chunkTotal = 12 + chunkLen;
    const chunkEnd = pos + chunkTotal;

    if (chunkType === 'c2pa' || chunkType === 'jumb') {
      pos = chunkEnd;
      continue;
    }

    if (chunkType === 'iTXt' || chunkType === 'tEXt') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8.subarray(pos + 8, pos + 8 + chunkLen));
      if (/compositeWithTrainedAlgorithmicMedia|algorithmicMedia|trainedAlgorithmicMedia|c2pa|Generative Fill|Midjourney|DALL-E/i.test(text)) {
        pos = chunkEnd;
        continue;
      }
    }

    parts.push(uint8.subarray(pos, chunkEnd));
    pos = chunkEnd;
  }

  return metaConcatU8(parts);
}

function stripPngAll(uint8, keepIcc = true) {
  const parts = [];
  parts.push(uint8.subarray(0, 8));

  let pos = 8;
  const len = uint8.length;

  while (pos < len) {
    if (pos + 8 > len) break;
    const chunkLen = metaReadU32BE(uint8, pos);
    const chunkType = String.fromCharCode(...uint8.subarray(pos + 4, pos + 8));
    const chunkTotal = 12 + chunkLen;
    const chunkEnd = pos + chunkTotal;

    if (['eXIf', 'iTXt', 'tEXt', 'zTXt', 'c2pa', 'jumb', 'tIME'].includes(chunkType)) {
      pos = chunkEnd;
      continue;
    }
    if (!keepIcc && chunkType === 'iCCP') {
      pos = chunkEnd;
      continue;
    }

    parts.push(uint8.subarray(pos, chunkEnd));
    pos = chunkEnd;
  }

  return metaConcatU8(parts);
}

// ---------------- WebP Inspector & Strippers ----------------
function inspectWebp(uint8) {
  let hasAi = false;
  let hasC2pa = false;
  let hasGps = false;
  const c2paDetails = [];
  const allTags = [];
  let gpsInfo = null;

  if (uint8.length < 12) return { hasAi, hasC2pa, hasGps, c2paDetails, allTags, gpsInfo };
  const magicRiff = String.fromCharCode(...uint8.subarray(0, 4));
  const magicWebp = String.fromCharCode(...uint8.subarray(8, 12));
  if (magicRiff !== 'RIFF' || magicWebp !== 'WEBP') return { hasAi, hasC2pa, hasGps, c2paDetails, allTags, gpsInfo };

  let pos = 12;
  const len = uint8.length;

  while (pos < len - 8) {
    const chunkType = String.fromCharCode(...uint8.subarray(pos, pos + 4));
    const chunkLen = metaReadU32LE(uint8, pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + chunkLen;

    if (chunkType === 'C2PA') {
      hasC2pa = true;
      hasAi = true;
      c2paDetails.push('WebP C2PA chunk (' + chunkLen + ' bytes)');
      allTags.push({ name: 'WebP C2PA Chunk', value: chunkLen + ' bytes', category: 'ai' });
    } else if (chunkType === 'XMP ') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8.subarray(dataStart, dataEnd));
      const res = parseXmpText(text);
      if (res.aiIndicators.length > 0) {
        hasAi = true;
        c2paDetails.push(...res.aiIndicators.map(ind => 'WebP XMP AI: "' + ind + '"'));
      }
      allTags.push(...res.tags);
    } else if (chunkType === 'EXIF') {
      const exif = parseExifTiff(uint8, dataStart);
      allTags.push(...exif.tags);
      if (exif.gps) {
        hasGps = true;
        gpsInfo = exif.gps;
      }
    }

    pos = dataEnd + (chunkLen % 2 === 1 ? 1 : 0);
  }

  return { hasAi, hasC2pa, hasGps, c2paDetails, allTags, gpsInfo };
}

function stripWebpAi(uint8) {
  const parts = [];
  parts.push(uint8.subarray(0, 12));

  let pos = 12;
  const len = uint8.length;

  while (pos < len - 8) {
    const chunkType = String.fromCharCode(...uint8.subarray(pos, pos + 4));
    const chunkLen = metaReadU32LE(uint8, pos + 4);
    const paddedLen = chunkLen + (chunkLen % 2 === 1 ? 1 : 0);
    const chunkEnd = pos + 8 + paddedLen;

    if (chunkType === 'C2PA') {
      pos = chunkEnd;
      continue;
    }

    if (chunkType === 'XMP ') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8.subarray(pos + 8, pos + 8 + chunkLen));
      if (/compositeWithTrainedAlgorithmicMedia|algorithmicMedia|trainedAlgorithmicMedia|c2pa|Generative Fill|Midjourney/i.test(text)) {
        pos = chunkEnd;
        continue;
      }
    }

    parts.push(uint8.subarray(pos, chunkEnd));
    pos = chunkEnd;
  }

  const out = metaConcatU8(parts);
  metaWriteU32LE(out, 4, out.length - 8);
  return out;
}

function stripWebpAll(uint8) {
  const parts = [];
  parts.push(uint8.subarray(0, 12));

  let pos = 12;
  const len = uint8.length;

  while (pos < len - 8) {
    const chunkType = String.fromCharCode(...uint8.subarray(pos, pos + 4));
    const chunkLen = metaReadU32LE(uint8, pos + 4);
    const paddedLen = chunkLen + (chunkLen % 2 === 1 ? 1 : 0);
    const chunkEnd = pos + 8 + paddedLen;

    if (['EXIF', 'XMP ', 'C2PA'].includes(chunkType)) {
      pos = chunkEnd;
      continue;
    }

    if (chunkType === 'VP8X') {
      const chunkCopy = new Uint8Array(uint8.subarray(pos, chunkEnd));
      chunkCopy[8] &= ~0x0C; // Clear EXIF and XMP flags
      parts.push(chunkCopy);
      pos = chunkEnd;
      continue;
    }

    parts.push(uint8.subarray(pos, chunkEnd));
    pos = chunkEnd;
  }

  const out = metaConcatU8(parts);
  metaWriteU32LE(out, 4, out.length - 8);
  return out;
}

// ---------------- Unified Format Dispatchers ----------------
function inspectImageMetadata(uint8, mimeType) {
  if (mimeType.includes('png') || (uint8[0] === 0x89 && uint8[1] === 0x50)) {
    return inspectPng(uint8);
  }
  if (mimeType.includes('webp') || (uint8[0] === 0x52 && uint8[1] === 0x49)) {
    return inspectWebp(uint8);
  }
  return inspectJpeg(uint8);
}

function stripImageAiBinary(uint8, mimeType) {
  if (mimeType.includes('png') || (uint8[0] === 0x89 && uint8[1] === 0x50)) {
    return stripPngAi(uint8);
  }
  if (mimeType.includes('webp') || (uint8[0] === 0x52 && uint8[1] === 0x49)) {
    return stripWebpAi(uint8);
  }
  return stripJpegAi(uint8);
}

function stripImageGpsBinary(uint8, mimeType) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg') || (uint8[0] === 0xFF && uint8[1] === 0xD8)) {
    return stripJpegGps(uint8);
  }
  return stripImageAllBinary(uint8, mimeType, true);
}

function stripImageAllBinary(uint8, mimeType, keepIcc = true) {
  if (mimeType.includes('png') || (uint8[0] === 0x89 && uint8[1] === 0x50)) {
    return stripPngAll(uint8, keepIcc);
  }
  if (mimeType.includes('webp') || (uint8[0] === 0x52 && uint8[1] === 0x49)) {
    return stripWebpAll(uint8);
  }
  return stripJpegAll(uint8, keepIcc);
}

// ==========================================
// METADATA EDITOR UI & QUEUE CONTROLLER
// ==========================================
let metaFilesQueue = [];
let metaActiveIndex = 0;
let metaActiveTab = 'summary';
let metaSearchTerm = '';

function downloadCleanedFile(item) {
  if (!item) return;
  const bytes = item.cleanedBytes || item.rawBytes;
  const blob = new Blob([bytes], { type: item.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  const lastDot = item.name.lastIndexOf('.');
  const baseName = lastDot > 0 ? item.name.slice(0, lastDot) : item.name;
  const ext = lastDot > 0 ? item.name.slice(lastDot) : (item.mimeType.includes('png') ? '.png' : (item.mimeType.includes('webp') ? '.webp' : '.jpg'));

  let suffix = '_clean';
  if (item.cleanMode === 'ai') suffix = '_no_ai';
  else if (item.cleanMode === 'gps') suffix = '_no_gps';
  else if (item.cleanMode === 'custom') suffix = '_edited';

  a.href = url;
  a.download = baseName + suffix + ext;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function batchProcessAndDownload(mode) {
  if (metaFilesQueue.length === 0) return;
  metaFilesQueue.forEach((item, idx) => {
    setTimeout(() => {
      if (mode === 'ai') {
        item.cleanedBytes = stripImageAiBinary(item.rawBytes, item.mimeType);
        item.cleanMode = 'ai';
      } else if (mode === 'all') {
        item.cleanedBytes = stripImageAllBinary(item.rawBytes, item.mimeType, true);
        item.cleanMode = 'all';
      }
      downloadCleanedFile(item);
      if (idx === metaFilesQueue.length - 1) {
        renderActiveMetadata();
        renderMetadataQueue();
      }
    }, idx * 300);
  });
}

function clearMetadataQueue() {
  for (const item of metaFilesQueue) {
    if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
  }
  metaFilesQueue = [];
  metaActiveIndex = 0;
  metaSearchTerm = '';

  const qBar = $('meta-queue-bar');
  const ws = $('meta-workspace');
  const dEmpty = $('meta-drop-empty');
  const dLoaded = $('meta-drop-loaded');
  const fileInput = $('meta-file-input');

  if (qBar) qBar.hidden = true;
  if (ws) ws.hidden = true;
  if (dEmpty) dEmpty.hidden = false;
  if (dLoaded) dLoaded.hidden = true;
  if (fileInput) fileInput.value = '';
}

function renderMetadataQueue() {
  const qBar = $('meta-queue-bar');
  const qCount = $('meta-queue-count');
  const qChips = $('meta-queue-chips');

  if (!qBar || !qChips) return;
  if (metaFilesQueue.length <= 1) {
    qBar.hidden = true;
    return;
  }

  qBar.hidden = false;
  qCount.textContent = metaFilesQueue.length;
  qChips.innerHTML = '';

  metaFilesQueue.forEach((item, idx) => {
    const chip = document.createElement('div');
    chip.className = 'meta-chip' + (idx === metaActiveIndex ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.name.length > 20 ? item.name.slice(0, 18) + '…' : item.name;
    chip.appendChild(nameSpan);

    const flag = document.createElement('span');
    flag.className = 'chip-flag';
    if (item.cleanMode) {
      flag.className += ' flag-clean';
      flag.textContent = '✓ ' + (item.cleanMode === 'ai' ? 'NO-AI' : 'CLEAN');
    } else if (item.info.hasAi) {
      flag.className += ' flag-ai';
      flag.textContent = 'AI';
    } else if (item.info.hasGps) {
      flag.className += ' flag-gps';
      flag.textContent = 'GPS';
    } else {
      flag.className += ' flag-clean';
      flag.textContent = 'CLEAN';
    }
    chip.appendChild(flag);

    chip.onclick = () => {
      metaActiveIndex = idx;
      renderActiveMetadata();
      renderMetadataQueue();
    };

    qChips.appendChild(chip);
  });
}

function renderMetaTagList() {
  const container = $('meta-tag-container');
  if (!container) return;
  container.innerHTML = '';

  const activeItem = metaFilesQueue[metaActiveIndex];
  if (!activeItem || !activeItem.info) {
    container.innerHTML = '<div style="padding:16px;color:var(--muted)">No image metadata loaded.</div>';
    return;
  }

  const { allTags, hasAi, hasGps, c2paDetails, gpsInfo } = activeItem.info;

  // Filter based on active tab
  let displayTags = [];
  if (metaActiveTab === 'summary') {
    const summaryCard = document.createElement('div');
    summaryCard.className = 'meta-summary-card';
    summaryCard.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:6px 0;';

    const makeTag = allTags.find(t => t.name === 'Make')?.value;
    const modelTag = allTags.find(t => t.name === 'Model')?.value;
    const dateTag = allTags.find(t => t.name === 'DateTimeOriginal' || t.name === 'DateTime')?.value;
    const softTag = allTags.find(t => t.name === 'Software')?.value;

    const summaryRows = [
      { label: 'File Name', val: activeItem.name },
      { label: 'File Size', val: formatMetaBytes(activeItem.cleanedBytes ? activeItem.cleanedBytes.length : activeItem.size) + (activeItem.cleanedBytes ? ' (Cleaned)' : ' (Original)') },
      { label: 'File Format', val: activeItem.mimeType.toUpperCase() },
      { label: 'Instagram AI Status', val: hasAi ? '⚠️ Provenance Credentials Detected (Instagram will auto-label as AI)' : '✓ Clean (Safe to post without automated AI label)', isAi: hasAi, isClean: !hasAi },
      { label: 'GPS Location', val: gpsInfo ? (gpsInfo.text + ' (<a href="' + gpsInfo.mapUrl + '" target="_blank" rel="noopener">Open Map ↗</a>)') : 'None embedded', isGps: !!gpsInfo },
      { label: 'Camera / Device', val: (makeTag || modelTag) ? ((makeTag || '') + ' ' + (modelTag || '')).trim() : 'None found' },
      { label: 'Date Taken', val: dateTag || 'None found' },
      { label: 'Software / Tool', val: softTag || 'None found' }
    ];

    summaryRows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'meta-tag-row';
      if (r.isAi) row.className += ' row-ai';
      if (r.isGps) row.className += ' row-gps';
      row.innerHTML = `
        <div class="meta-tag-info">
          <div class="meta-tag-header">
            <span class="meta-tag-name">${metaEscapeHtml(r.label)}</span>
          </div>
          <div class="meta-tag-val">${r.val}</div>
        </div>
      `;
      summaryCard.appendChild(row);
    });

    container.appendChild(summaryCard);
    return;
  } else if (metaActiveTab === 'ai') {
    displayTags = allTags.filter(t => t.category === 'ai');
    if (displayTags.length === 0 && c2paDetails.length > 0) {
      displayTags = c2paDetails.map(d => ({ name: 'C2PA Credential', value: d, category: 'ai' }));
    }
  } else if (metaActiveTab === 'camera') {
    displayTags = allTags.filter(t => t.category === 'camera');
  } else if (metaActiveTab === 'location') {
    displayTags = allTags.filter(t => t.category === 'location');
  } else {
    displayTags = allTags;
  }

  // Filter by search term if typed
  if (metaSearchTerm) {
    displayTags = displayTags.filter(t => 
      t.name.toLowerCase().includes(metaSearchTerm) || 
      String(t.value).toLowerCase().includes(metaSearchTerm)
    );
  }

  if (displayTags.length === 0) {
    let msg = 'No tags matching this filter.';
    if (metaActiveTab === 'ai') msg = '✓ No AI credentials or C2PA manifests found in this image.';
    if (metaActiveTab === 'location') msg = 'No GPS location coordinates embedded in this image.';
    if (metaActiveTab === 'camera') msg = 'No camera EXIF metadata found in this image.';
    container.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;font-weight:600;">' + msg + '</div>';
    return;
  }

  displayTags.forEach(tag => {
    const row = document.createElement('div');
    row.className = 'meta-tag-row' + (tag.category === 'ai' ? ' row-ai' : (tag.category === 'location' ? ' row-gps' : ''));

    const valStr = typeof tag.value === 'object' ? JSON.stringify(tag.value) : String(tag.value);

    row.innerHTML = `
      <div class="meta-tag-info">
        <div class="meta-tag-header">
          <span class="meta-tag-name">${metaEscapeHtml(tag.name)}</span>
          <span class="meta-tag-group">${tag.category.toUpperCase()}</span>
        </div>
        <div class="meta-tag-val">${metaEscapeHtml(valStr)}</div>
      </div>
      <div class="meta-tag-actions">
        <button type="button" class="text-btn-sm tag-wipe-btn" title="Clear or sanitize this tag">✕ Wipe</button>
      </div>
    `;

    const wipeBtn = row.querySelector('.tag-wipe-btn');
    if (wipeBtn) {
      wipeBtn.onclick = () => {
        if (tag.category === 'ai') {
          activeItem.cleanedBytes = stripImageAiBinary(activeItem.cleanedBytes || activeItem.rawBytes, activeItem.mimeType);
          activeItem.cleanMode = 'ai';
        } else if (tag.category === 'location') {
          activeItem.cleanedBytes = stripImageGpsBinary(activeItem.cleanedBytes || activeItem.rawBytes, activeItem.mimeType);
          activeItem.cleanMode = 'gps';
        } else if (tag.tagId) {
          activeItem.cleanedBytes = clearJpegExifTag(activeItem.cleanedBytes || activeItem.rawBytes, tag.tagId);
          activeItem.cleanMode = 'custom';
        } else {
          activeItem.cleanedBytes = stripImageAllBinary(activeItem.cleanedBytes || activeItem.rawBytes, activeItem.mimeType, true);
          activeItem.cleanMode = 'all';
        }
        activeItem.info = inspectImageMetadata(activeItem.cleanedBytes, activeItem.mimeType);
        $('meta-clean-summary').textContent = 'Tag "' + tag.name + '" wiped losslessly. Ready to export.';
        renderActiveMetadata();
        renderMetadataQueue();
      };
    }

    container.appendChild(row);
  });
}

function renderActiveMetadata() {
  const activeItem = metaFilesQueue[metaActiveIndex];
  if (!activeItem) return;

  const dEmpty = $('meta-drop-empty');
  const dLoaded = $('meta-drop-loaded');
  const ws = $('meta-workspace');
  const fileName = $('meta-file-name');
  const fileMeta = $('meta-file-meta');
  const previewImg = $('meta-preview-img');

  if (dEmpty) dEmpty.hidden = true;
  if (dLoaded) dLoaded.hidden = false;
  if (ws) ws.hidden = false;

  const curBytes = activeItem.cleanedBytes ? activeItem.cleanedBytes.length : activeItem.size;
  if (fileName) fileName.textContent = activeItem.name;
  if (fileMeta) fileMeta.textContent = formatMetaBytes(curBytes) + ' · ' + activeItem.mimeType.toUpperCase() + (activeItem.cleanMode ? ' (SANITIZED)' : '');

  if (previewImg && activeItem.thumbnailUrl) {
    previewImg.src = activeItem.thumbnailUrl;
  }

  // Update status banners
  const bAi = $('banner-ai-detected');
  const bGps = $('banner-gps-detected');
  const bClean = $('banner-clean');
  const gpsText = $('meta-gps-text');

  const { hasAi, hasGps, gpsInfo, allTags } = activeItem.info;

  if (bAi) bAi.hidden = !hasAi;
  if (bGps) {
    bGps.hidden = !hasGps;
    if (gpsText && gpsInfo) gpsText.textContent = 'Coordinates found: ' + gpsInfo.text;
  }
  if (bClean) {
    bClean.hidden = hasAi || hasGps;
  }

  // Update tab counters
  const cntAi = $('cnt-tab-ai');
  const cntCam = $('cnt-tab-camera');
  const cntLoc = $('cnt-tab-location');
  const cntAll = $('cnt-tab-all');

  const aiTags = allTags.filter(t => t.category === 'ai');
  const camTags = allTags.filter(t => t.category === 'camera');
  const locTags = allTags.filter(t => t.category === 'location');

  if (cntAi) cntAi.textContent = hasAi ? Math.max(aiTags.length, 1) : 0;
  if (cntCam) cntCam.textContent = camTags.length;
  if (cntLoc) cntLoc.textContent = hasGps ? Math.max(locTags.length, 1) : 0;
  if (cntAll) cntAll.textContent = allTags.length;

  // Update download card summary
  const cleanSummary = $('meta-clean-summary');
  if (cleanSummary) {
    if (activeItem.cleanMode === 'ai') {
      cleanSummary.textContent = '✓ AI credentials stripped. Zero pixel recompression. Ready to export.';
    } else if (activeItem.cleanMode === 'gps') {
      cleanSummary.textContent = '✓ GPS location wiped. Zero pixel recompression. Ready to export.';
    } else if (activeItem.cleanMode === 'all') {
      cleanSummary.textContent = '✓ Total privacy strip applied. ICC profile preserved. Ready to export.';
    } else if (!hasAi && !hasGps) {
      cleanSummary.textContent = 'Image has no AI or GPS tracking tags. Ready to export.';
    } else {
      cleanSummary.textContent = 'Select an action above to strip AI tags or GPS tracking.';
    }
  }

  renderMetaTagList();
}

async function handleMetaFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|tiff?)$/i.test(f.name));
  if (files.length === 0) return;

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const rawBytes = new Uint8Array(arrayBuffer);
    const mimeType = file.type || (/\.png$/i.test(file.name) ? 'image/png' : (/\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg'));
    const info = inspectImageMetadata(rawBytes, mimeType);
    const thumbnailUrl = URL.createObjectURL(file);

    metaFilesQueue.push({
      id: 'meta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      file,
      name: file.name,
      size: file.size,
      mimeType,
      rawBytes,
      cleanedBytes: null,
      cleanMode: null,
      info,
      thumbnailUrl
    });
  }

  metaActiveIndex = metaFilesQueue.length - files.length;
  if (metaActiveIndex < 0) metaActiveIndex = 0;

  renderActiveMetadata();
  renderMetadataQueue();
}

function initMetadataEditor() {
  const metaDropzone = $('meta-dropzone');
  const metaFileInput = $('meta-file-input');

  if (metaDropzone && metaFileInput) {
    metaDropzone.onclick = e => {
      if (e.target.tagName !== 'INPUT' && !e.target.closest('label')) {
        metaFileInput.click();
      }
    };

    ['dragenter', 'dragover'].forEach(name => {
      metaDropzone.addEventListener(name, e => {
        e.preventDefault();
        metaDropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      metaDropzone.addEventListener(name, e => {
        e.preventDefault();
        metaDropzone.classList.remove('dragover');
      });
    });

    metaDropzone.addEventListener('drop', e => {
      e.preventDefault();
      metaDropzone.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleMetaFiles(files);
      }
    });

    metaFileInput.onchange = () => {
      if (metaFileInput.files && metaFileInput.files.length > 0) {
        handleMetaFiles(metaFileInput.files);
      }
    };
  }

  // Quick Action Buttons
  const btnStripAi = $('btn-strip-ai');
  if (btnStripAi) {
    btnStripAi.onclick = () => {
      const activeItem = metaFilesQueue[metaActiveIndex];
      if (!activeItem) return;
      activeItem.cleanedBytes = stripImageAiBinary(activeItem.rawBytes, activeItem.mimeType);
      activeItem.cleanMode = 'ai';
      activeItem.info = inspectImageMetadata(activeItem.cleanedBytes, activeItem.mimeType);
      renderActiveMetadata();
      renderMetadataQueue();
    };
  }

  const btnStripGps = $('btn-strip-gps');
  if (btnStripGps) {
    btnStripGps.onclick = () => {
      const activeItem = metaFilesQueue[metaActiveIndex];
      if (!activeItem) return;
      activeItem.cleanedBytes = stripImageGpsBinary(activeItem.rawBytes, activeItem.mimeType);
      activeItem.cleanMode = 'gps';
      activeItem.info = inspectImageMetadata(activeItem.cleanedBytes, activeItem.mimeType);
      renderActiveMetadata();
      renderMetadataQueue();
    };
  }

  const btnStripAll = $('btn-strip-all');
  if (btnStripAll) {
    btnStripAll.onclick = () => {
      const activeItem = metaFilesQueue[metaActiveIndex];
      if (!activeItem) return;
      activeItem.cleanedBytes = stripImageAllBinary(activeItem.rawBytes, activeItem.mimeType, true);
      activeItem.cleanMode = 'all';
      activeItem.info = inspectImageMetadata(activeItem.cleanedBytes, activeItem.mimeType);
      renderActiveMetadata();
      renderMetadataQueue();
    };
  }

  // Download Cleaned Image
  const btnDownloadCleaned = $('btn-download-cleaned');
  if (btnDownloadCleaned) {
    btnDownloadCleaned.onclick = () => {
      const activeItem = metaFilesQueue[metaActiveIndex];
      if (!activeItem) return;
      if (!activeItem.cleanedBytes) {
        activeItem.cleanedBytes = stripImageAiBinary(activeItem.rawBytes, activeItem.mimeType);
        activeItem.cleanMode = 'ai';
        activeItem.info = inspectImageMetadata(activeItem.cleanedBytes, activeItem.mimeType);
        renderActiveMetadata();
        renderMetadataQueue();
      }
      downloadCleanedFile(activeItem);
    };
  }

  // Batch actions
  const btnBatchAi = $('btn-meta-batch-clean-ai');
  if (btnBatchAi) btnBatchAi.onclick = () => batchProcessAndDownload('ai');

  const btnBatchAll = $('btn-meta-batch-strip-all');
  if (btnBatchAll) btnBatchAll.onclick = () => batchProcessAndDownload('all');

  const btnClearAll = $('btn-meta-clear-all');
  if (btnClearAll) btnClearAll.onclick = clearMetadataQueue;

  // Tabs
  const tabs = document.querySelectorAll('[data-metatab]');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      metaActiveTab = tab.getAttribute('data-metatab') || 'summary';
      renderMetaTagList();
    };
  });

  // Search input
  const searchInput = $('meta-tag-search');
  if (searchInput) {
    searchInput.oninput = e => {
      metaSearchTerm = e.target.value.trim().toLowerCase();
      renderMetaTagList();
    };
  }
}

// Initialize metadata editor
initMetadataEditor();



// ============================================================================
// 04. HOLIDAY & GROUP EXPENSE SPLITTER WITH SPLITWISE DEBT SIMPLIFICATION
// ============================================================================

const EXPENSE_STORAGE_KEY = 'toolbox_holiday_trips_v1';

const EXPENSE_CURRENCIES = {
  EUR: { symbol: '€', defaultRateToGbp: 0.855 },
  USD: { symbol: '$', defaultRateToGbp: 0.772 },
  GHS: { symbol: 'GH₵', defaultRateToGbp: 0.053 },
  GBP: { symbol: '£', defaultRateToGbp: 1.0 }
};

const CATEGORY_ICONS = {
  food: '🍽️',
  lodging: '🏠',
  transport: '🚗',
  activities: '🎟️',
  shopping: '🛒',
  other: '✨'
};

const CATEGORY_COLORS = {
  food: '#d97706',
  lodging: '#2563eb',
  transport: '#16a34a',
  activities: '#9333ea',
  shopping: '#e11d48',
  other: '#64748b'
};

const MEMBER_COLORS = [
  '#245342', '#a16207', '#2563eb', '#9333ea', '#c4472f',
  '#0d9488', '#ea580c', '#475569', '#0284c7', '#7c3aed'
];

function formatExpenseAmount(num, currency = 'EUR', gbpRate = 1) {
  const sym = EXPENSE_CURRENCIES[currency]?.symbol || currency;
  const val = Number(num) || 0;
  const formattedLocal = `${sym}${val.toFixed(2)}`;
  if (currency === 'GBP') {
    return { local: formattedLocal, gbp: null, text: formattedLocal };
  }
  const gbpNum = val * (Number(gbpRate) || 1);
  const formattedGbp = `£${gbpNum.toFixed(2)}`;
  return {
    local: formattedLocal,
    gbp: formattedGbp,
    text: `${formattedLocal} (~${formattedGbp})`
  };
}

function createDefaultTrip() {
  return {
    id: 'trip_' + Date.now(),
    title: '🏖️ Summer Holiday 2026',
    currency: 'EUR',
    gbpRate: 0.855,
    startDate: '',
    endDate: '',
    members: [
      { id: 'm_1', name: 'Jesse', color: MEMBER_COLORS[0] },
      { id: 'm_2', name: 'Alex', color: MEMBER_COLORS[1] },
      { id: 'm_3', name: 'Sam', color: MEMBER_COLORS[2] },
      { id: 'm_4', name: 'Chloe', color: MEMBER_COLORS[3] }
    ],
    expenses: [
      {
        id: 'exp_1',
        description: 'Villa Airbnb',
        amount: 400,
        paidBy: 'm_1',
        category: 'lodging',
        date: new Date().toISOString().slice(0, 10),
        splitMode: 'equal',
        participants: [
          { memberId: 'm_1', amount: 100 },
          { memberId: 'm_2', amount: 100 },
          { memberId: 'm_3', amount: 100 },
          { memberId: 'm_4', amount: 100 }
        ]
      },
      {
        id: 'exp_2',
        description: 'Tapas & Sangria',
        amount: 120,
        paidBy: 'm_2',
        category: 'food',
        date: new Date().toISOString().slice(0, 10),
        splitMode: 'equal',
        participants: [
          { memberId: 'm_1', amount: 30 },
          { memberId: 'm_2', amount: 30 },
          { memberId: 'm_3', amount: 30 },
          { memberId: 'm_4', amount: 30 }
        ]
      }
    ],
    settledTransfers: []
  };
}

let currentTrip = null;
let activeSplitMode = 'equal';
let simplifyDebtsActive = true;

function loadTripFromStorage() {
  try {
    const raw = localStorage.getItem(EXPENSE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load trip from storage:', err);
  }
  return null;
}

function saveTripToStorage() {
  if (!currentTrip) return;
  try {
    localStorage.setItem(EXPENSE_STORAGE_KEY, JSON.stringify(currentTrip));
  } catch (err) {
    console.error('Failed to save trip to storage:', err);
  }
}

// ---------------- Financial Calculations ----------------
function calculateNetBalances(members, expenses) {
  const balances = {};
  for (const m of members) balances[m.id] = 0;

  for (const exp of expenses) {
    const amount = Number(exp.amount) || 0;
    const payerId = exp.paidBy;

    if (balances[payerId] !== undefined) {
      balances[payerId] += amount;
    }

    const participants = exp.participants || [];
    for (const p of participants) {
      if (balances[p.memberId] !== undefined) {
        balances[p.memberId] -= Number(p.amount) || 0;
      }
    }
  }

  for (const id in balances) {
    balances[id] = Math.round(balances[id] * 100) / 100;
  }
  return balances;
}

// Splitwise "Simplify Debts" Algorithm (Min-Cash-Flow Greedy Solver)
function simplifyDebts(balances, membersMap) {
  const creditors = [];
  const debtors = [];

  for (const [id, bal] of Object.entries(balances)) {
    if (bal > 0.005) {
      creditors.push({ id, name: membersMap[id]?.name || id, amount: bal });
    } else if (bal < -0.005) {
      debtors.push({ id, name: membersMap[id]?.name || id, amount: -bal });
    }
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let cIdx = 0;
  let dIdx = 0;

  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const transferAmount = Math.min(creditor.amount, debtor.amount);
    const rounded = Math.round(transferAmount * 100) / 100;

    if (rounded > 0) {
      transfers.push({
        key: `${debtor.id}_to_${creditor.id}_${rounded}`,
        fromId: debtor.id,
        fromName: debtor.name,
        toId: creditor.id,
        toName: creditor.name,
        amount: rounded
      });
    }

    creditor.amount = Math.round((creditor.amount - transferAmount) * 100) / 100;
    debtor.amount = Math.round((debtor.amount - transferAmount) * 100) / 100;

    if (creditor.amount < 0.005) cIdx++;
    if (debtor.amount < 0.005) dIdx++;
  }

  return transfers;
}

function calculateDirectDebts(trip, membersMap) {
  const pairDebts = {}; // key: "from_to" -> amount

  for (const exp of trip.expenses) {
    const payerId = exp.paidBy;
    const participants = exp.participants || [];
    for (const p of participants) {
      if (p.memberId !== payerId) {
        const from = p.memberId;
        const to = payerId;
        const amt = Number(p.amount) || 0;
        const key = `${from}__${to}`;
        const revKey = `${to}__${from}`;

        if (pairDebts[revKey]) {
          if (pairDebts[revKey] > amt) {
            pairDebts[revKey] -= amt;
          } else {
            const rem = amt - pairDebts[revKey];
            delete pairDebts[revKey];
            if (rem > 0) pairDebts[key] = (pairDebts[key] || 0) + rem;
          }
        } else {
          pairDebts[key] = (pairDebts[key] || 0) + amt;
        }
      }
    }
  }

  const transfers = [];
  for (const [key, amt] of Object.entries(pairDebts)) {
    const rounded = Math.round(amt * 100) / 100;
    if (rounded > 0.005) {
      const [fromId, toId] = key.split('__');
      transfers.push({
        key: `${fromId}_to_${toId}_${rounded}`,
        fromId,
        fromName: membersMap[fromId]?.name || fromId,
        toId,
        toName: membersMap[toId]?.name || toId,
        amount: rounded
      });
    }
  }

  transfers.sort((a, b) => b.amount - a.amount);
  return transfers;
}

function calculateCategoryBreakdown(expenses) {
  const totals = {};
  let totalSpent = 0;

  for (const exp of expenses) {
    const cat = exp.category || 'other';
    const amt = Number(exp.amount) || 0;
    totals[cat] = (totals[cat] || 0) + amt;
    totalSpent += amt;
  }

  const breakdown = [];
  for (const [cat, amt] of Object.entries(totals)) {
    const pct = totalSpent > 0 ? Math.round((amt / totalSpent) * 100) : 0;
    breakdown.push({ category: cat, amount: amt, percent: pct });
  }

  breakdown.sort((a, b) => b.amount - a.amount);
  return { breakdown, totalSpent };
}

function calculateDailyBurnRate(expenses, startDateStr, endDateStr, membersCount) {
  let days = 1;
  if (startDateStr && endDateStr) {
    const d1 = new Date(startDateStr);
    const d2 = new Date(endDateStr);
    const diffTime = d2.getTime() - d1.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 0) days = diffDays;
  } else if (expenses.length > 0) {
    const dates = expenses.map(e => e.date).filter(Boolean).sort();
    if (dates.length >= 2) {
      const d1 = new Date(dates[0]);
      const d2 = new Date(dates[dates.length - 1]);
      const diffTime = d2.getTime() - d1.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 0) days = diffDays;
    }
  }

  const totalSpent = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const groupDaily = days > 0 ? (totalSpent / days) : totalSpent;
  const personDaily = (membersCount > 0 && days > 0) ? (totalSpent / (days * membersCount)) : groupDaily;

  return { days, groupDaily, personDaily };
}

function parseSmartPasteLines(text, members) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsed = [];

  for (const line of lines) {
    const amtMatch = line.match(/(?:[€$£]|GH₵)?\s*(\d+(?:\.\d{1,2})?)/);
    if (!amtMatch) continue;

    const amount = parseFloat(amtMatch[1]);
    const withoutAmount = line.replace(amtMatch[0], ' ').trim();

    let foundMember = null;
    let description = withoutAmount;

    for (const m of members) {
      const regex = new RegExp(`\\b${m.name}\\b`, 'i');
      if (regex.test(withoutAmount)) {
        foundMember = m;
        description = withoutAmount.replace(regex, '').replace(/paid|for|by/gi, ' ').trim();
        break;
      }
    }

    if (!description) description = 'Expense';

    // Infer category
    let category = 'other';
    const lower = description.toLowerCase();
    if (/tapas|dinner|lunch|breakfast|food|drinks|bar|beer|sangria|restaurant|coffee|cafe|pizza/i.test(lower)) {
      category = 'food';
    } else if (/villa|airbnb|hotel|room|resort|hostel/i.test(lower)) {
      category = 'lodging';
    } else if (/taxi|uber|fuel|gas|petrol|flight|train|car|bus|toll/i.test(lower)) {
      category = 'transport';
    } else if (/tour|tickets|museum|boat|show|club|activity/i.test(lower)) {
      category = 'activities';
    } else if (/groceries|market|supermarket|shop|shopping/i.test(lower)) {
      category = 'shopping';
    }

    parsed.push({
      description,
      amount,
      paidBy: foundMember ? foundMember.id : members[0]?.id,
      category
    });
  }

  return parsed;
}

function generateWhatsAppSummary(trip, simplified = true) {
  const rate = Number(trip.gbpRate) || 1;
  const totalSpent = trip.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const avgPerson = trip.members.length > 0 ? (totalSpent / trip.members.length) : 0;

  const totalFmt = formatExpenseAmount(totalSpent, trip.currency, rate).text;
  const avgFmt = formatExpenseAmount(avgPerson, trip.currency, rate).text;

  const membersMap = Object.fromEntries(trip.members.map(m => [m.id, m]));
  const netBalances = calculateNetBalances(trip.members, trip.expenses);
  const transfers = simplified ? simplifyDebts(netBalances, membersMap) : calculateDirectDebts(trip, membersMap);

  let msg = `🌴 *${trip.title} — Holiday Expense Summary*\n`;
  msg += `💰 *Total Trip Spend:* ${totalFmt}\n`;
  msg += `👥 *Average Per Person:* ${avgFmt}\n`;
  msg += `📝 *Total Expenses Logged:* ${trip.expenses.length}\n\n`;

  msg += `📊 *Individual Balances:*\n`;
  for (const m of trip.members) {
    const bal = netBalances[m.id] || 0;
    const absFmt = formatExpenseAmount(Math.abs(bal), trip.currency, rate).text;
    if (bal > 0.005) {
      msg += `• ${m.name}: +${absFmt} (gets back 🟢)\n`;
    } else if (bal < -0.005) {
      msg += `• ${m.name}: -${absFmt} (owes 🔴)\n`;
    } else {
      msg += `• ${m.name}: Settled up ⚪\n`;
    }
  }

  msg += `\n🤝 *How to Settle Up (${simplified ? 'Simplest Route' : 'Direct Payments'}):*\n`;
  if (transfers.length === 0) {
    msg += `🎉 All settled up! No payments needed.\n`;
  } else {
    transfers.forEach((t, i) => {
      const amtFmt = formatExpenseAmount(t.amount, trip.currency, rate).text;
      msg += `${i + 1}. *${t.fromName}* pays *${t.toName}*: ${amtFmt}\n`;
    });
  }

  msg += `\n_Generated with Jesse's Toolbox_`;
  return msg;
}

// ---------------- UI Rendering ----------------
function renderAllocationsBox() {
  const container = $('expense-allocations-container');
  const statusEl = $('expense-alloc-status');
  if (!container || !currentTrip) return;

  const totalAmount = parseFloat($('exp-amount')?.value) || 0;
  const members = currentTrip.members;
  const sym = EXPENSE_CURRENCIES[currentTrip.currency]?.symbol || currentTrip.currency;

  container.innerHTML = '';

  if (activeSplitMode === 'equal') {
    statusEl.textContent = 'Split equally among all checked friends.';
    statusEl.className = 'expense-alloc-status status-ok';

    members.forEach(m => {
      const row = document.createElement('div');
      row.className = 'alloc-row';
      row.innerHTML = `
        <label class="alloc-left" style="cursor:pointer">
          <input type="checkbox" class="alloc-member-check" data-member-id="${m.id}" checked>
          <span class="alloc-avatar" style="background:${m.color}">${m.name.slice(0, 2).toUpperCase()}</span>
          <span class="alloc-name">${m.name}</span>
        </label>
        <span class="alloc-equal-share" id="alloc-share-${m.id}">-</span>
      `;
      container.appendChild(row);
    });

    updateEqualSharePreviews();
  } else if (activeSplitMode === 'exact') {
    statusEl.textContent = `Enter exact amounts (Total: ${sym}${totalAmount.toFixed(2)})`;
    statusEl.className = 'expense-alloc-status';

    members.forEach(m => {
      const row = document.createElement('div');
      row.className = 'alloc-row';
      row.innerHTML = `
        <div class="alloc-left">
          <span class="alloc-avatar" style="background:${m.color}">${m.name.slice(0, 2).toUpperCase()}</span>
          <span class="alloc-name">${m.name}</span>
        </div>
        <div class="alloc-input-wrap">
          <span class="alloc-unit">${sym}</span>
          <input type="number" step="0.01" min="0" class="alloc-input alloc-exact-val" data-member-id="${m.id}" placeholder="0.00">
        </div>
      `;
      container.appendChild(row);
    });

    attachAllocInputListeners('exact');
  } else if (activeSplitMode === 'percent') {
    statusEl.textContent = 'Enter percentages (must total 100%)';
    statusEl.className = 'expense-alloc-status';

    members.forEach(m => {
      const row = document.createElement('div');
      row.className = 'alloc-row';
      row.innerHTML = `
        <div class="alloc-left">
          <span class="alloc-avatar" style="background:${m.color}">${m.name.slice(0, 2).toUpperCase()}</span>
          <span class="alloc-name">${m.name}</span>
        </div>
        <div class="alloc-input-wrap">
          <input type="number" step="1" min="0" max="100" class="alloc-input alloc-pct-val" data-member-id="${m.id}" placeholder="0">
          <span class="alloc-unit">%</span>
        </div>
      `;
      container.appendChild(row);
    });

    attachAllocInputListeners('percent');
  } else if (activeSplitMode === 'shares') {
    statusEl.textContent = 'Enter shares (e.g. 2 for couples, 1 for singles)';
    statusEl.className = 'expense-alloc-status';

    members.forEach(m => {
      const row = document.createElement('div');
      row.className = 'alloc-row';
      row.innerHTML = `
        <div class="alloc-left">
          <span class="alloc-avatar" style="background:${m.color}">${m.name.slice(0, 2).toUpperCase()}</span>
          <span class="alloc-name">${m.name}</span>
        </div>
        <div class="alloc-input-wrap">
          <input type="number" step="1" min="0" class="alloc-input alloc-shares-val" data-member-id="${m.id}" value="1">
          <span class="alloc-unit">shares</span>
        </div>
      `;
      container.appendChild(row);
    });

    attachAllocInputListeners('shares');
  }
}

function updateEqualSharePreviews() {
  const total = parseFloat($('exp-amount')?.value) || 0;
  const sym = EXPENSE_CURRENCIES[currentTrip.currency]?.symbol || currentTrip.currency;
  const checks = document.querySelectorAll('.alloc-member-check:checked');
  const count = checks.length;
  const share = count > 0 ? (total / count) : 0;

  document.querySelectorAll('.alloc-member-check').forEach(chk => {
    const id = chk.getAttribute('data-member-id');
    const span = $(`alloc-share-${id}`);
    if (span) {
      span.textContent = chk.checked ? `${sym}${share.toFixed(2)}` : 'Excluded';
      span.style.color = chk.checked ? 'var(--ink)' : 'var(--muted)';
    }
  });
}

function attachAllocInputListeners(mode) {
  const inputs = document.querySelectorAll('.alloc-input');
  inputs.forEach(inp => {
    inp.oninput = () => validateAllocations(mode);
  });
  validateAllocations(mode);
}

function validateAllocations(mode) {
  const statusEl = $('expense-alloc-status');
  const totalAmount = parseFloat($('exp-amount')?.value) || 0;
  const sym = EXPENSE_CURRENCIES[currentTrip.currency]?.symbol || currentTrip.currency;

  if (mode === 'exact') {
    let sum = 0;
    document.querySelectorAll('.alloc-exact-val').forEach(inp => {
      sum += parseFloat(inp.value) || 0;
    });
    sum = Math.round(sum * 100) / 100;
    const diff = Math.round((totalAmount - sum) * 100) / 100;

    if (Math.abs(diff) < 0.01) {
      statusEl.textContent = `✓ Exact match: ${sym}${sum.toFixed(2)} allocated.`;
      statusEl.className = 'expense-alloc-status status-ok';
      return true;
    } else if (diff > 0) {
      statusEl.textContent = `Remaining to allocate: ${sym}${diff.toFixed(2)} (Total: ${sym}${totalAmount.toFixed(2)})`;
      statusEl.className = 'expense-alloc-status status-err';
      return false;
    } else {
      statusEl.textContent = `Allocated ${sym}${Math.abs(diff).toFixed(2)} too much! (Total: ${sym}${totalAmount.toFixed(2)})`;
      statusEl.className = 'expense-alloc-status status-err';
      return false;
    }
  } else if (mode === 'percent') {
    let sumPct = 0;
    document.querySelectorAll('.alloc-pct-val').forEach(inp => {
      sumPct += parseFloat(inp.value) || 0;
    });
    if (sumPct === 100) {
      statusEl.textContent = `✓ 100% allocated.`;
      statusEl.className = 'expense-alloc-status status-ok';
      return true;
    } else {
      statusEl.textContent = `Total: ${sumPct}% (needs to equal 100%)`;
      statusEl.className = 'expense-alloc-status status-err';
      return false;
    }
  } else if (mode === 'shares') {
    let sumShares = 0;
    document.querySelectorAll('.alloc-shares-val').forEach(inp => {
      sumShares += parseInt(inp.value, 10) || 0;
    });
    statusEl.textContent = `Total: ${sumShares} shares.`;
    statusEl.className = 'expense-alloc-status status-ok';
    return sumShares > 0;
  }
  return true;
}

function renderExpenseSplitter() {
  if (!currentTrip) currentTrip = loadTripFromStorage() || createDefaultTrip();

  const sym = EXPENSE_CURRENCIES[currentTrip.currency]?.symbol || currentTrip.currency;
  const isGbp = currentTrip.currency === 'GBP';
  const rate = Number(currentTrip.gbpRate) || 1;

  // 1. Trip Header Controls
  const titleInput = $('trip-title-input');
  if (titleInput) titleInput.value = currentTrip.title;

  const curSelect = $('trip-currency-select');
  if (curSelect) curSelect.value = currentTrip.currency;

  const rateWrap = $('expense-rate-wrap');
  if (rateWrap) rateWrap.hidden = isGbp;

  const rateSymbolLabel = $('rate-symbol-label');
  if (rateSymbolLabel) rateSymbolLabel.textContent = sym;

  const rateInput = $('trip-gbp-rate');
  if (rateInput) rateInput.value = currentTrip.gbpRate;

  const startDateInput = $('trip-start-date');
  if (startDateInput) startDateInput.value = currentTrip.startDate || '';

  const endDateInput = $('trip-end-date');
  if (endDateInput) endDateInput.value = currentTrip.endDate || '';

  document.querySelectorAll('.exp-cur-symbol').forEach(el => el.textContent = sym);

  // 2. Members Bar
  const membersCount = $('members-count');
  if (membersCount) membersCount.textContent = currentTrip.members.length;

  const chipsContainer = $('expense-members-chips');
  if (chipsContainer) {
    chipsContainer.innerHTML = '';
    currentTrip.members.forEach((m, idx) => {
      const chip = document.createElement('div');
      chip.className = 'member-chip';
      chip.innerHTML = `
        <span class="member-chip-avatar" style="background:${m.color}">${m.name.slice(0, 2).toUpperCase()}</span>
        <span class="member-chip-name">${m.name}</span>
        ${currentTrip.members.length > 2 ? `<button type="button" class="member-chip-del" data-member-idx="${idx}" title="Remove friend">✕</button>` : ''}
      `;
      chipsContainer.appendChild(chip);
    });

    chipsContainer.querySelectorAll('.member-chip-del').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-member-idx'), 10);
        const removed = currentTrip.members[idx];
        if (confirm(`Remove ${removed.name} from this trip?`)) {
          currentTrip.members.splice(idx, 1);
          saveTripToStorage();
          renderExpenseSplitter();
        }
      };
    });
  }

  // Payer dropdown in Add Form
  const payerSelect = $('exp-payer');
  if (payerSelect) {
    const curVal = payerSelect.value;
    payerSelect.innerHTML = '';
    currentTrip.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      payerSelect.appendChild(opt);
    });
    if (curVal && currentTrip.members.some(m => m.id === curVal)) {
      payerSelect.value = curVal;
    }
  }

  // 3. Overview Metrics
  const totalSpent = currentTrip.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const avgPerson = currentTrip.members.length > 0 ? (totalSpent / currentTrip.members.length) : 0;

  const totalFmt = formatExpenseAmount(totalSpent, currentTrip.currency, rate);
  const avgFmt = formatExpenseAmount(avgPerson, currentTrip.currency, rate);

  $('stat-total-spent').textContent = totalFmt.local;
  $('stat-total-spent-gbp').textContent = totalFmt.gbp ? `~${totalFmt.gbp}` : '';

  $('stat-avg-person').textContent = avgFmt.local;
  $('stat-avg-person-gbp').textContent = avgFmt.gbp ? `~${avgFmt.gbp}` : '';

  $('stat-expenses-count').textContent = currentTrip.expenses.length;
  $('stat-expenses-sub').textContent = `${currentTrip.expenses.length} transaction${currentTrip.expenses.length === 1 ? '' : 's'}`;

  // 4. Balances & Settlement Calculations
  const membersMap = Object.fromEntries(currentTrip.members.map(m => [m.id, m]));
  const netBalances = calculateNetBalances(currentTrip.members, currentTrip.expenses);

  const transfers = simplifyDebtsActive
    ? simplifyDebts(netBalances, membersMap)
    : calculateDirectDebts(currentTrip, membersMap);

  $('stat-settlement-count').textContent = transfers.length;

  // Render Settlement Cards ("Who Owes Whom")
  const transfersList = $('settlement-transfers-list');
  const settlementSub = $('settlement-subtext');
  if (transfersList) {
    transfersList.innerHTML = '';
    if (transfers.length === 0) {
      transfersList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;font-weight:600">🎉 All settled up! No outstanding debts in this trip.</div>';
      if (settlementSub) settlementSub.textContent = 'Everyone has paid their exact share.';
    } else {
      if (settlementSub) {
        settlementSub.textContent = simplifyDebtsActive
          ? `Optimal: Settle entire trip in only ${transfers.length} payment${transfers.length === 1 ? '' : 's'} (Splitwise engine)`
          : `Direct non-simplified transfers between individuals (${transfers.length} payments)`;
      }

      transfers.forEach(t => {
        const card = document.createElement('div');
        const isPaid = currentTrip.settledTransfers.includes(t.key);
        card.className = 'transfer-card' + (isPaid ? ' is-paid' : '');

        const amtFmt = formatExpenseAmount(t.amount, currentTrip.currency, rate);
        card.innerHTML = `
          <div class="transfer-parties">
            <span class="transfer-party">${t.fromName}</span>
            <span class="transfer-arrow">➔</span>
            <span class="transfer-party">${t.toName}</span>
          </div>
          <div class="transfer-actions">
            <div class="transfer-amounts">
              <span class="transfer-primary">${amtFmt.local}</span>
              ${amtFmt.gbp ? `<span class="transfer-secondary">~${amtFmt.gbp}</span>` : ''}
            </div>
            <label title="Mark this transfer as paid" style="display:flex;align-items:center;cursor:pointer;gap:4px;font-size:11px;font-weight:700">
              <input type="checkbox" class="transfer-paid-checkbox" data-transfer-key="${t.key}" ${isPaid ? 'checked' : ''}>
              <span class="transfer-paid-label">${isPaid ? 'Paid ✓' : 'Mark'}</span>
            </label>
          </div>
        `;
        transfersList.appendChild(card);
      });

      transfersList.querySelectorAll('.transfer-paid-checkbox').forEach(chk => {
        chk.onchange = () => {
          const key = chk.getAttribute('data-transfer-key');
          if (chk.checked) {
            if (!currentTrip.settledTransfers.includes(key)) currentTrip.settledTransfers.push(key);
          } else {
            currentTrip.settledTransfers = currentTrip.settledTransfers.filter(k => k !== key);
          }
          saveTripToStorage();
          renderExpenseSplitter();
        };
      });
    }
  }

  // Render Balances Card
  const balancesList = $('expense-balances-list');
  if (balancesList) {
    balancesList.innerHTML = '';
    currentTrip.members.forEach(m => {
      const bal = netBalances[m.id] || 0;
      const isCreditor = bal > 0.005;
      const isDebtor = bal < -0.005;

      const row = document.createElement('div');
      row.className = 'balance-row' + (isCreditor ? ' is-creditor' : (isDebtor ? ' is-debtor' : ''));

      const absFmt = formatExpenseAmount(Math.abs(bal), currentTrip.currency, rate);
      const sign = isCreditor ? '+' : (isDebtor ? '-' : '');
      const cls = isCreditor ? 'text-creditor' : (isDebtor ? 'text-debtor' : '');
      const statusTag = isCreditor ? 'gets back' : (isDebtor ? 'owes' : 'settled');

      row.innerHTML = `
        <div class="balance-person">
          <span class="alloc-avatar" style="background:${m.color}">${m.name.slice(0, 2).toUpperCase()}</span>
          <span>${m.name}</span>
        </div>
        <div class="balance-figures">
          <span class="balance-main ${cls}">${sign}${absFmt.local} <span style="font-size:10px;font-weight:600;opacity:0.85">(${statusTag})</span></span>
          ${absFmt.gbp ? `<span class="balance-sub">~${sign}${absFmt.gbp}</span>` : ''}
        </div>
      `;
      balancesList.appendChild(row);
    });
  }

  // 5. Expense History Ledger
  $('ledger-count').textContent = currentTrip.expenses.length;
  const ledgerList = $('expense-ledger-list');
  if (ledgerList) {
    ledgerList.innerHTML = '';
    if (currentTrip.expenses.length === 0) {
      ledgerList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;font-weight:600">No expenses recorded yet. Add your first expense above!</div>';
    } else {
      // Sort newest first
      const sortedExps = [...currentTrip.expenses].reverse();
      sortedExps.forEach(exp => {
        const item = document.createElement('div');
        item.className = 'expense-ledger-item';

        const icon = CATEGORY_ICONS[exp.category] || '✨';
        const payerName = membersMap[exp.paidBy]?.name || 'Unknown';
        const amtFmt = formatExpenseAmount(exp.amount, currentTrip.currency, rate);

        let splitInfo = 'split equally';
        if (exp.splitMode === 'exact') splitInfo = 'custom exact split';
        else if (exp.splitMode === 'percent') splitInfo = 'custom % split';
        else if (exp.splitMode === 'shares') splitInfo = 'custom shares split';
        else if (exp.participants?.length < currentTrip.members.length) {
          splitInfo = `split (${exp.participants.length} of ${currentTrip.members.length} friends)`;
        }

        item.innerHTML = `
          <div class="exp-item-left">
            <span class="exp-cat-badge">${icon}</span>
            <div class="exp-item-info">
              <span class="exp-desc-line">${exp.description}</span>
              <span class="exp-meta-line">Paid by <strong>${payerName}</strong> · ${splitInfo} · ${exp.date || 'Today'}</span>
            </div>
          </div>
          <div class="exp-item-right">
            <div class="exp-amount-block">
              <span class="exp-local-amt">${amtFmt.local}</span>
              ${amtFmt.gbp ? `<span class="exp-gbp-amt">~${amtFmt.gbp}</span>` : ''}
            </div>
            <button type="button" class="exp-delete-btn" data-exp-id="${exp.id}" title="Delete expense">✕</button>
          </div>
        `;
        ledgerList.appendChild(item);
      });

      ledgerList.querySelectorAll('.exp-delete-btn').forEach(btn => {
        btn.onclick = () => {
          const expId = btn.getAttribute('data-exp-id');
          currentTrip.expenses = currentTrip.expenses.filter(e => e.id !== expId);
          saveTripToStorage();
          renderExpenseSplitter();
        };
      });
    }
  }

  // 6. Analytics: Category Breakdown & Burn Rate (#5)
  const catData = calculateCategoryBreakdown(currentTrip.expenses);
  const catContainer = $('category-bars-container');
  if (catContainer) {
    catContainer.innerHTML = '';
    if (catData.breakdown.length === 0) {
      catContainer.innerHTML = '<span style="font-size:11px;color:var(--muted)">No category data yet.</span>';
    } else {
      catData.breakdown.forEach(cat => {
        const row = document.createElement('div');
        row.className = 'cat-row';
        const icon = CATEGORY_ICONS[cat.category] || '✨';
        const color = CATEGORY_COLORS[cat.category] || '#245342';
        const catFmt = formatExpenseAmount(cat.amount, currentTrip.currency, rate);

        row.innerHTML = `
          <div class="cat-row-top">
            <span>${icon} ${cat.category.toUpperCase()}</span>
            <span>${catFmt.local} (${cat.percent}%)</span>
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${cat.percent}%;background:${color}"></div>
          </div>
        `;
        catContainer.appendChild(row);
      });
    }
  }

  // Burn rate
  const burn = calculateDailyBurnRate(currentTrip.expenses, currentTrip.startDate, currentTrip.endDate, currentTrip.members.length);
  const groupDailyFmt = formatExpenseAmount(burn.groupDaily, currentTrip.currency, rate);
  const personDailyFmt = formatExpenseAmount(burn.personDaily, currentTrip.currency, rate);

  $('burn-daily-group').textContent = `${groupDailyFmt.local} / day`;
  $('burn-daily-group-gbp').textContent = groupDailyFmt.gbp ? `~${groupDailyFmt.gbp} / day (${burn.days} days)` : `(${burn.days} days)`;

  $('burn-daily-person').textContent = `${personDailyFmt.local} / day`;
  $('burn-daily-person-gbp').textContent = personDailyFmt.gbp ? `~${personDailyFmt.gbp} / person / day` : '';

  renderAllocationsBox();
}

// ---------------- Initialize & Event Listeners ----------------
function initExpenseSplitter() {
  currentTrip = loadTripFromStorage() || createDefaultTrip();

  // Trip header listeners
  const titleInput = $('trip-title-input');
  if (titleInput) {
    titleInput.oninput = () => {
      currentTrip.title = titleInput.value.trim() || 'Holiday Trip';
      saveTripToStorage();
    };
  }

  const curSelect = $('trip-currency-select');
  if (curSelect) {
    curSelect.onchange = () => {
      const newCur = curSelect.value;
      currentTrip.currency = newCur;
      currentTrip.gbpRate = EXPENSE_CURRENCIES[newCur]?.defaultRateToGbp || 1.0;
      saveTripToStorage();
      renderExpenseSplitter();
    };
  }

  const rateInput = $('trip-gbp-rate');
  if (rateInput) {
    rateInput.oninput = () => {
      currentTrip.gbpRate = parseFloat(rateInput.value) || 1.0;
      saveTripToStorage();
      renderExpenseSplitter();
    };
  }

  const startDateInput = $('trip-start-date');
  const endDateInput = $('trip-end-date');
  if (startDateInput && endDateInput) {
    startDateInput.onchange = () => {
      currentTrip.startDate = startDateInput.value;
      saveTripToStorage();
      renderExpenseSplitter();
    };
    endDateInput.onchange = () => {
      currentTrip.endDate = endDateInput.value;
      saveTripToStorage();
      renderExpenseSplitter();
    };
  }

  // Trip actions: New, Export, Import
  const btnNewTrip = $('btn-new-trip');
  if (btnNewTrip) {
    btnNewTrip.onclick = () => {
      const name = prompt('Enter a name for the new trip (e.g. 🌴 Barcelona 2026):', '🏖️ New Trip');
      if (name) {
        currentTrip = createDefaultTrip();
        currentTrip.title = name;
        currentTrip.expenses = [];
        currentTrip.settledTransfers = [];
        saveTripToStorage();
        renderExpenseSplitter();
      }
    };
  }

  const btnExportJson = $('btn-export-trip-json');
  if (btnExportJson) {
    btnExportJson.onclick = () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentTrip, null, 2));
      const dl = document.createElement('a');
      dl.setAttribute('href', dataStr);
      dl.setAttribute('download', `${currentTrip.title.replace(/[^a-z0-9]/gi, '_')}_expenses.json`);
      dl.click();
    };
  }

  const inputImport = $('input-import-trip-json');
  if (inputImport) {
    inputImport.onchange = e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (imported.members && Array.isArray(imported.members)) {
            currentTrip = imported;
            saveTripToStorage();
            renderExpenseSplitter();
            alert('✓ Trip successfully imported!');
          }
        } catch (err) {
          alert('Could not parse trip JSON file.');
        }
      };
      reader.readAsText(file);
    };
  }

  // Add Member
  const btnAddMember = $('btn-add-member');
  const newMemberInput = $('new-member-name');
  if (btnAddMember && newMemberInput) {
    const handleAdd = () => {
      const name = newMemberInput.value.trim();
      if (!name) return;
      const color = MEMBER_COLORS[currentTrip.members.length % MEMBER_COLORS.length];
      currentTrip.members.push({
        id: 'm_' + Date.now(),
        name,
        color
      });
      newMemberInput.value = '';
      saveTripToStorage();
      renderExpenseSplitter();
    };
    btnAddMember.onclick = handleAdd;
    newMemberInput.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdd();
      }
    };
  }

  // Mode Tabs
  const tabForm = $('tab-entry-form');
  const tabPaste = $('tab-entry-paste');
  const formPanel = $('expense-form-panel');
  const pastePanel = $('expense-paste-panel');

  if (tabForm && tabPaste) {
    tabForm.onclick = () => {
      tabForm.classList.add('active');
      tabPaste.classList.remove('active');
      formPanel.hidden = false;
      pastePanel.hidden = true;
    };
    tabPaste.onclick = () => {
      tabPaste.classList.add('active');
      tabForm.classList.remove('active');
      formPanel.hidden = true;
      pastePanel.hidden = false;
    };
  }

  // Split Mode Tabs
  const splitTabs = document.querySelectorAll('.split-tab');
  splitTabs.forEach(tab => {
    tab.onclick = () => {
      splitTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeSplitMode = tab.getAttribute('data-splitmode') || 'equal';
      renderAllocationsBox();
    };
  });

  const amountInput = $('exp-amount');
  if (amountInput) {
    amountInput.oninput = () => {
      if (activeSplitMode === 'equal') updateEqualSharePreviews();
      else validateAllocations(activeSplitMode);
    };
  }

  // Add Expense Form Submit
  const expenseForm = $('expense-add-form');
  if (expenseForm) {
    expenseForm.onsubmit = e => {
      e.preventDefault();

      const desc = $('exp-description').value.trim();
      const amount = parseFloat($('exp-amount').value);
      const payerId = $('exp-payer').value;
      const category = $('exp-category').value;
      const date = $('exp-date').value || new Date().toISOString().slice(0, 10);

      if (!desc || isNaN(amount) || amount <= 0) {
        alert('Please enter a valid description and amount.');
        return;
      }

      let participants = [];

      if (activeSplitMode === 'equal') {
        const checked = Array.from(document.querySelectorAll('.alloc-member-check:checked'));
        if (checked.length === 0) {
          alert('Please select at least one friend to split this expense.');
          return;
        }

        const count = checked.length;
        const totalCents = Math.round(amount * 100);
        const baseCents = Math.floor(totalCents / count);
        let remCents = totalCents % count;

        participants = checked.map(chk => {
          const mId = chk.getAttribute('data-member-id');
          const extra = remCents > 0 ? 1 : 0;
          if (remCents > 0) remCents--;
          return {
            memberId: mId,
            amount: (baseCents + extra) / 100
          };
        });
      } else if (activeSplitMode === 'exact') {
        let sum = 0;
        const inputs = Array.from(document.querySelectorAll('.alloc-exact-val'));
        participants = inputs.map(inp => {
          const val = parseFloat(inp.value) || 0;
          sum += val;
          return { memberId: inp.getAttribute('data-member-id'), amount: Math.round(val * 100) / 100 };
        }).filter(p => p.amount > 0);

        sum = Math.round(sum * 100) / 100;
        if (Math.abs(amount - sum) > 0.01) {
          alert(`Allocated amounts (${sum.toFixed(2)}) must exactly equal the total expense amount (${amount.toFixed(2)}).`);
          return;
        }
      } else if (activeSplitMode === 'percent') {
        let sumPct = 0;
        const inputs = Array.from(document.querySelectorAll('.alloc-pct-val'));
        inputs.forEach(inp => sumPct += (parseFloat(inp.value) || 0));

        if (sumPct !== 100) {
          alert(`Percentages must equal exactly 100% (currently ${sumPct}%).`);
          return;
        }

        participants = inputs.map(inp => {
          const pct = parseFloat(inp.value) || 0;
          return {
            memberId: inp.getAttribute('data-member-id'),
            amount: Math.round((amount * (pct / 100)) * 100) / 100
          };
        }).filter(p => p.amount > 0);
      } else if (activeSplitMode === 'shares') {
        const inputs = Array.from(document.querySelectorAll('.alloc-shares-val'));
        let totalShares = 0;
        inputs.forEach(inp => totalShares += (parseInt(inp.value, 10) || 0));

        if (totalShares <= 0) {
          alert('Total shares must be greater than zero.');
          return;
        }

        let allocatedCents = 0;
        const totalCents = Math.round(amount * 100);

        participants = inputs.map((inp, idx) => {
          const s = parseInt(inp.value, 10) || 0;
          if (idx === inputs.length - 1) {
            // Give remaining to last participant to guarantee exact sum
            return {
              memberId: inp.getAttribute('data-member-id'),
              amount: (totalCents - allocatedCents) / 100
            };
          }
          const shareCents = Math.round((totalCents * (s / totalShares)));
          allocatedCents += shareCents;
          return {
            memberId: inp.getAttribute('data-member-id'),
            amount: shareCents / 100
          };
        }).filter(p => p.amount > 0);
      }

      currentTrip.expenses.push({
        id: 'exp_' + Date.now(),
        description: desc,
        amount,
        paidBy: payerId,
        category,
        date,
        splitMode: activeSplitMode,
        participants
      });

      $('exp-description').value = '';
      $('exp-amount').value = '';

      saveTripToStorage();
      renderExpenseSplitter();
    };
  }

  // Parse Smart Paste
  const btnParsePaste = $('btn-parse-paste');
  const pasteInput = $('expense-paste-input');
  const pasteFeedback = $('expense-paste-feedback');
  if (btnParsePaste && pasteInput) {
    btnParsePaste.onclick = () => {
      const text = pasteInput.value.trim();
      if (!text) return;

      const parsed = parseSmartPasteLines(text, currentTrip.members);
      if (parsed.length === 0) {
        pasteFeedback.textContent = 'Could not find any amounts. Try format: "Dinner 85 Jesse"';
        pasteFeedback.className = 'expense-alloc-status status-err';
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      parsed.forEach(item => {
        const count = currentTrip.members.length;
        const totalCents = Math.round(item.amount * 100);
        const baseCents = Math.floor(totalCents / count);
        let remCents = totalCents % count;

        const participants = currentTrip.members.map(m => {
          const extra = remCents > 0 ? 1 : 0;
          if (remCents > 0) remCents--;
          return {
            memberId: m.id,
            amount: (baseCents + extra) / 100
          };
        });

        currentTrip.expenses.push({
          id: 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          description: item.description,
          amount: item.amount,
          paidBy: item.paidBy,
          category: item.category,
          date: today,
          splitMode: 'equal',
          participants
        });
      });

      pasteInput.value = '';
      pasteFeedback.textContent = `✓ Successfully added ${parsed.length} expense${parsed.length === 1 ? '' : 's'}!`;
      pasteFeedback.className = 'expense-alloc-status status-ok';

      saveTripToStorage();
      renderExpenseSplitter();
    };
  }

  // Clear All Expenses
  const btnClearExp = $('btn-clear-expenses');
  if (btnClearExp) {
    btnClearExp.onclick = () => {
      if (confirm('Clear all expenses in this trip?')) {
        currentTrip.expenses = [];
        currentTrip.settledTransfers = [];
        saveTripToStorage();
        renderExpenseSplitter();
      }
    };
  }

  // Simplify Debts Toggle
  const toggleSimplify = $('toggle-simplify-debts');
  if (toggleSimplify) {
    toggleSimplify.onchange = () => {
      simplifyDebtsActive = toggleSimplify.checked;
      renderExpenseSplitter();
    };
  }

  // Copy WhatsApp Summary
  const btnCopyWhatsApp = $('btn-copy-whatsapp');
  const copyFeedback = $('whatsapp-copy-feedback');
  if (btnCopyWhatsApp) {
    btnCopyWhatsApp.onclick = () => {
      const text = generateWhatsAppSummary(currentTrip, simplifyDebtsActive);
      navigator.clipboard.writeText(text).then(() => {
        if (copyFeedback) {
          copyFeedback.hidden = false;
          setTimeout(() => copyFeedback.hidden = true, 3000);
        }
      }).catch(err => {
        alert('Could not copy to clipboard: ' + err);
      });
    };
  }

  renderExpenseSplitter();
}


// Initialize expense splitter
initExpenseSplitter();

// Initialize route now that all components and listeners are loaded
route();
