// ===== SyncCommon — Shared sync logic for all providers =====
(function () {
    var SYNC_STATE_KEY = 'vp_sync_state';
    var DELETED_BOOKS_KEY = 'vp_deleted_books';

    // --- Tombstone helpers ---

    function getDeletedBooks() {
        try {
            return JSON.parse(localStorage.getItem(DELETED_BOOKS_KEY)) || [];
        } catch (e) { return []; }
    }

    function setDeletedBooks(arr) {
        try { localStorage.setItem(DELETED_BOOKS_KEY, JSON.stringify(arr)); } catch (e) {}
    }

    function addDeletedBook(id) {
        var arr = getDeletedBooks();
        if (!arr.some(function (d) { return d.id === id; })) {
            arr.push({ id: id, deletedAt: Date.now() });
            setDeletedBooks(arr);
        }
    }

    // --- Sync state ---

    function saveSyncState(state) {
        try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function getLastSyncTime() {
        try {
            var state = JSON.parse(localStorage.getItem(SYNC_STATE_KEY));
            return state ? state.lastSync : null;
        } catch (e) { return null; }
    }

    // --- Build local metadata snapshot ---

    function buildLocalMeta() {
        var result = {
            settings: {},
            customPhrases: {},
            bookList: [],
            progress: {},
            deletedBooks: getDeletedBooks()
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
                if (b.cloudOnly) continue; // skip cloud stubs
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

    function mergeMetadata(local, cloud) {
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
            if (cloudPhrases.hasOwnProperty(k)) allPhrases[k] = cloudPhrases[k];
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

        // Build deleted ID set
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
        if (cloud && cloud.bookList) {
            for (var ci = 0; ci < cloud.bookList.length; ci++) {
                var cb = cloud.bookList[ci];
                if (!deletedIds[cb.id]) {
                    cloudBookMap[cb.id] = cb;
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

        var booksToUpload = [];
        var booksCloudOnly = [];
        var dedupProgressMap = {}; // cloudBookId -> localBookId (for deduped books)

        var allBookIds = {};
        for (var mk in localBookMap) { if (localBookMap.hasOwnProperty(mk)) allBookIds[mk] = true; }
        for (var ck in cloudBookMap) { if (cloudBookMap.hasOwnProperty(ck)) allBookIds[ck] = true; }

        for (var bid in allBookIds) {
            if (!allBookIds.hasOwnProperty(bid)) continue;
            var inLocal = localBookMap[bid];
            var inCloud = cloudBookMap[bid];

            if (inLocal && inCloud) {
                var entry = {};
                for (var ek in inLocal) { if (inLocal.hasOwnProperty(ek)) entry[ek] = inLocal[ek]; }
                if (inCloud.cloudRef) entry.cloudRef = inCloud.cloudRef;
                if (inCloud.driveFileId) entry.driveFileId = inCloud.driveFileId;
                merged.bookList.push(entry);
            } else if (inLocal && !inCloud) {
                var dedupKey = inLocal.title + '|' + inLocal.size;
                var matchedCloudBook = null;
                for (var cid in cloudBookMap) {
                    if (cloudBookMap.hasOwnProperty(cid)) {
                        var ck2 = cloudBookMap[cid].title + '|' + cloudBookMap[cid].size;
                        if (ck2 === dedupKey) { matchedCloudBook = cloudBookMap[cid]; break; }
                    }
                }
                if (matchedCloudBook) {
                    // Same book imported on both devices (different IDs) — keep local ID, adopt cloud refs
                    if (matchedCloudBook.cloudRef) inLocal.cloudRef = matchedCloudBook.cloudRef;
                    if (matchedCloudBook.driveFileId) inLocal.driveFileId = matchedCloudBook.driveFileId;
                } else {
                    booksToUpload.push(inLocal);
                }
                merged.bookList.push(inLocal);
            } else if (!inLocal && inCloud) {
                var cDedupKey = inCloud.title + '|' + inCloud.size;
                var matchedLocalId = localDedupKey[cDedupKey];
                if (matchedLocalId) {
                    // Duplicate — skip cloud version (local version already in merged.bookList)
                    // Remap cloud progress to local book ID
                    dedupProgressMap[inCloud.id] = matchedLocalId;
                } else {
                    booksCloudOnly.push(inCloud);
                    merged.bookList.push(inCloud);
                }
            }
        }

        // 5. Progress: per book, newer lastRead wins
        // Remap cloud progress for deduped books (cloud ID -> local ID)
        var localProgress = local.progress || {};
        var cloudProgress = (cloud && cloud.progress) || {};
        var remappedCloudProgress = {};
        for (var cpk in cloudProgress) {
            if (cloudProgress.hasOwnProperty(cpk)) {
                var targetKey = dedupProgressMap[cpk] || cpk;
                var cp = cloudProgress[cpk];
                // Update bookId to match canonical ID
                if (targetKey !== cpk) {
                    cp = {};
                    for (var cpf in cloudProgress[cpk]) {
                        if (cloudProgress[cpk].hasOwnProperty(cpf)) cp[cpf] = cloudProgress[cpk][cpf];
                    }
                    cp.bookId = targetKey;
                }
                remappedCloudProgress[targetKey] = cp;
            }
        }

        var allProgressKeys = {};
        for (var pk in localProgress) { if (localProgress.hasOwnProperty(pk)) allProgressKeys[pk] = true; }
        for (var rpk in remappedCloudProgress) { if (remappedCloudProgress.hasOwnProperty(rpk)) allProgressKeys[rpk] = true; }

        for (var pKey in allProgressKeys) {
            if (!allProgressKeys.hasOwnProperty(pKey)) continue;
            if (deletedIds[pKey]) continue;
            var lp = localProgress[pKey];
            var rcp = remappedCloudProgress[pKey];
            if (lp && rcp) {
                merged.progress[pKey] = (rcp.lastRead || 0) > (lp.lastRead || 0) ? rcp : lp;
            } else {
                merged.progress[pKey] = lp || rcp;
            }
        }

        return {
            merged: merged,
            booksToUpload: booksToUpload,
            booksCloudOnly: booksCloudOnly
        };
    }

    // --- Apply Merged Data to Local ---

    function applyMergedToLocal(merged, booksCloudOnly) {
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

        // Deletions
        var deletePromises = [];
        if (merged.deletedBooks) {
            for (var i = 0; i < merged.deletedBooks.length; i++) {
                deletePromises.push(ReaderLib.deleteBook(merged.deletedBooks[i].id).catch(function () {}));
            }
        }

        setDeletedBooks(merged.deletedBooks || []);

        // Save cloud-only book stubs to IDB + cleanup stale stubs
        var cloudStubPromises = [];
        if (booksCloudOnly && booksCloudOnly.length > 0) {
            var cloudOnlyIds = {};
            for (var ci = 0; ci < booksCloudOnly.length; ci++) {
                var cb = booksCloudOnly[ci];
                cloudOnlyIds[cb.id] = true;
                var stub = {
                    id: cb.id,
                    title: cb.title,
                    size: cb.size,
                    dateAdded: cb.dateAdded,
                    format: cb.format || 'txt',
                    chapters: cb.chapters || null,
                    cloudOnly: true
                };
                if (cb.cloudRef) stub.cloudRef = cb.cloudRef;
                if (cb.driveFileId) stub.driveFileId = cb.driveFileId;
                cloudStubPromises.push(ReaderLib.saveBookMeta(stub));
            }
        }

        // Cleanup stale cloud stubs: remove IDB entries with cloudOnly=true that are no longer in merged.bookList
        var cleanupPromise = ReaderLib.getAllBooksMeta().then(function (allBooks) {
            var mergedIds = {};
            if (merged.bookList) {
                for (var mi = 0; mi < merged.bookList.length; mi++) {
                    mergedIds[merged.bookList[mi].id] = true;
                }
            }
            var staleDeletes = [];
            for (var si = 0; si < allBooks.length; si++) {
                if (allBooks[si].cloudOnly && !mergedIds[allBooks[si].id]) {
                    staleDeletes.push(ReaderLib.deleteBook(allBooks[si].id).catch(function () {}));
                }
            }
            return Promise.all(staleDeletes);
        });

        return Promise.all(progressPromises.concat(deletePromises).concat(cloudStubPromises)).then(function () {
            return cleanupPromise;
        });
    }

    window.SyncCommon = {
        getDeletedBooks: getDeletedBooks,
        setDeletedBooks: setDeletedBooks,
        addDeletedBook: addDeletedBook,
        saveSyncState: saveSyncState,
        getLastSyncTime: getLastSyncTime,
        buildLocalMeta: buildLocalMeta,
        mergeMetadata: mergeMetadata,
        applyMergedToLocal: applyMergedToLocal
    };
})();
