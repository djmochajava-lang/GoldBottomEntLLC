// js/band-player.js — Band Member Music Player
// Firebase-backed: Firestore for metadata, Storage for audio/charts.
// Role-gated: admin, band_manager, artist, band_member only.

const BandPlayer = {
  initialized: false,
  _db: null,
  _storage: null,
  _audio: null,
  _playlists: [],
  _songs: [],         // songs for current playlist
  _allSongsMap: {},    // songId → song doc cache
  _currentPlaylist: null,
  _currentIndex: -1,
  _isPlaying: false,
  _volume: 0.8,
  _editMode: false,
  _editDirty: false,

  init: function() {
    if (this.initialized) return;
    this._db = (typeof Auth !== 'undefined' && Auth._db) ? Auth._db : null;
    this._storage = (typeof Auth !== 'undefined' && Auth.getStorage) ? Auth.getStorage() : null;

    if (!this._db) {
      console.warn('[BandPlayer] Firestore not available');
      return;
    }

    // Create audio element (Chrome-safe pattern from LA Young player)
    if (!this._audio) {
      this._audio = document.createElement('audio');
      this._audio.preload = 'metadata';
    }

    this._setupAudioEvents();
    this.loadPlaylists();
    this.initialized = true;
    console.log('🎵 BandPlayer initialized');
  },

  // ── Data Loading ──────────────────────────────────────

  loadPlaylists: function() {
    var self = this;
    this._db.collection('playlists').orderBy('createdAt', 'desc').get()
      .then(function(snap) {
        self._playlists = [];
        snap.forEach(function(doc) {
          self._playlists.push(Object.assign({ id: doc.id }, doc.data()));
        });
        self.renderPlaylistDropdown();
        // Auto-select first playlist
        if (self._playlists.length > 0) {
          self.selectPlaylist(self._playlists[0].id);
        } else {
          self._renderEmptyState();
        }
      })
      .catch(function(e) {
        console.error('[BandPlayer] Failed to load playlists:', e);
        var el = document.getElementById('bp-tracklist');
        if (el) el.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.4);">Could not load playlists. Check your connection.</div>';
      });
  },

  selectPlaylist: function(playlistId) {
    var self = this;
    var pl = this._playlists.find(function(p) { return p.id === playlistId; });
    if (!pl) return;
    this._currentPlaylist = pl;
    this._currentIndex = -1;
    this._songs = [];

    var songOrder = pl.songOrder || [];
    if (songOrder.length === 0) {
      self._songs = [];
      self.renderTrackList();
      return;
    }

    // Batch-fetch songs (Firestore in queries max 30 per batch)
    var batches = [];
    for (var i = 0; i < songOrder.length; i += 10) {
      batches.push(songOrder.slice(i, i + 10));
    }

    Promise.all(batches.map(function(batch) {
      return self._db.collection('songs').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get();
    }))
    .then(function(snapshots) {
      var songMap = {};
      snapshots.forEach(function(snap) {
        snap.forEach(function(doc) {
          var data = Object.assign({ id: doc.id }, doc.data());
          songMap[doc.id] = data;
          self._allSongsMap[doc.id] = data;
        });
      });
      // Maintain playlist order
      self._songs = songOrder.map(function(id) { return songMap[id]; }).filter(Boolean);
      self.renderTrackList();
    })
    .catch(function(e) {
      console.error('[BandPlayer] Failed to load songs:', e);
    });

    // Update dropdown selection
    var sel = document.getElementById('bp-playlist-select');
    if (sel) sel.value = playlistId;
  },

  // ── Playback ──────────────────────────────────────────

  play: function(index) {
    if (index < 0 || index >= this._songs.length) return;
    var song = this._songs[index];
    if (!song || !song.audioPath) return;

    var self = this;
    this._currentIndex = index;

    // Get download URL from Firebase Storage
    var ref = this._storage.refFromURL ? this._storage.refFromURL(song.audioPath) : this._storage.ref(song.audioPath);
    ref.getDownloadURL().then(function(url) {
      self._audio.src = url;
      self._audio.play().catch(function() {
        // Mobile may need user gesture — retry on canplay
        self._audio.addEventListener('canplay', function retry() {
          self._audio.play();
          self._audio.removeEventListener('canplay', retry);
        });
      });
      self._isPlaying = true;
      self.updateNowPlaying();
      self.renderTrackList();
    }).catch(function(e) {
      console.error('[BandPlayer] Failed to get audio URL:', e);
      if (typeof Toast !== 'undefined') Toast.error('Could not load audio file');
    });
  },

  togglePlay: function() {
    if (this._currentIndex === -1 && this._songs.length > 0) {
      this.play(0);
      return;
    }
    if (this._isPlaying) {
      this._audio.pause();
      this._isPlaying = false;
    } else {
      this._audio.play();
      this._isPlaying = true;
    }
    this.updateNowPlaying();
    this.renderTrackList();
  },

  next: function() {
    if (this._songs.length === 0) return;
    var nextIdx = (this._currentIndex + 1) % this._songs.length;
    this.play(nextIdx);
  },

  prev: function() {
    if (this._songs.length === 0) return;
    // If more than 3 seconds in, restart current; else go prev
    if (this._audio.currentTime > 3) {
      this._audio.currentTime = 0;
      return;
    }
    var prevIdx = (this._currentIndex - 1 + this._songs.length) % this._songs.length;
    this.play(prevIdx);
  },

  seek: function(pct) {
    if (this._audio.duration) {
      this._audio.currentTime = pct * this._audio.duration;
    }
  },

  setVolume: function(val) {
    this._volume = Math.max(0, Math.min(1, val));
    this._audio.volume = this._volume;
    var volEl = document.getElementById('bp-volume-val');
    if (volEl) volEl.textContent = Math.round(this._volume * 100) + '%';
  },

  _setupAudioEvents: function() {
    var self = this;
    this._audio.addEventListener('timeupdate', function() {
      var prog = document.getElementById('bp-progress-fill');
      var timeEl = document.getElementById('bp-time-current');
      if (prog && self._audio.duration) {
        prog.style.width = (self._audio.currentTime / self._audio.duration * 100) + '%';
      }
      if (timeEl) timeEl.textContent = self._formatTime(self._audio.currentTime);
    });
    this._audio.addEventListener('loadedmetadata', function() {
      var durEl = document.getElementById('bp-time-duration');
      if (durEl) durEl.textContent = self._formatTime(self._audio.duration);
    });
    this._audio.addEventListener('ended', function() {
      self.next();
    });
    this._audio.volume = this._volume;
  },

  // ── Lyrics & Charts ──────────────────────────────────

  showLyrics: function(songId) {
    var song = this._allSongsMap[songId];
    if (!song) return;
    if (!song.lyrics) {
      if (typeof Toast !== 'undefined') Toast.info('No lyrics available for this song');
      return;
    }
    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: song.title + ' — Lyrics',
        size: 'md',
        content: '<pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.8;color:#e6edf3;max-height:60vh;overflow-y:auto;padding:8px 0;">' +
          BandPlayer._escHtml(song.lyrics) + '</pre>',
        confirmText: 'Close',
        onConfirm: function() { Modal.close(); }
      });
    }
  },

  showChart: function(songId) {
    var song = this._allSongsMap[songId];
    if (!song || !song.charts) {
      if (typeof Toast !== 'undefined') Toast.info('No charts available for this song');
      return;
    }

    var instrument = (typeof Auth !== 'undefined' && Auth.getInstrument) ? Auth.getInstrument() : null;
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';
    var isManager = (role === 'admin' || role === 'band_manager');

    // If manager or no specific instrument, show picker
    var charts = song.charts;
    var chartKeys = Object.keys(charts);
    if (chartKeys.length === 0) {
      if (typeof Toast !== 'undefined') Toast.info('No charts uploaded for this song');
      return;
    }

    // If user has a specific instrument and chart exists for it, open directly
    if (instrument && charts[instrument] && !isManager) {
      this._openChartFile(charts[instrument], song.title + ' — ' + instrument.charAt(0).toUpperCase() + instrument.slice(1) + ' Chart');
      return;
    }

    // Show picker for managers or when instrument chart not available
    var html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    chartKeys.forEach(function(key) {
      html += '<button onclick="BandPlayer._openChartFile(\'' + BandPlayer._escHtml(charts[key]) + '\', \'' +
        BandPlayer._escHtml(song.title + ' — ' + key) + '\')" ' +
        'style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:10px;' +
        'border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);' +
        'color:#e6edf3;cursor:pointer;font-size:15px;font-weight:600;font-family:inherit;text-align:left;">' +
        '<i class="fa-solid fa-file-pdf" style="color:#f0883e;font-size:18px;"></i>' +
        key.charAt(0).toUpperCase() + key.slice(1) + ' Chart</button>';
    });
    html += '</div>';

    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: song.title + ' — Charts',
        size: 'sm',
        content: html,
        confirmText: 'Close',
        onConfirm: function() { Modal.close(); }
      });
    }
  },

  _openChartFile: function(storagePath, title) {
    var storage = (typeof Auth !== 'undefined' && Auth.getStorage) ? Auth.getStorage() : null;
    if (!storage) return;
    var ref = storage.refFromURL ? storage.refFromURL(storagePath) : storage.ref(storagePath);
    ref.getDownloadURL().then(function(url) {
      window.open(url, '_blank');
      if (typeof Modal !== 'undefined') Modal.close();
    }).catch(function(e) {
      console.error('[BandPlayer] Chart download failed:', e);
      if (typeof Toast !== 'undefined') Toast.error('Could not load chart file');
    });
  },

  // ── Edit Mode (band_manager / admin only) ─────────────

  toggleEditMode: function() {
    if (this._editMode) {
      this._exitEditMode();
    } else {
      this._enterEditMode();
    }
  },

  _enterEditMode: function() {
    this._editMode = true;
    this._editDirty = false;
    // Pause playback when entering edit mode
    if (this._isPlaying) {
      this._audio.pause();
      this._isPlaying = false;
      this.updateNowPlaying();
    }
    // Update toggle button
    var btn = document.getElementById('bp-edit-toggle');
    if (btn) {
      btn.style.background = 'rgba(88,166,255,0.15)';
      btn.style.color = '#58a6ff';
      btn.style.borderColor = 'rgba(88,166,255,0.3)';
      btn.innerHTML = '<i class="fa-solid fa-check" style="margin-right:4px;"></i> Done';
    }
    // Hide now-playing bar in edit mode
    var nowPlaying = document.getElementById('bp-now-playing');
    if (nowPlaying) nowPlaying.style.display = 'none';
    this.renderTrackList();
  },

  _exitEditMode: function() {
    var self = this;
    this._editMode = false;
    // Update toggle button
    var btn = document.getElementById('bp-edit-toggle');
    if (btn) {
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.color = 'rgba(255,255,255,0.7)';
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
      btn.innerHTML = '<i class="fa-solid fa-pen" style="margin-right:4px;"></i> Edit';
    }
    // Save order to Firestore if changed
    if (this._editDirty && this._currentPlaylist) {
      var newOrder = this._songs.map(function(s) { return s.id; });
      this._db.collection('playlists').doc(this._currentPlaylist.id).update({
        songOrder: newOrder,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function() {
        self._currentPlaylist.songOrder = newOrder;
        if (typeof Toast !== 'undefined') Toast.success('Playlist order saved');
      }).catch(function(e) {
        console.error('[BandPlayer] Failed to save order:', e);
        if (typeof Toast !== 'undefined') Toast.error('Failed to save order');
      });
    }
    this._editDirty = false;
    this.renderTrackList();
  },

  moveSong: function(fromIndex, direction) {
    var toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= this._songs.length) return;
    var temp = this._songs[fromIndex];
    this._songs[fromIndex] = this._songs[toIndex];
    this._songs[toIndex] = temp;
    this._editDirty = true;
    this.renderTrackList();
  },

  removeSong: function(index) {
    var song = this._songs[index];
    if (!song) return;
    if (typeof Modal !== 'undefined') {
      var self = this;
      Modal.open({
        title: 'Remove Song',
        size: 'sm',
        content: '<p style="color:#e6edf3;font-size:15px;">Remove <strong>' + this._escHtml(song.title) + '</strong> from this playlist?</p>' +
          '<p style="color:rgba(255,255,255,0.45);font-size:13px;margin-top:8px;">The song file won\'t be deleted — it can be added back later.</p>',
        confirmText: 'Remove',
        onConfirm: function() {
          self._songs.splice(index, 1);
          self._editDirty = true;
          Modal.close();
          self.renderTrackList();
        }
      });
    }
  },

  // ── Upload (band_manager / admin only) ────────────────

  showUploadSong: function() {
    if (typeof Modal === 'undefined') return;
    Modal.open({
      title: 'Add Song',
      size: 'md',
      content:
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
          '<div><label class="form-label">Song Title *</label><input id="bp-u-title" class="form-input" placeholder="e.g. No One Can Love You More" /></div>' +
          '<div><label class="form-label">Artist</label><input id="bp-u-artist" class="form-input" value="L.A. Young" /></div>' +
          '<div><label class="form-label">Audio File (MP3) *</label><input id="bp-u-audio" type="file" accept=".mp3,audio/mpeg" class="form-input" /></div>' +
          '<div><label class="form-label">Lyrics (optional)</label><textarea id="bp-u-lyrics" class="form-input" rows="4" placeholder="Paste lyrics here..."></textarea></div>' +
          '<details style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;">' +
            '<summary style="cursor:pointer;font-weight:600;font-size:14px;color:rgba(255,255,255,0.7);">' +
              '<i class="fa-solid fa-file-pdf" style="margin-right:6px;color:#f0883e;"></i>Instrument Charts (optional)</summary>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">' +
              '<div><label class="form-label">Drums</label><input id="bp-u-chart-drums" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Guitar</label><input id="bp-u-chart-guitar" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Keys</label><input id="bp-u-chart-keys" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Bass</label><input id="bp-u-chart-bass" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Vocals</label><input id="bp-u-chart-vocals" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Saxophone</label><input id="bp-u-chart-saxophone" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
            '</div>' +
          '</details>' +
          '<div id="bp-u-progress" style="display:none;">' +
            '<div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:6px;">Uploading...</div>' +
            '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">' +
              '<div id="bp-u-progress-bar" style="height:100%;width:0%;background:#d4a017;border-radius:3px;transition:width 200ms;"></div>' +
            '</div>' +
          '</div>' +
        '</div>',
      confirmText: 'Upload & Add',
      onConfirm: function() { BandPlayer._handleUploadSong(); }
    });
    setTimeout(function() { var el = document.getElementById('bp-u-title'); if (el) el.focus(); }, 100);
  },

  _handleUploadSong: function() {
    var title = (document.getElementById('bp-u-title') || {}).value || '';
    var artist = (document.getElementById('bp-u-artist') || {}).value || 'L.A. Young';
    var audioInput = document.getElementById('bp-u-audio');
    var lyrics = (document.getElementById('bp-u-lyrics') || {}).value || '';

    if (!title.trim()) { Toast.error('Song title is required'); return; }
    if (!audioInput || !audioInput.files || !audioInput.files[0]) { Toast.error('Please select an MP3 file'); return; }

    var audioFile = audioInput.files[0];
    var songId = 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    var audioPath = 'band-media/audio/' + songId + '.mp3';

    // Collect chart files
    var chartFiles = {};
    ['drums', 'guitar', 'keys', 'bass', 'vocals', 'saxophone'].forEach(function(inst) {
      var input = document.getElementById('bp-u-chart-' + inst);
      if (input && input.files && input.files[0]) {
        chartFiles[inst] = input.files[0];
      }
    });

    var progDiv = document.getElementById('bp-u-progress');
    var progBar = document.getElementById('bp-u-progress-bar');
    if (progDiv) progDiv.style.display = '';

    var self = this;
    var storage = this._storage;

    // Step 1: Upload audio
    var audioRef = storage.ref(audioPath);
    var uploadTask = audioRef.put(audioFile);

    uploadTask.on('state_changed',
      function(snapshot) {
        var pct = (snapshot.bytesTransferred / snapshot.totalBytes * 70); // audio = 70% of progress
        if (progBar) progBar.style.width = pct + '%';
      },
      function(error) {
        Toast.error('Audio upload failed: ' + error.message);
        if (progDiv) progDiv.style.display = 'none';
      },
      function() {
        // Audio uploaded — now upload charts
        if (progBar) progBar.style.width = '70%';

        var chartPaths = {};
        var chartKeys = Object.keys(chartFiles);
        var chartPromises = chartKeys.map(function(inst, i) {
          var chartPath = 'band-media/charts/' + songId + '/' + inst + '.' + chartFiles[inst].name.split('.').pop();
          chartPaths[inst] = chartPath;
          return storage.ref(chartPath).put(chartFiles[inst]).then(function() {
            if (progBar) progBar.style.width = (70 + ((i + 1) / chartKeys.length * 20)) + '%';
          });
        });

        Promise.all(chartPromises).then(function() {
          if (progBar) progBar.style.width = '90%';

          // Step 2: Save metadata to Firestore
          var songData = {
            title: title,
            artist: artist,
            audioPath: audioPath,
            lyrics: lyrics || null,
            charts: Object.keys(chartPaths).length > 0 ? chartPaths : null,
            duration: null, // will be populated on first play
            createdBy: (typeof Auth !== 'undefined' && Auth._user) ? Auth._user.uid : 'pin',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          self._db.collection('songs').doc(songId).set(songData).then(function() {
            if (progBar) progBar.style.width = '95%';

            // Step 3: Add to current playlist if one is selected
            if (self._currentPlaylist) {
              var newOrder = (self._currentPlaylist.songOrder || []).slice();
              newOrder.push(songId);
              self._db.collection('playlists').doc(self._currentPlaylist.id).update({
                songOrder: newOrder,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              }).then(function() {
                if (progBar) progBar.style.width = '100%';
                Modal.close();
                Toast.success('Song added: ' + title);
                self._currentPlaylist.songOrder = newOrder;
                self._allSongsMap[songId] = Object.assign({ id: songId }, songData);
                self._songs.push(self._allSongsMap[songId]);
                self.renderTrackList();
              });
            } else {
              if (progBar) progBar.style.width = '100%';
              Modal.close();
              Toast.success('Song uploaded: ' + title + ' (not added to a playlist yet)');
            }
          });
        }).catch(function(e) {
          Toast.error('Chart upload failed: ' + e.message);
          if (progDiv) progDiv.style.display = 'none';
        });
      }
    );
  },

  showCreatePlaylist: function() {
    if (typeof Modal === 'undefined') return;
    Modal.open({
      title: 'Create Playlist',
      size: 'sm',
      content:
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          '<div><label class="form-label">Playlist Name *</label><input id="bp-pl-name" class="form-input" placeholder="e.g. Friday Night Set" /></div>' +
          '<div><label class="form-label">Description</label><input id="bp-pl-desc" class="form-input" placeholder="e.g. Blues Alley show — 90 min set" /></div>' +
        '</div>',
      confirmText: 'Create',
      onConfirm: function() {
        var name = (document.getElementById('bp-pl-name') || {}).value || '';
        var desc = (document.getElementById('bp-pl-desc') || {}).value || '';
        if (!name.trim()) { Toast.error('Playlist name is required'); return; }

        var plData = {
          name: name,
          description: desc,
          songOrder: [],
          createdBy: (typeof Auth !== 'undefined' && Auth._user) ? Auth._user.uid : 'pin',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        BandPlayer._db.collection('playlists').add(plData).then(function(ref) {
          Modal.close();
          Toast.success('Playlist created: ' + name);
          plData.id = ref.id;
          BandPlayer._playlists.unshift(plData);
          BandPlayer.renderPlaylistDropdown();
          BandPlayer.selectPlaylist(ref.id);
        }).catch(function(e) {
          Toast.error('Failed to create playlist: ' + e.message);
        });
      }
    });
    setTimeout(function() { var el = document.getElementById('bp-pl-name'); if (el) el.focus(); }, 100);
  },

  // ── Rendering ─────────────────────────────────────────

  renderPlaylistDropdown: function() {
    var el = document.getElementById('bp-playlist-select');
    if (!el) return;
    el.innerHTML = this._playlists.map(function(pl) {
      return '<option value="' + pl.id + '">' + BandPlayer._escHtml(pl.name) +
        (pl.description ? ' — ' + BandPlayer._escHtml(pl.description) : '') + '</option>';
    }).join('');
  },

  renderTrackList: function() {
    var el = document.getElementById('bp-tracklist');
    if (!el) return;

    if (this._songs.length === 0) {
      el.innerHTML = '<div style="padding:30px;text-align:center;color:rgba(255,255,255,0.35);font-size:15px;">' +
        '<i class="fa-solid fa-music" style="font-size:28px;display:block;margin-bottom:10px;color:rgba(255,255,255,0.15);"></i>' +
        (this._currentPlaylist ? 'No songs in this playlist yet.' : 'Select or create a playlist to get started.') +
        '</div>';
      return;
    }

    var self = this;

    if (this._editMode) {
      // Edit mode — reorder + remove controls
      var editHtml = '<div class="bp-edit-banner">' +
        '<span><i class="fa-solid fa-arrows-up-down" style="margin-right:6px;"></i>Editing — reorder or remove songs</span>' +
        '<span style="color:rgba(255,255,255,0.4);font-weight:400;">' + this._songs.length + ' song' + (this._songs.length !== 1 ? 's' : '') + '</span>' +
        '</div>';

      editHtml += this._songs.map(function(song, i) {
        var isFirst = (i === 0);
        var isLast = (i === self._songs.length - 1);

        return '<div class="bp-track" style="cursor:default;">' +
          '<div class="bp-track-num"><span>' + (i + 1) + '</span></div>' +
          '<div class="bp-track-info">' +
            '<div class="bp-track-title">' + BandPlayer._escHtml(song.title) + '</div>' +
            '<div class="bp-track-artist">' + BandPlayer._escHtml(song.artist || 'Unknown') + '</div>' +
          '</div>' +
          '<div class="bp-track-edit-actions" onclick="event.stopPropagation()">' +
            '<button class="bp-edit-btn" onclick="BandPlayer.moveSong(' + i + ',-1)" title="Move up"' +
              (isFirst ? ' disabled style="opacity:0.2;cursor:default;"' : '') + '>' +
              '<i class="fa-solid fa-chevron-up"></i></button>' +
            '<button class="bp-edit-btn" onclick="BandPlayer.moveSong(' + i + ',1)" title="Move down"' +
              (isLast ? ' disabled style="opacity:0.2;cursor:default;"' : '') + '>' +
              '<i class="fa-solid fa-chevron-down"></i></button>' +
            '<button class="bp-edit-btn bp-edit-btn-danger" onclick="BandPlayer.removeSong(' + i + ')" title="Remove">' +
              '<i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>';
      }).join('');

      el.innerHTML = editHtml;
      return;
    }

    // Listen mode — normal playback view
    el.innerHTML = this._songs.map(function(song, i) {
      var isActive = (i === self._currentIndex);
      var hasLyrics = !!(song.lyrics);
      var hasCharts = !!(song.charts && Object.keys(song.charts).length > 0);

      return '<div class="bp-track' + (isActive ? ' bp-track-active' : '') + '" onclick="BandPlayer.play(' + i + ')">' +
        '<div class="bp-track-num">' +
          (isActive && self._isPlaying
            ? '<div class="bp-eq"><span></span><span></span><span></span></div>'
            : '<span>' + (i + 1) + '</span>') +
        '</div>' +
        '<div class="bp-track-info">' +
          '<div class="bp-track-title">' + BandPlayer._escHtml(song.title) + '</div>' +
          '<div class="bp-track-artist">' + BandPlayer._escHtml(song.artist || 'Unknown') + '</div>' +
        '</div>' +
        '<div class="bp-track-actions" onclick="event.stopPropagation()">' +
          (hasLyrics ? '<button class="bp-action-btn" onclick="BandPlayer.showLyrics(\'' + song.id + '\')" title="Lyrics"><i class="fa-solid fa-align-left"></i></button>' : '') +
          (hasCharts ? '<button class="bp-action-btn" onclick="BandPlayer.showChart(\'' + song.id + '\')" title="Chart"><i class="fa-solid fa-file-pdf"></i></button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  },

  updateNowPlaying: function() {
    var song = this._songs[this._currentIndex];
    var titleEl = document.getElementById('bp-now-title');
    var artistEl = document.getElementById('bp-now-artist');
    var playBtn = document.getElementById('bp-play-icon');
    var nowSection = document.getElementById('bp-now-playing');

    if (!song) {
      if (nowSection) nowSection.style.display = 'none';
      return;
    }

    if (nowSection) nowSection.style.display = '';
    if (titleEl) titleEl.textContent = song.title;
    if (artistEl) artistEl.textContent = song.artist || 'Unknown';
    if (playBtn) playBtn.className = 'fa-solid ' + (this._isPlaying ? 'fa-pause' : 'fa-play');
  },

  _renderEmptyState: function() {
    var el = document.getElementById('bp-tracklist');
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';
    var isManager = (role === 'admin' || role === 'band_manager');
    if (el) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.35);">' +
        '<i class="fa-solid fa-headphones" style="font-size:36px;display:block;margin-bottom:12px;color:rgba(255,255,255,0.12);"></i>' +
        '<div style="font-size:16px;font-weight:600;margin-bottom:6px;">No Playlists Yet</div>' +
        (isManager
          ? '<div style="font-size:14px;">Create a playlist and start adding songs.</div>'
          : '<div style="font-size:14px;">Your band manager hasn\'t set up any playlists yet.</div>') +
        '</div>';
    }
  },

  // ── Helpers ───────────────────────────────────────────

  _formatTime: function(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  },

  _escHtml: function(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
};

// CommonJS export fallback
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BandPlayer;
}
