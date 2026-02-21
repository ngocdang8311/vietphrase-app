// ===== GitHubGistProvider — GitHub Gist sync via Device Flow =====
(function () {
    var CLIENT_ID = 'Ov23li7UFjZu0LQmc1Xu';
    var DEVICE_CODE_URL = '/api/github/device-code';
    var ACCESS_TOKEN_URL = '/api/github/access-token';
    var GIST_API = 'https://api.github.com/gists';
    var META_FILENAME = 'sync-meta.json';
    var TOKEN_KEY = 'vp_github_token';
    var GIST_ID_KEY = 'vp_github_gist_id';
    var GIST_DESCRIPTION = 'vietphrase-sync';
    var MAX_RETRIES = 3;
    var RETRY_DELAYS = [1000, 2000, 4000];

    // --- State ---
    var accessToken = null;
    var gistId = null;
    var syncInProgress = false;
    var cloudOnlyBooks = [];
    var _pollAbort = null; // AbortController for polling

    // --- Token ---

    function _loadToken() {
        try {
            accessToken = localStorage.getItem(TOKEN_KEY) || null;
            gistId = localStorage.getItem(GIST_ID_KEY) || null;
            return !!accessToken;
        } catch (e) { return false; }
    }

    function _saveToken(token) {
        accessToken = token;
        try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    }

    function _clearToken() {
        accessToken = null;
        gistId = null;
        try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(GIST_ID_KEY);
        } catch (e) {}
    }

    function _saveGistId(id) {
        gistId = id;
        try { localStorage.setItem(GIST_ID_KEY, id); } catch (e) {}
    }

    // --- Fetch with Auth + Retry ---

    function _ghFetch(url, opts) {
        opts = opts || {};
        function attempt(retryCount) {
            if (!accessToken) return Promise.reject(new Error('TOKEN_EXPIRED'));
            var headers = opts.headers ? Object.assign({}, opts.headers) : {};
            headers['Authorization'] = 'token ' + accessToken;
            headers['Accept'] = 'application/vnd.github+json';
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
                    }).then(function () { return attempt(retryCount + 1); });
                }
                throw new Error('HTTP ' + resp.status);
            }).catch(function (err) {
                if (err.message === 'TOKEN_EXPIRED') throw err;
                if (err.name === 'TypeError' && retryCount < MAX_RETRIES) {
                    return new Promise(function (resolve) {
                        setTimeout(resolve, RETRY_DELAYS[retryCount] || 4000);
                    }).then(function () { return attempt(retryCount + 1); });
                }
                throw err;
            });
        }
        return attempt(0);
    }

    // --- Auth: Device Flow ---

    function signIn(opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            // Step 1: Request device code via proxy
            fetch(DEVICE_CODE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: CLIENT_ID, scope: 'gist' })
            }).then(function (resp) { return resp.json(); })
            .then(function (data) {
                if (data.error) {
                    reject(new Error(data.error_description || data.error));
                    return;
                }

                var deviceCode = data.device_code;
                var userCode = data.user_code;
                var verificationUri = data.verification_uri;
                var interval = (data.interval || 5) * 1000;
                var expiresAt = Date.now() + (data.expires_in || 900) * 1000;

                // Notify UI to show code
                if (opts.onDeviceCode) {
                    opts.onDeviceCode({
                        userCode: userCode,
                        verificationUri: verificationUri
                    });
                }

                // Step 2: Poll for token
                _pollAbort = { cancelled: false };
                var currentAbort = _pollAbort;

                function poll() {
                    if (currentAbort.cancelled) {
                        reject(new Error('Sign-in cancelled'));
                        return;
                    }
                    if (Date.now() > expiresAt) {
                        reject(new Error('Device code expired. Please try again.'));
                        return;
                    }

                    fetch(ACCESS_TOKEN_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            client_id: CLIENT_ID,
                            device_code: deviceCode,
                            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                        })
                    }).then(function (resp) { return resp.json(); })
                    .then(function (tokenData) {
                        if (tokenData.access_token) {
                            _saveToken(tokenData.access_token);
                            _pollAbort = null;
                            resolve();
                            return;
                        }
                        if (tokenData.error === 'authorization_pending') {
                            setTimeout(poll, interval);
                            return;
                        }
                        if (tokenData.error === 'slow_down') {
                            interval += 5000;
                            setTimeout(poll, interval);
                            return;
                        }
                        reject(new Error(tokenData.error_description || tokenData.error || 'Unknown error'));
                    }).catch(function (err) {
                        // Network error during poll — retry
                        setTimeout(poll, interval);
                    });
                }

                setTimeout(poll, interval);

            }).catch(reject);
        });
    }

    function signOut() {
        // GitHub tokens can't be revoked client-side (needs client_secret)
        _clearToken();
        cloudOnlyBooks = [];
    }

    function cancelSignIn() {
        if (_pollAbort) {
            _pollAbort.cancelled = true;
            _pollAbort = null;
        }
    }

    function init() {
        _loadToken();
    }

    function isSignedIn() {
        return !!accessToken;
    }

    // --- Gist CRUD ---

    function _findOrCreateGist() {
        // Use cached gist ID if available
        if (gistId) {
            return _ghFetch(GIST_API + '/' + gistId).then(function (resp) {
                return resp.json();
            }).then(function (gist) {
                return gist;
            }).catch(function () {
                // Gist might have been deleted — search again
                gistId = null;
                try { localStorage.removeItem(GIST_ID_KEY); } catch (e) {}
                return _findOrCreateGist();
            });
        }

        // Search user's gists for our sync gist
        return _ghFetch(GIST_API + '?per_page=100').then(function (resp) {
            return resp.json();
        }).then(function (gists) {
            for (var i = 0; i < gists.length; i++) {
                if (gists[i].description === GIST_DESCRIPTION) {
                    _saveGistId(gists[i].id);
                    return gists[i];
                }
            }
            // Not found — create new
            return _ghFetch(GIST_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: GIST_DESCRIPTION,
                    public: false,
                    files: {
                        'sync-meta.json': { content: '{}' }
                    }
                })
            }).then(function (resp) { return resp.json(); })
            .then(function (gist) {
                _saveGistId(gist.id);
                return gist;
            });
        });
    }

    function _readGistFile(gist, filename) {
        var file = gist.files[filename];
        if (!file) return Promise.resolve(null);
        // If truncated, fetch raw_url
        if (file.truncated && file.raw_url) {
            return _ghFetch(file.raw_url).then(function (resp) { return resp.text(); });
        }
        return Promise.resolve(file.content);
    }

    function _updateGistFiles(updates, deletes) {
        if (!gistId) return Promise.reject(new Error('No gist ID'));
        var files = {};

        // Files to update/create
        if (updates) {
            for (var name in updates) {
                if (updates.hasOwnProperty(name)) {
                    files[name] = { content: updates[name] };
                }
            }
        }

        // Files to delete (set to null)
        if (deletes) {
            for (var i = 0; i < deletes.length; i++) {
                files[deletes[i]] = null;
            }
        }

        return _ghFetch(GIST_API + '/' + gistId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: files })
        }).then(function (resp) { return resp.json(); });
    }

    // --- Main Sync ---

    function sync(onProgress) {
        if (syncInProgress) return Promise.reject(new Error('Sync already in progress'));
        syncInProgress = true;
        var summary = { uploaded: 0, downloaded: 0, updated: 0, deleted: 0 };

        function _progress(msg) {
            if (onProgress) onProgress(msg);
        }

        var currentGist;

        return Promise.resolve().then(function () {
            _progress('Finding sync gist...');
            return _findOrCreateGist();
        }).then(function (gist) {
            currentGist = gist;
            // Read sync-meta.json from gist
            return _readGistFile(gist, META_FILENAME);
        }).then(function (metaContent) {
            var cloudMeta = null;
            if (metaContent) {
                try { cloudMeta = JSON.parse(metaContent); } catch (e) {}
            }
            // Skip empty initial meta
            if (cloudMeta && Object.keys(cloudMeta).length === 0) cloudMeta = null;

            _progress('Building local snapshot...');
            return SyncCommon.buildLocalMeta().then(function (localMeta) {
                return { local: localMeta, cloud: cloudMeta };
            });
        }).then(function (data) {
            _progress('Merging...');
            var result = SyncCommon.mergeMetadata(data.local, data.cloud);
            cloudOnlyBooks = result.booksCloudOnly;

            // Prepare batch updates for gist
            var gistUpdates = {};
            var gistDeletes = [];

            // Upload new book content files
            var uploadChain = Promise.resolve();
            for (var i = 0; i < result.booksToUpload.length; i++) {
                (function (book) {
                    uploadChain = uploadChain.then(function () {
                        _progress('Uploading: ' + book.title + '...');
                        return ReaderLib.getBookContent(book.id).then(function (content) {
                            if (!content) return;
                            var fname = 'book_' + book.id + '.txt';
                            gistUpdates[fname] = content;
                            // Set cloudRef in merged bookList
                            for (var j = 0; j < result.merged.bookList.length; j++) {
                                if (result.merged.bookList[j].id === book.id) {
                                    result.merged.bookList[j].cloudRef = fname;
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
                var fname = 'book_' + localDeleted[di].id + '.txt';
                if (currentGist.files[fname]) {
                    gistDeletes.push(fname);
                    summary.deleted++;
                }
            }

            return uploadChain.then(function () {
                gistUpdates[META_FILENAME] = JSON.stringify(result.merged);
                _progress('Updating gist...');
                return _updateGistFiles(gistUpdates, gistDeletes.length > 0 ? gistDeletes : undefined);
            }).then(function () {
                _progress('Applying changes...');
                return SyncCommon.applyMergedToLocal(result.merged);
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

    // Upload a specific book
    function uploadBook(bookId) {
        return _findOrCreateGist().then(function () {
            return ReaderLib.getBookContent(bookId);
        }).then(function (content) {
            if (!content) throw new Error('No content for book ' + bookId);
            var fname = 'book_' + bookId + '.txt';
            var updates = {};
            updates[fname] = content;
            return _updateGistFiles(updates);
        });
    }

    // Download a cloud-only book
    function downloadBook(bookInfo) {
        if (!bookInfo || !bookInfo.cloudRef) {
            return Promise.reject(new Error('No cloudRef'));
        }
        return _findOrCreateGist().then(function (gist) {
            return _readGistFile(gist, bookInfo.cloudRef);
        }).then(function (content) {
            if (!content) throw new Error('Book content not found in gist');
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

    // Remove a cloud book
    function removeCloudBook(bookInfo) {
        var deletes = [];
        if (bookInfo.cloudRef) deletes.push(bookInfo.cloudRef);
        SyncCommon.addDeletedBook(bookInfo.id);
        cloudOnlyBooks = cloudOnlyBooks.filter(function (b) { return b.id !== bookInfo.id; });
        if (deletes.length > 0) {
            return _updateGistFiles(null, deletes).catch(function () {});
        }
        return Promise.resolve();
    }

    function getCloudOnlyBooks() {
        return cloudOnlyBooks;
    }

    function trackDeletion(bookId) {
        SyncCommon.addDeletedBook(bookId);
    }

    window.GitHubGistProvider = {
        providerName: 'github',
        init: init,
        signIn: signIn,
        signOut: signOut,
        cancelSignIn: cancelSignIn,
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
