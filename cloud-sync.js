// ===== CloudSync — Google Drive Cloud Sync Engine =====
// Uses appDataFolder (hidden) to sync books, progress, settings, custom phrases
(function () {
    // --- Config ---
    var CLIENT_ID = '513161269917-d1d55qhfvp6virr9oemdflea7lvb9a8k.apps.googleusercontent.com';
    var SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
    var META_FILENAME = 'sync-meta.json';
    var TOKEN_KEY = 'vp_drive_token';
    var SYNC_STATE_KEY = 'vp_sync_state';
    var DELETED_BOOKS_KEY = 'vp_deleted_books';
    var MAX_RETRIES = 3;
    var RETRY_DELAYS = [1000, 2000, 4000];
    var RESUMABLE_THRESHOLD = 5 * 1024 * 1024; // 5MB

    // --- State ---
    var accessToken = null;
    var tokenExpiresAt = 0;
    var tokenClient = null;
    var syncInProgress = false;
    var cloudOnlyBooks = [];
    var fileIdCache = {};
    var gisReady = false;
    var _pendingSignIn = null; // {resolve, reject} for signIn promise

    // --- Token Management ---

    function _saveToken(token, expiresIn) {
        accessToken = token;
        tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000; // 60s buffer
        try {
            localStorage.setItem(TOKEN_KEY, JSON.stringify({
                access_token: token,
                expires_at: tokenExpiresAt
            }));
        } catch (e) {}
    }

    function _loadToken() {
        try {
            var stored = JSON.parse(localStorage.getItem(TOKEN_KEY));
            if (stored && stored.access_token && stored.expires_at > Date.now()) {
                accessToken = stored.access_token;
                tokenExpiresAt = stored.expires_at;
                return true;
            }
        } catch (e) {}
        accessToken = null;
        tokenExpiresAt = 0;
        return false;
    }

    function _clearToken() {
        accessToken = null;
        tokenExpiresAt = 0;
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }

    function _isTokenValid() {
        return accessToken && tokenExpiresAt > Date.now();
    }

    // --- GIS Initialization ---

    function _initGis() {
        if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) return;
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: function (resp) {
                if (resp.error) {
                    if (_pendingSignIn) {
                        _pendingSignIn.reject(new Error(resp.error));
                        _pendingSignIn = null;
                    }
                    return;
                }
                _saveToken(resp.access_token, resp.expires_in);
                if (_pendingSignIn) {
                    _pendingSignIn.resolve();
                    _pendingSignIn = null;
                }
            }
        });
        gisReady = true;
    }

    // Called when GIS script loads
    window.__onGisLoaded = function () {
        _initGis();
    };

    function init() {
        _loadToken();
        // Try init GIS if already loaded
        if (window.google && window.google.accounts) {
            _initGis();
        }
    }

    function isSignedIn() {
        return _isTokenValid();
    }

    function signIn() {
        return new Promise(function (resolve, reject) {
            if (!gisReady || !tokenClient) {
                reject(new Error('Google Identity Services not loaded'));
                return;
            }
            _pendingSignIn = { resolve: resolve, reject: reject };
            tokenClient.requestAccessToken({ prompt: 'consent' });
        });
    }

    function signOut() {
        if (accessToken) {
            try { google.accounts.oauth2.revoke(accessToken); } catch (e) {}
        }
        _clearToken();
        cloudOnlyBooks = [];
        fileIdCache = {};
    }

    function _ensureToken() {
        if (_isTokenValid()) return Promise.resolve();
        // Try silent refresh (no popup)
        return new Promise(function (resolve, reject) {
            if (!gisReady || !tokenClient) {
                reject(new Error('TOKEN_EXPIRED'));
                return;
            }
            _pendingSignIn = { resolve: resolve, reject: function () {
                reject(new Error('TOKEN_EXPIRED'));
            }};
            tokenClient.requestAccessToken({ prompt: '' });
        });
    }

    // --- Fetch with Auth + Retry ---

    function _fetchWithAuth(url, opts) {
        opts = opts || {};
        function attempt(retryCount) {
            if (!accessToken) return Promise.reject(new Error('TOKEN_EXPIRED'));
            var headers = opts.headers ? Object.assign({}, opts.headers) : {};
            headers['Authorization'] = 'Bearer ' + accessToken;
            var fetchOpts = Object.assign({}, opts, { headers: headers });

            return fetch(url, fetchOpts).then(function (resp) {
                if (resp.ok) return resp;
                if (resp.status === 401) {
                    _clearToken();
                    throw new Error('TOKEN_EXPIRED');
                }
                if ((resp.status === 403 || resp.status === 429 || resp.status >= 500) && retryCount < MAX_RETRIES) {
                    return new Promise(function (resolve) {
                        setTimeout(resolve, RETRY_DELAYS[retryCount] || 4000);
                    }).then(function () {
                        return attempt(retryCount + 1);
                    });
                }
                throw new Error('HTTP ' + resp.status);
            }).catch(function (err) {
                if (err.message === 'TOKEN_EXPIRED') throw err;
                if (err.name === 'TypeError' && retryCount < MAX_RETRIES) {
                    // Network error
                    return new Promise(function (resolve) {
                        setTimeout(resolve, RETRY_DELAYS[retryCount] || 4000);
                    }).then(function () {
                        return attempt(retryCount + 1);
                    });
                }
                throw err;
            });
        }
        return attempt(0);
    }

    // --- Drive API Helpers ---

    function _listFiles() {
        return _fetchWithAuth(
            'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,size)&pageSize=1000'
        ).then(function (resp) { return resp.json(); })
         .then(function (data) {
            var files = data.files || [];
            // Refresh cache
            fileIdCache = {};
            for (var i = 0; i < files.length; i++) {
                fileIdCache[files[i].name] = files[i].id;
            }
            return files;
        });
    }

    function _findFile(name) {
        if (fileIdCache[name]) return Promise.resolve(fileIdCache[name]);
        return _listFiles().then(function () {
            return fileIdCache[name] || null;
        });
    }

    function _readFile(fileId) {
        return _fetchWithAuth(
            'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media'
        ).then(function (resp) { return resp.text(); });
    }

    function _readFileJson(fileId) {
        return _fetchWithAuth(
            'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media'
        ).then(function (resp) { return resp.json(); });
    }

    // Multipart upload (create or update)
    function _uploadFile(name, content, mimeType, existingFileId) {
        mimeType = mimeType || 'application/octet-stream';
        var isJson = typeof content === 'string' && mimeType.indexOf('json') !== -1;
        var body = isJson ? content : content;
        var bodySize = new Blob([body]).size;

        // Use resumable upload for large files
        if (bodySize > RESUMABLE_THRESHOLD) {
            return _uploadResumable(name, body, mimeType, existingFileId);
        }

        var boundary = 'vp_sync_boundary_' + Date.now();
        var metadata = existingFileId
            ? {}
            : { name: name, parents: ['appDataFolder'] };

        var multipart =
            '--' + boundary + '\r\n' +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) + '\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Type: ' + mimeType + '\r\n\r\n';
        var ending = '\r\n--' + boundary + '--';

        var blobParts = [multipart, body, ending];
        var blob = new Blob(blobParts);

        var url = existingFileId
            ? 'https://www.googleapis.com/upload/drive/v3/files/' + existingFileId + '?uploadType=multipart'
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

        return _fetchWithAuth(url, {
            method: existingFileId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
            body: blob
        }).then(function (resp) { return resp.json(); })
         .then(function (data) {
            if (data.id) fileIdCache[name] = data.id;
            return data;
        });
    }

    // Resumable upload for large files (>5MB)
    function _uploadResumable(name, content, mimeType, existingFileId) {
        var metadata = existingFileId
            ? {}
            : { name: name, parents: ['appDataFolder'] };

        var url = existingFileId
            ? 'https://www.googleapis.com/upload/drive/v3/files/' + existingFileId + '?uploadType=resumable'
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';

        // Step 1: Initiate resumable session
        return _fetchWithAuth(url, {
            method: existingFileId ? 'PATCH' : 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mimeType
            },
            body: JSON.stringify(metadata)
        }).then(function (resp) {
            var sessionUri = resp.headers.get('Location');
            if (!sessionUri) throw new Error('No resumable session URI');
            // Step 2: Upload content to session URI (no auth header needed)
            return fetch(sessionUri, {
                method: 'PUT',
                headers: { 'Content-Type': mimeType },
                body: content
            });
        }).then(function (resp) { return resp.json(); })
         .then(function (data) {
            if (data.id) fileIdCache[name] = data.id;
            return data;
        });
    }

    function _deleteFile(fileId) {
        return _fetchWithAuth(
            'https://www.googleapis.com/drive/v3/files/' + fileId,
            { method: 'DELETE' }
        ).then(function () { return true; });
    }

    // --- Local State Helpers ---

    function _getDeletedBooks() {
        try {
            return JSON.parse(localStorage.getItem(DELETED_BOOKS_KEY)) || [];
        } catch (e) { return []; }
    }

    function _setDeletedBooks(arr) {
        try { localStorage.setItem(DELETED_BOOKS_KEY, JSON.stringify(arr)); } catch (e) {}
    }

    function _addDeletedBook(id) {
        var arr = _getDeletedBooks();
        if (!arr.some(function (d) { return d.id === id; })) {
            arr.push({ id: id, deletedAt: Date.now() });
            _setDeletedBooks(arr);
        }
    }

    function _saveSyncState(state) {
        try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function getLastSyncTime() {
        try {
            var state = JSON.parse(localStorage.getItem(SYNC_STATE_KEY));
            return state ? state.lastSync : null;
        } catch (e) { return null; }
    }

    // --- Build local metadata snapshot ---

    function _buildLocalMeta() {
        var result = {
            settings: {},
            customPhrases: {},
            bookList: [],
            progress: {},
            deletedBooks: _getDeletedBooks()
        };

        // Settings
        result.settings.theme = localStorage.getItem('theme');
        result.settings.readerSettings = localStorage.getItem('readerSettings');
        result.settings.lastReadBook = localStorage.getItem('lastReadBook');
        result.settings.lastModified = parseInt(localStorage.getItem('vp_settings_ts')) || 0;

        // Custom phrases
        if (window.DictEngine && DictEngine.isReady) {
            result.customPhrases = DictEngine.getCustomEntries();
        } else {
            try {
                result.customPhrases = JSON.parse(localStorage.getItem('customPhrases')) || {};
            } catch (e) { result.customPhrases = {}; }
        }

        // Books + progress from IDB
        return Promise.all([
            ReaderLib.getAllBooksMeta(),
            ReaderLib.getAllProgress()
        ]).then(function (results) {
            var books = results[0];
            var progresses = results[1];

            for (var i = 0; i < books.length; i++) {
                var b = books[i];
                result.bookList.push({
                    id: b.id,
                    title: b.title,
                    size: b.size,
                    dateAdded: b.dateAdded,
                    format: b.format,
                    chapters: b.chapters
                });
            }

            for (var j = 0; j < progresses.length; j++) {
                var p = progresses[j];
                result.progress[p.bookId] = p;
            }

            return result;
        });
    }

    // --- Merge Logic ---

    function _mergeMetadata(local, cloud) {
        var merged = {
            version: 1,
            lastModified: Date.now(),
            settings: {},
            customPhrases: {},
            bookList: [],
            progress: {},
            deletedBooks: []
        };

        // 1. Settings: newer wins
        var localSettingsTs = local.settings.lastModified || 0;
        var cloudSettingsTs = (cloud && cloud.settings && cloud.settings.lastModified) || 0;
        if (cloudSettingsTs > localSettingsTs && cloud.settings) {
            merged.settings = cloud.settings;
        } else {
            merged.settings = local.settings;
        }
        merged.settings.lastModified = Date.now();

        // 2. Custom phrases: union merge, cloud wins on conflict
        var localPhrases = local.customPhrases || {};
        var cloudPhrases = (cloud && cloud.customPhrases) || {};
        var allPhrases = {};
        var k;
        for (k in localPhrases) {
            if (localPhrases.hasOwnProperty(k)) allPhrases[k] = localPhrases[k];
        }
        for (k in cloudPhrases) {
            if (cloudPhrases.hasOwnProperty(k)) allPhrases[k] = cloudPhrases[k]; // cloud wins
        }
        merged.customPhrases = allPhrases;

        // 3. Deletions: combine tombstones (prune >30 days old)
        var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        var allDeleted = (local.deletedBooks || []).concat((cloud && cloud.deletedBooks) || []);
        var deletedMap = {};
        for (var di = 0; di < allDeleted.length; di++) {
            var d = allDeleted[di];
            if (d.deletedAt > cutoff) {
                deletedMap[d.id] = d;
            }
        }
        merged.deletedBooks = Object.values ? Object.values(deletedMap) : (function () {
            var arr = [];
            for (var dk in deletedMap) { if (deletedMap.hasOwnProperty(dk)) arr.push(deletedMap[dk]); }
            return arr;
        })();

        // Build deleted ID set for quick lookup
        var deletedIds = {};
        for (var ddx = 0; ddx < merged.deletedBooks.length; ddx++) {
            deletedIds[merged.deletedBooks[ddx].id] = true;
        }

        // 4. Books: merge lists
        var localBookMap = {};
        for (var li = 0; li < local.bookList.length; li++) {
            var lb = local.bookList[li];
            if (!deletedIds[lb.id]) localBookMap[lb.id] = lb;
        }

        var cloudBookMap = {};
        var cloudBooksById = {};
        if (cloud && cloud.bookList) {
            for (var ci = 0; ci < cloud.bookList.length; ci++) {
                var cb = cloud.bookList[ci];
                if (!deletedIds[cb.id]) {
                    cloudBookMap[cb.id] = cb;
                    cloudBooksById[cb.id] = cb;
                }
            }
        }

        // Dedup: match local-only books against cloud by title+size
        var localDedupKey = {};
        for (var lk in localBookMap) {
            if (localBookMap.hasOwnProperty(lk)) {
                var lb2 = localBookMap[lk];
                localDedupKey[lb2.title + '|' + lb2.size] = lb2.id;
            }
        }

        var booksToUpload = []; // local-only, need upload
        var booksCloudOnly = []; // cloud-only, need download option

        // All unique book IDs
        var allBookIds = {};
        for (var mk in localBookMap) { if (localBookMap.hasOwnProperty(mk)) allBookIds[mk] = true; }
        for (var ck in cloudBookMap) { if (cloudBookMap.hasOwnProperty(ck)) allBookIds[ck] = true; }

        for (var bid in allBookIds) {
            if (!allBookIds.hasOwnProperty(bid)) continue;
            var inLocal = localBookMap[bid];
            var inCloud = cloudBookMap[bid];

            if (inLocal && inCloud) {
                // Both: keep merged entry (prefer cloud driveFileId)
                var entry = {};
                for (var ek in inLocal) { if (inLocal.hasOwnProperty(ek)) entry[ek] = inLocal[ek]; }
                if (inCloud.driveFileId) entry.driveFileId = inCloud.driveFileId;
                merged.bookList.push(entry);
            } else if (inLocal && !inCloud) {
                // Check dedup against cloud by title+size
                var dedupKey = inLocal.title + '|' + inLocal.size;
                var matched = false;
                for (var cid in cloudBookMap) {
                    if (cloudBookMap.hasOwnProperty(cid)) {
                        var ck2 = cloudBookMap[cid].title + '|' + cloudBookMap[cid].size;
                        if (ck2 === dedupKey) {
                            // Same book, different ID — use cloud entry
                            matched = true;
                            break;
                        }
                    }
                }
                if (!matched) {
                    booksToUpload.push(inLocal);
                }
                merged.bookList.push(inLocal);
            } else if (!inLocal && inCloud) {
                // Cloud only — check dedup against local
                var cDedupKey = inCloud.title + '|' + inCloud.size;
                if (localDedupKey[cDedupKey]) {
                    // Already have locally under different ID, skip
                    merged.bookList.push(inCloud);
                } else {
                    booksCloudOnly.push(inCloud);
                    merged.bookList.push(inCloud);
                }
            }
        }

        // 5. Progress: per book, newer lastRead wins
        var localProgress = local.progress || {};
        var cloudProgress = (cloud && cloud.progress) || {};
        var allProgressKeys = {};
        for (var pk in localProgress) { if (localProgress.hasOwnProperty(pk)) allProgressKeys[pk] = true; }
        for (var cpk in cloudProgress) { if (cloudProgress.hasOwnProperty(cpk)) allProgressKeys[cpk] = true; }

        for (var pKey in allProgressKeys) {
            if (!allProgressKeys.hasOwnProperty(pKey)) continue;
            if (deletedIds[pKey]) continue; // skip deleted books
            var lp = localProgress[pKey];
            var cp = cloudProgress[pKey];
            if (lp && cp) {
                merged.progress[pKey] = (cp.lastRead || 0) > (lp.lastRead || 0) ? cp : lp;
            } else {
                merged.progress[pKey] = lp || cp;
            }
        }

        return {
            merged: merged,
            booksToUpload: booksToUpload,
            booksCloudOnly: booksCloudOnly
        };
    }

    // --- Apply Merged Data to Local ---

    function _applyMergedToLocal(merged) {
        // Settings
        if (merged.settings) {
            if (merged.settings.theme) localStorage.setItem('theme', merged.settings.theme);
            if (merged.settings.readerSettings) localStorage.setItem('readerSettings', merged.settings.readerSettings);
            if (merged.settings.lastReadBook) localStorage.setItem('lastReadBook', merged.settings.lastReadBook);
            localStorage.setItem('vp_settings_ts', String(merged.settings.lastModified || Date.now()));
        }

        // Custom phrases
        if (merged.customPhrases) {
            if (window.DictEngine && DictEngine.isReady) {
                DictEngine.setCustomEntries(merged.customPhrases);
            } else {
                try { localStorage.setItem('customPhrases', JSON.stringify(merged.customPhrases)); } catch (e) {}
            }
        }

        // Progress
        var progressPromises = [];
        for (var bookId in merged.progress) {
            if (merged.progress.hasOwnProperty(bookId)) {
                var p = merged.progress[bookId];
                if (!p.bookId) p.bookId = bookId;
                progressPromises.push(ReaderLib.saveProgress(p));
            }
        }

        // Deletions — remove locally
        var deletePromises = [];
        if (merged.deletedBooks) {
            for (var i = 0; i < merged.deletedBooks.length; i++) {
                deletePromises.push(ReaderLib.deleteBook(merged.deletedBooks[i].id).catch(function () {}));
            }
        }

        // Store deletedBooks list locally
        _setDeletedBooks(merged.deletedBooks || []);

        return Promise.all(progressPromises.concat(deletePromises));
    }

    // --- Main Sync ---

    function sync(onProgress) {
        if (syncInProgress) return Promise.reject(new Error('Sync already in progress'));
        syncInProgress = true;
        var summary = { uploaded: 0, downloaded: 0, updated: 0, deleted: 0 };

        function _progress(msg) {
            if (onProgress) onProgress(msg);
        }

        return _ensureToken().then(function () {
            _progress('Listing cloud files...');
            return _listFiles();
        }).then(function () {
            // Download sync-meta.json from cloud
            var metaFileId = fileIdCache[META_FILENAME];
            if (metaFileId) {
                _progress('Downloading sync metadata...');
                return _readFileJson(metaFileId);
            }
            return null; // First sync
        }).then(function (cloudMeta) {
            _progress('Building local snapshot...');
            return _buildLocalMeta().then(function (localMeta) {
                return { local: localMeta, cloud: cloudMeta };
            });
        }).then(function (data) {
            _progress('Merging...');
            var result = _mergeMetadata(data.local, data.cloud);
            cloudOnlyBooks = result.booksCloudOnly;

            // Upload new book files
            var uploadChain = Promise.resolve();
            for (var i = 0; i < result.booksToUpload.length; i++) {
                (function (book) {
                    uploadChain = uploadChain.then(function () {
                        _progress('Uploading: ' + book.title + '...');
                        return _uploadBookContent(book.id).then(function (driveFileId) {
                            // Update driveFileId in merged bookList
                            for (var j = 0; j < result.merged.bookList.length; j++) {
                                if (result.merged.bookList[j].id === book.id) {
                                    result.merged.bookList[j].driveFileId = driveFileId;
                                    break;
                                }
                            }
                            summary.uploaded++;
                        });
                    });
                })(result.booksToUpload[i]);
            }

            // Delete cloud files for books deleted locally
            var localDeleted = data.local.deletedBooks || [];
            for (var di = 0; di < localDeleted.length; di++) {
                (function (del) {
                    uploadChain = uploadChain.then(function () {
                        var fname = 'book_' + del.id + '.txt';
                        var fid = fileIdCache[fname];
                        if (fid) {
                            _progress('Deleting cloud: ' + del.id + '...');
                            return _deleteFile(fid).then(function () {
                                summary.deleted++;
                                delete fileIdCache[fname];
                            }).catch(function () {});
                        }
                    });
                })(localDeleted[di]);
            }

            return uploadChain.then(function () {
                // Upload updated sync-meta.json
                _progress('Uploading sync metadata...');
                var metaJson = JSON.stringify(result.merged);
                var existingId = fileIdCache[META_FILENAME];
                return _uploadFile(META_FILENAME, metaJson, 'application/json', existingId || null);
            }).then(function () {
                // Apply merged data locally
                _progress('Applying changes...');
                return _applyMergedToLocal(result.merged);
            }).then(function () {
                summary.updated = Object.keys(result.merged.progress).length;
                return summary;
            });
        }).then(function (result) {
            syncInProgress = false;
            _saveSyncState({ lastSync: Date.now() });
            return result;
        }).catch(function (err) {
            syncInProgress = false;
            throw err;
        });
    }

    // Upload a single book's content to Drive
    function _uploadBookContent(bookId) {
        return ReaderLib.getBookContent(bookId).then(function (content) {
            if (!content) throw new Error('No content for book ' + bookId);
            var fileName = 'book_' + bookId + '.txt';
            var existingId = fileIdCache[fileName];
            return _uploadFile(fileName, content, 'text/plain; charset=utf-8', existingId || null)
                .then(function (data) { return data.id; });
        });
    }

    // Upload a specific book (manual)
    function uploadBook(bookId) {
        return _ensureToken().then(function () {
            return _uploadBookContent(bookId);
        });
    }

    // Download a cloud-only book to local IDB
    function downloadBook(bookInfo) {
        if (!bookInfo || !bookInfo.driveFileId) {
            return Promise.reject(new Error('No driveFileId'));
        }
        return _ensureToken().then(function () {
            return _readFile(bookInfo.driveFileId);
        }).then(function (content) {
            // Save metadata
            var meta = {
                id: bookInfo.id,
                title: bookInfo.title,
                size: bookInfo.size,
                dateAdded: bookInfo.dateAdded,
                format: bookInfo.format || 'txt'
            };
            // Compute chapters
            meta.chapters = ReaderLib.splitChapters(content);
            return ReaderLib.saveBookMeta(meta).then(function () {
                return ReaderLib.saveBookContent(meta.id, content);
            }).then(function () {
                // Remove from cloudOnlyBooks
                cloudOnlyBooks = cloudOnlyBooks.filter(function (b) { return b.id !== bookInfo.id; });
                return meta;
            });
        });
    }

    // Remove a cloud book + add tombstone
    function removeCloudBook(bookInfo) {
        return _ensureToken().then(function () {
            if (bookInfo.driveFileId) {
                return _deleteFile(bookInfo.driveFileId).catch(function () {});
            }
        }).then(function () {
            _addDeletedBook(bookInfo.id);
            cloudOnlyBooks = cloudOnlyBooks.filter(function (b) { return b.id !== bookInfo.id; });
        });
    }

    function getCloudOnlyBooks() {
        return cloudOnlyBooks;
    }

    // Track book deletion locally (for sync tombstone)
    function trackDeletion(bookId) {
        _addDeletedBook(bookId);
    }

    window.CloudSync = {
        init: init,
        signIn: signIn,
        signOut: signOut,
        isSignedIn: isSignedIn,
        sync: sync,
        uploadBook: uploadBook,
        downloadBook: downloadBook,
        removeCloudBook: removeCloudBook,
        getCloudOnlyBooks: getCloudOnlyBooks,
        getLastSyncTime: getLastSyncTime,
        trackDeletion: trackDeletion
    };
})();
