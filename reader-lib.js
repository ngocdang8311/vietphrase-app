// ===== ReaderLib — Book Library Engine =====
// IDB (vietphrase-reader) v2: books (metadata) + books-content (content) + progress
(function () {
    var DB_NAME = 'vietphrase-reader';
    var DB_VERSION = 2;
    var MIGRATION_KEY = 'vp_reader_needsMigration';

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                var oldVersion = e.oldVersion || 0;
                // v1 stores
                if (!db.objectStoreNames.contains('books')) {
                    var store = db.createObjectStore('books', { keyPath: 'id' });
                    store.createIndex('dateAdded', 'dateAdded', { unique: false });
                }
                if (!db.objectStoreNames.contains('progress')) {
                    db.createObjectStore('progress', { keyPath: 'bookId' });
                }
                // v2: split content into separate store
                if (oldVersion < 2) {
                    if (!db.objectStoreNames.contains('books-content')) {
                        db.createObjectStore('books-content', { keyPath: 'id' });
                    }
                    // Flag lazy migration needed (v1 data has content in books store)
                    try { localStorage.setItem(MIGRATION_KEY, '1'); } catch (ex) {}
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    // Strip HTML tags, preserve line breaks from block elements
    function stripHtmlTags(html) {
        try {
            // Replace block elements with newlines before stripping
            var cleaned = html
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
                .replace(/<(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n');
            var doc = new DOMParser().parseFromString(cleaned, 'text/html');
            var text = doc.body.textContent || '';
            // Clean up excessive newlines
            text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
            return text;
        } catch (e) {
            // Regex fallback
            return html
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
                .replace(/\n{3,}/g, '\n\n').trim();
        }
    }

    // Split content into chapters using Chinese chapter heading patterns
    var CHAPTER_RE = /^[\s\u3000]*\u7B2C[\u96F6\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\uFF10-\uFF19\u0030-\u0039]+[\u7AE0\u8282\u56DE\u7BC7\u96C6\u5377\u90E8]/m;

    function splitChapters(content) {
        var matches = [];
        var re = new RegExp(CHAPTER_RE.source, 'gm');
        var m;
        while ((m = re.exec(content)) !== null) {
            matches.push({ index: m.index, title: m[0].trim() });
        }
        if (matches.length < 2) {
            return { hasChapters: false, chapters: [] };
        }
        var chapters = [];
        for (var i = 0; i < matches.length; i++) {
            var start = matches[i].index;
            var end = i + 1 < matches.length ? matches[i + 1].index : content.length;
            // Extract title: first non-empty line from the chapter start
            var snippet = content.substring(start, Math.min(start + 200, end));
            var slines = snippet.split('\n');
            var title = '';
            for (var k = 0; k < slines.length; k++) {
                var sl = slines[k].trim();
                if (sl) { title = sl; break; }
            }
            if (!title) title = matches[i].title;
            chapters.push({ title: title, start: start, end: end });
        }
        // If there's content before the first chapter, prepend as "Mở đầu"
        if (matches[0].index > 0) {
            var preContent = content.substring(0, matches[0].index).trim();
            if (preContent.length > 50) {
                chapters.unshift({ title: 'Mở đầu', start: 0, end: matches[0].index });
            }
        }
        return { hasChapters: true, chapters: chapters };
    }

    // Generate unique book ID
    function generateId() {
        var hex = Math.random().toString(16).substring(2, 6);
        return 'book_' + Date.now() + '_' + hex;
    }

    // --- Public API ---

    function importBook(title, content, format) {
        var text = content;
        if (format === 'html') {
            text = stripHtmlTags(content);
        }
        var id = generateId();
        var chaptersInfo = splitChapters(text);
        var meta = {
            id: id,
            title: title,
            size: new Blob([text]).size,
            dateAdded: Date.now(),
            format: format || 'txt',
            chapters: chaptersInfo
        };
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(['books', 'books-content'], 'readwrite');
                tx.objectStore('books').put(meta);
                tx.objectStore('books-content').put({ id: id, content: text });
                tx.oncomplete = function () {
                    db.close();
                    resolve({ id: id, chapterCount: chaptersInfo.chapters.length });
                };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // Get full book (metadata + content merged)
    function getBook(id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(['books', 'books-content'], 'readonly');
                var metaReq = tx.objectStore('books').get(id);
                var contentReq = tx.objectStore('books-content').get(id);
                tx.oncomplete = function () {
                    db.close();
                    var meta = metaReq.result;
                    if (!meta) { resolve(null); return; }
                    var contentRec = contentReq.result;
                    if (contentRec && contentRec.content) {
                        meta.content = contentRec.content;
                    }
                    // Fallback: v1 record might still have content in meta (pre-migration)
                    resolve(meta);
                };
                tx.onerror = function () { db.close(); resolve(null); };
            });
        });
    }

    // Get only content (for sync upload)
    function getBookContent(id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('books-content', 'readonly');
                var req = tx.objectStore('books-content').get(id);
                req.onsuccess = function () {
                    db.close();
                    resolve(req.result ? req.result.content : null);
                };
                req.onerror = function () { db.close(); resolve(null); };
            });
        });
    }

    function getAllBooks() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(['books', 'books-content'], 'readonly');
                var metaReq = tx.objectStore('books').index('dateAdded').getAll();
                var contentReq = tx.objectStore('books-content').getAll();
                tx.oncomplete = function () {
                    db.close();
                    var metas = metaReq.result || [];
                    var contents = contentReq.result || [];
                    // Build content lookup
                    var contentMap = {};
                    for (var i = 0; i < contents.length; i++) {
                        contentMap[contents[i].id] = contents[i].content;
                    }
                    // Merge
                    for (var j = 0; j < metas.length; j++) {
                        if (!metas[j].content && contentMap[metas[j].id]) {
                            metas[j].content = contentMap[metas[j].id];
                        }
                    }
                    metas.reverse();
                    resolve(metas);
                };
                tx.onerror = function () { db.close(); resolve([]); };
            });
        });
    }

    // Return book metadata without content (for library listing) — fast, ~1KB/record
    function getAllBooksMeta() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('books', 'readonly');
                var req = tx.objectStore('books').index('dateAdded').getAll();
                req.onsuccess = function () {
                    db.close();
                    var books = req.result || [];
                    // Strip any leftover content field from pre-migration records
                    var result = [];
                    for (var i = 0; i < books.length; i++) {
                        var b = books[i];
                        result.push({
                            id: b.id,
                            title: b.title,
                            size: b.size,
                            dateAdded: b.dateAdded,
                            format: b.format,
                            chapters: b.chapters || null
                        });
                    }
                    result.reverse();
                    resolve(result);
                };
                req.onerror = function () { db.close(); resolve([]); };
            });
        });
    }

    // Update metadata only (does NOT touch content)
    function updateBook(record) {
        // Strip content to avoid putting it back in metadata store
        var meta = {};
        for (var key in record) {
            if (record.hasOwnProperty(key) && key !== 'content') {
                meta[key] = record[key];
            }
        }
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('books', 'readwrite');
                tx.objectStore('books').put(meta);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function deleteBook(id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(['books', 'books-content', 'progress'], 'readwrite');
                tx.objectStore('books').delete(id);
                tx.objectStore('books-content').delete(id);
                tx.objectStore('progress').delete(id);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function saveProgress(data) {
        data.lastRead = Date.now();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('progress', 'readwrite');
                tx.objectStore('progress').put(data);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function getProgress(bookId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('progress', 'readonly');
                var req = tx.objectStore('progress').get(bookId);
                req.onsuccess = function () { db.close(); resolve(req.result || null); };
                req.onerror = function () { db.close(); resolve(null); };
            });
        });
    }

    function getAllProgress() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('progress', 'readonly');
                var req = tx.objectStore('progress').getAll();
                req.onsuccess = function () { db.close(); resolve(req.result || []); };
                req.onerror = function () { db.close(); resolve([]); };
            });
        });
    }

    // For backup — streams records one at a time via cursor
    function exportAllBooks() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(['books', 'books-content'], 'readonly');
                var metaReq = tx.objectStore('books').getAll();
                var contentStore = tx.objectStore('books-content');
                var results = [];

                metaReq.onsuccess = function () {
                    var metas = metaReq.result || [];
                    var pending = metas.length;
                    if (pending === 0) { db.close(); resolve([]); return; }

                    for (var i = 0; i < metas.length; i++) {
                        (function (meta) {
                            var cReq = contentStore.get(meta.id);
                            cReq.onsuccess = function () {
                                var record = {};
                                for (var k in meta) {
                                    if (meta.hasOwnProperty(k)) record[k] = meta[k];
                                }
                                if (cReq.result && cReq.result.content) {
                                    record.content = cReq.result.content;
                                }
                                results.push(record);
                                pending--;
                                if (pending === 0) { db.close(); resolve(results); }
                            };
                            cReq.onerror = function () {
                                results.push(meta);
                                pending--;
                                if (pending === 0) { db.close(); resolve(results); }
                            };
                        })(metas[i]);
                    }
                };
                metaReq.onerror = function () { db.close(); resolve([]); };
            });
        });
    }

    function exportAllProgress() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('progress', 'readonly');
                var req = tx.objectStore('progress').getAll();
                req.onsuccess = function () { db.close(); resolve(req.result || []); };
                req.onerror = function () { db.close(); resolve([]); };
            });
        });
    }

    function restoreBooks(arr) {
        if (!arr || !arr.length) return Promise.resolve(0);
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(['books', 'books-content'], 'readwrite');
                var metaStore = tx.objectStore('books');
                var contentStore = tx.objectStore('books-content');
                var count = 0;
                for (var i = 0; i < arr.length; i++) {
                    var rec = arr[i];
                    if (rec.id && rec.content) {
                        // Write metadata (without content)
                        var meta = {};
                        for (var k in rec) {
                            if (rec.hasOwnProperty(k) && k !== 'content') {
                                meta[k] = rec[k];
                            }
                        }
                        metaStore.put(meta);
                        // Write content separately
                        contentStore.put({ id: rec.id, content: rec.content });
                        count++;
                    }
                }
                tx.oncomplete = function () { db.close(); resolve(count); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function restoreProgress(arr) {
        if (!arr || !arr.length) return Promise.resolve(0);
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('progress', 'readwrite');
                var store = tx.objectStore('progress');
                var count = 0;
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].bookId) {
                        store.put(arr[i]);
                        count++;
                    }
                }
                tx.oncomplete = function () { db.close(); resolve(count); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // Save book content only (for sync download)
    function saveBookContent(id, content) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('books-content', 'readwrite');
                tx.objectStore('books-content').put({ id: id, content: content });
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // Save book metadata only (for sync download — no content stripping)
    function saveBookMeta(meta) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('books', 'readwrite');
                tx.objectStore('books').put(meta);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // --- Lazy migration: move content from 'books' to 'books-content' for v1 records ---
    function _lazyMigrate() {
        try {
            if (localStorage.getItem(MIGRATION_KEY) !== '1') return;
        } catch (e) { return; }

        openDB().then(function (db) {
            var tx = db.transaction(['books', 'books-content'], 'readwrite');
            var metaStore = tx.objectStore('books');
            var contentStore = tx.objectStore('books-content');
            var cursor = metaStore.openCursor();
            var migrated = 0;

            cursor.onsuccess = function () {
                var c = cursor.result;
                if (c) {
                    var record = c.value;
                    if (record.content) {
                        // Move content to separate store
                        contentStore.put({ id: record.id, content: record.content });
                        // Remove content from metadata record
                        var meta = {};
                        for (var k in record) {
                            if (record.hasOwnProperty(k) && k !== 'content') {
                                meta[k] = record[k];
                            }
                        }
                        c.update(meta);
                        migrated++;
                    }
                    c.continue();
                } else {
                    // Done
                    if (migrated > 0) {
                        console.log('[ReaderLib] Migrated ' + migrated + ' books to v2 schema');
                    }
                }
            };

            tx.oncomplete = function () {
                db.close();
                try { localStorage.removeItem(MIGRATION_KEY); } catch (ex) {}
            };
            tx.onerror = function () {
                db.close();
                console.warn('[ReaderLib] Migration error:', tx.error);
            };
        }).catch(function (err) {
            console.warn('[ReaderLib] Migration failed:', err);
        });
    }

    // Run lazy migration on load
    _lazyMigrate();

    window.ReaderLib = {
        importBook: importBook,
        getBook: getBook,
        getBookContent: getBookContent,
        getAllBooks: getAllBooks,
        getAllBooksMeta: getAllBooksMeta,
        updateBook: updateBook,
        deleteBook: deleteBook,
        saveProgress: saveProgress,
        getProgress: getProgress,
        getAllProgress: getAllProgress,
        splitChapters: splitChapters,
        stripHtmlTags: stripHtmlTags,
        exportAllBooks: exportAllBooks,
        exportAllProgress: exportAllProgress,
        restoreBooks: restoreBooks,
        restoreProgress: restoreProgress,
        saveBookContent: saveBookContent,
        saveBookMeta: saveBookMeta
    };
})();
