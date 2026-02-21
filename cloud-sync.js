// ===== GoogleDriveProvider — Google Drive sync via appDataFolder =====
(function () {
    // --- Config ---
    var CLIENT_ID = '513161269917-d1d55qhfvp6virr9oemdflea7lvb9a8k.apps.googleusercontent.com';
    var SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
    var META_FILENAME = 'sync-meta.json';
    var TOKEN_KEY = 'vp_drive_token';
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
    var _pendingSignIn = null;

    // --- Token Management ---

    function _saveToken(token, expiresIn) {
        accessToken = token;
        tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
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

    window.__onGisLoaded = function () {
        _initGis();
    };

    function init() {
        _loadToken();
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
            fileIdCache = {};
            for (var i = 0; i < files.length; i++) {
                fileIdCache[files[i].name] = files[i].id;
            }
            return files;
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

    function _uploadFile(name, content, mimeType, existingFileId) {
        mimeType = mimeType || 'application/octet-stream';
        var body = content;
        var bodySize = new Blob([body]).size;

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

        var blob = new Blob([multipart, body, ending]);

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

    function _uploadResumable(name, content, mimeType, existingFileId) {
        var metadata = existingFileId
            ? {}
            : { name: name, parents: ['appDataFolder'] };

        var url = existingFileId
            ? 'https://www.googleapis.com/upload/drive/v3/files/' + existingFileId + '?uploadType=resumable'
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';

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
            var metaFileId = fileIdCache[META_FILENAME];
            if (metaFileId) {
                _progress('Downloading sync metadata...');
                return _readFileJson(metaFileId);
            }
            return null;
        }).then(function (cloudMeta) {
            _progress('Building local snapshot...');
            return SyncCommon.buildLocalMeta().then(function (localMeta) {
                return { local: localMeta, cloud: cloudMeta };
            });
        }).then(function (data) {
            _progress('Merging...');
            var result = SyncCommon.mergeMetadata(data.local, data.cloud);
            cloudOnlyBooks = result.booksCloudOnly;

            // Upload new book files
            var uploadChain = Promise.resolve();
            for (var i = 0; i < result.booksToUpload.length; i++) {
                (function (book) {
                    uploadChain = uploadChain.then(function () {
                        _progress('Uploading: ' + book.title + '...');
                        return _uploadBookContent(book.id).then(function (driveFileId) {
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
                _progress('Uploading sync metadata...');
                var metaJson = JSON.stringify(result.merged);
                var existingId = fileIdCache[META_FILENAME];
                return _uploadFile(META_FILENAME, metaJson, 'application/json', existingId || null);
            }).then(function () {
                _progress('Applying changes...');
                return SyncCommon.applyMergedToLocal(result.merged, result.booksCloudOnly);
            }).then(function () {
                summary.updated = Object.keys(result.merged.progress).length;
                return summary;
            });
        }).then(function (result) {
            syncInProgress = false;
            SyncCommon.saveSyncState({ lastSync: Date.now() });
            return result;
        }).catch(function (err) {
            syncInProgress = false;
            throw err;
        });
    }

    function _uploadBookContent(bookId) {
        return ReaderLib.getBookContent(bookId).then(function (content) {
            if (!content) throw new Error('No content for book ' + bookId);
            var fileName = 'book_' + bookId + '.txt';
            var existingId = fileIdCache[fileName];
            return _uploadFile(fileName, content, 'text/plain; charset=utf-8', existingId || null)
                .then(function (data) { return data.id; });
        });
    }

    function uploadBook(bookId) {
        return _ensureToken().then(function () {
            return _uploadBookContent(bookId);
        });
    }

    function downloadBook(bookInfo) {
        if (!bookInfo || !bookInfo.driveFileId) {
            return Promise.reject(new Error('No driveFileId'));
        }
        return _ensureToken().then(function () {
            return _readFile(bookInfo.driveFileId);
        }).then(function (content) {
            var meta = {
                id: bookInfo.id,
                title: bookInfo.title,
                size: bookInfo.size,
                dateAdded: bookInfo.dateAdded,
                format: bookInfo.format || 'txt'
            };
            meta.chapters = ReaderLib.splitChapters(content);
            return ReaderLib.saveBookMeta(meta).then(function () {
                return ReaderLib.saveBookContent(meta.id, content);
            }).then(function () {
                cloudOnlyBooks = cloudOnlyBooks.filter(function (b) { return b.id !== bookInfo.id; });
                return meta;
            });
        });
    }

    function removeCloudBook(bookInfo) {
        return _ensureToken().then(function () {
            if (bookInfo.driveFileId) {
                return _deleteFile(bookInfo.driveFileId).catch(function () {});
            }
        }).then(function () {
            SyncCommon.addDeletedBook(bookInfo.id);
            cloudOnlyBooks = cloudOnlyBooks.filter(function (b) { return b.id !== bookInfo.id; });
        });
    }

    function getCloudOnlyBooks() {
        return cloudOnlyBooks;
    }

    function trackDeletion(bookId) {
        SyncCommon.addDeletedBook(bookId);
    }

    window.GoogleDriveProvider = {
        providerName: 'google',
        init: init,
        signIn: signIn,
        signOut: signOut,
        isSignedIn: isSignedIn,
        sync: sync,
        uploadBook: uploadBook,
        downloadBook: downloadBook,
        removeCloudBook: removeCloudBook,
        getCloudOnlyBooks: getCloudOnlyBooks,
        getLastSyncTime: SyncCommon.getLastSyncTime,
        trackDeletion: trackDeletion
    };
})();

// ===== CloudSync Dispatcher =====
(function () {
    var PROVIDER_KEY = 'vp_sync_provider';
    var activeProvider = null;

    var providers = {
        google: function () { return window.GoogleDriveProvider; },
        github: function () { return window.GitHubGistProvider; }
    };

    function _getProvider() {
        if (activeProvider) return activeProvider;
        var name = localStorage.getItem(PROVIDER_KEY);
        if (name && providers[name]) {
            activeProvider = providers[name]();
        }
        return activeProvider;
    }

    function setProvider(name) {
        if (!providers[name]) throw new Error('Unknown provider: ' + name);
        localStorage.setItem(PROVIDER_KEY, name);
        activeProvider = providers[name]();
    }

    function getActiveProviderName() {
        var p = _getProvider();
        return p ? p.providerName : null;
    }

    function _delegate(method, args) {
        var p = _getProvider();
        if (!p) throw new Error('No sync provider selected');
        return p[method].apply(p, args);
    }

    window.CloudSync = {
        setProvider: setProvider,
        getActiveProviderName: getActiveProviderName,
        init: function () {
            // Init whichever provider was last used
            var name = localStorage.getItem(PROVIDER_KEY);
            if (name && providers[name]) {
                activeProvider = providers[name]();
                if (activeProvider && activeProvider.init) activeProvider.init();
            } else {
                // Default: try Google if token exists
                if (localStorage.getItem('vp_drive_token')) {
                    setProvider('google');
                    if (activeProvider && activeProvider.init) activeProvider.init();
                } else if (localStorage.getItem('vp_github_token')) {
                    setProvider('github');
                    if (activeProvider && activeProvider.init) activeProvider.init();
                }
            }
        },
        signIn: function () { return _delegate('signIn', arguments); },
        signOut: function () { return _delegate('signOut', arguments); },
        isSignedIn: function () {
            var p = _getProvider();
            return p ? p.isSignedIn() : false;
        },
        sync: function () { return _delegate('sync', arguments); },
        uploadBook: function () { return _delegate('uploadBook', arguments); },
        downloadBook: function () { return _delegate('downloadBook', arguments); },
        removeCloudBook: function () { return _delegate('removeCloudBook', arguments); },
        getCloudOnlyBooks: function () {
            var p = _getProvider();
            return p ? p.getCloudOnlyBooks() : [];
        },
        getLastSyncTime: function () {
            return SyncCommon.getLastSyncTime();
        },
        trackDeletion: function (bookId) {
            SyncCommon.addDeletedBook(bookId);
        }
    };
})();
