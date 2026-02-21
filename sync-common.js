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
                var matched = false;
                for (var cid in cloudBookMap) {
                    if (cloudBookMap.hasOwnProperty(cid)) {
                        var ck2 = cloudBookMap[cid].title + '|' + cloudBookMap[cid].size;
                        if (ck2 === dedupKey) { matched = true; break; }
                    }
                }
                if (!matched) {
                    booksToUpload.push(inLocal);
                }
                merged.bookList.push(inLocal);
            } else if (!inLocal && inCloud) {
                var cDedupKey = inCloud.title + '|' + inCloud.size;
                if (localDedupKey[cDedupKey]) {
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
            if (deletedIds[pKey]) continue;
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

    function applyMergedToLocal(merged) {
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

        return Promise.all(progressPromises.concat(deletePromises));
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
