// ===== BackupManager — Export/Import All App State =====
// ZIP-based backup: ebook binary files + JSON metadata in a single .zip
// Backward-compatible: imports both .zip (new) and .json (legacy)
(function () {
    var BACKUP_VERSION = 2;

    // ===== Minimal ZIP builder (STORE, no compression) =====
    // Ebook files are already internally compressed, so STORE is optimal.

    var _crc32Table = null;
    function _getCrc32Table() {
        if (_crc32Table) return _crc32Table;
        _crc32Table = new Uint32Array(256);
        for (var i = 0; i < 256; i++) {
            var c = i;
            for (var j = 0; j < 8; j++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            _crc32Table[i] = c;
        }
        return _crc32Table;
    }

    function _crc32(data) {
        var table = _getCrc32Table();
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < data.length; i++) {
            crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function _dosDateTime(date) {
        var time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1);
        var day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
        return { time: time, date: day };
    }

    // entries: [{ name: string, data: Uint8Array }]
    // Returns Blob
    function _buildZip(entries) {
        var encoder = new TextEncoder();
        var now = _dosDateTime(new Date());
        var localHeaders = [];
        var offset = 0;

        // Phase 1: build local file headers + data
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var nameBytes = encoder.encode(e.name);
            var crc = _crc32(e.data);
            var size = e.data.length;

            // Local file header: 30 bytes + name
            var lh = new ArrayBuffer(30 + nameBytes.length);
            var lv = new DataView(lh);
            lv.setUint32(0, 0x04034b50, true);   // signature
            lv.setUint16(4, 20, true);             // version needed
            lv.setUint16(6, 0x0800, true);         // flags (bit 11 = UTF-8)
            lv.setUint16(8, 0, true);              // compression: STORE
            lv.setUint16(10, now.time, true);       // mod time
            lv.setUint16(12, now.date, true);       // mod date
            lv.setUint32(14, crc, true);           // crc32
            lv.setUint32(18, size, true);          // compressed size
            lv.setUint32(22, size, true);          // uncompressed size
            lv.setUint16(26, nameBytes.length, true); // filename length
            lv.setUint16(28, 0, true);             // extra field length
            new Uint8Array(lh).set(nameBytes, 30);

            localHeaders.push({ lh: lh, data: e.data, nameBytes: nameBytes, crc: crc, size: size, offset: offset });
            offset += lh.byteLength + size;
        }

        // Phase 2: build central directory
        var cdParts = [];
        var cdSize = 0;
        for (var j = 0; j < localHeaders.length; j++) {
            var rec = localHeaders[j];
            var cd = new ArrayBuffer(46 + rec.nameBytes.length);
            var cv = new DataView(cd);
            cv.setUint32(0, 0x02014b50, true);   // signature
            cv.setUint16(4, 20, true);             // version made by
            cv.setUint16(6, 20, true);             // version needed
            cv.setUint16(8, 0x0800, true);         // flags (UTF-8)
            cv.setUint16(10, 0, true);             // compression: STORE
            cv.setUint16(12, now.time, true);
            cv.setUint16(14, now.date, true);
            cv.setUint32(16, rec.crc, true);
            cv.setUint32(20, rec.size, true);      // compressed size
            cv.setUint32(24, rec.size, true);      // uncompressed size
            cv.setUint16(28, rec.nameBytes.length, true);
            cv.setUint16(30, 0, true);             // extra field length
            cv.setUint16(32, 0, true);             // comment length
            cv.setUint16(34, 0, true);             // disk number start
            cv.setUint16(36, 0, true);             // internal attrs
            cv.setUint32(38, 0, true);             // external attrs
            cv.setUint32(42, rec.offset, true);    // local header offset
            new Uint8Array(cd).set(rec.nameBytes, 46);
            cdParts.push(cd);
            cdSize += cd.byteLength;
        }

        // Phase 3: EOCD record
        var eocd = new ArrayBuffer(22);
        var ev = new DataView(eocd);
        ev.setUint32(0, 0x06054b50, true);        // signature
        ev.setUint16(4, 0, true);                  // disk number
        ev.setUint16(6, 0, true);                  // disk with CD
        ev.setUint16(8, entries.length, true);      // entries on this disk
        ev.setUint16(10, entries.length, true);     // total entries
        ev.setUint32(12, cdSize, true);            // size of CD
        ev.setUint32(16, offset, true);            // offset of CD
        ev.setUint16(20, 0, true);                 // comment length

        // Assemble blob parts
        var parts = [];
        for (var k = 0; k < localHeaders.length; k++) {
            parts.push(localHeaders[k].lh);
            parts.push(localHeaders[k].data);
        }
        for (var m = 0; m < cdParts.length; m++) {
            parts.push(cdParts[m]);
        }
        parts.push(eocd);

        return new Blob(parts, { type: 'application/zip' });
    }

    // ===== Helpers =====

    function _getFileExt(filename) {
        if (!filename) return '';
        var m = filename.match(/\.([a-z0-9]+)$/i);
        return m ? m[1].toLowerCase() : '';
    }

    function _noop() {}

    // ===== Export =====

    function exportBackup() {
        var data = {};

        // Settings from localStorage
        data.settings = {
            theme: localStorage.getItem('theme'),
            readerSettings: localStorage.getItem('readerSettings'),
            lastReadBook: localStorage.getItem('lastReadBook')
        };

        // Custom phrases (only if DictEngine available)
        var customPromise;
        if (window.DictEngine && DictEngine.isReady) {
            data.customPhrases = DictEngine.getCustomEntries();
            customPromise = DictEngine.getImportedSourcesFull();
        } else {
            data.customPhrases = null;
            customPromise = Promise.resolve(null);
        }

        // Gather all async data
        return Promise.all([
            customPromise,
            ReaderLib.exportAllBooks(),
            ReaderLib.exportAllProgress()
        ]).then(function (results) {
            data.importedDicts = results[0];
            data.books = results[1];
            data.progress = results[2];

            // Identify ebook books and fetch their binary content for ZIP
            var ebookIndices = [];
            var ebookPromises = [];
            for (var i = 0; i < data.books.length; i++) {
                var book = data.books[i];
                if (book.format === 'epub' && book.contentOmitted) {
                    ebookIndices.push(i);
                    ebookPromises.push(ReaderLib.getBookContent(book.id));
                }
            }

            return Promise.all(ebookPromises).then(function (contents) {
                var zipEntries = [];

                // Add ebook files to ZIP, annotate metadata with zipPath
                for (var j = 0; j < ebookIndices.length; j++) {
                    var idx = ebookIndices[j];
                    var bk = data.books[idx];
                    var content = contents[j];
                    if (content) {
                        var ext = _getFileExt(bk.filename) || 'epub';
                        var zipPath = 'books/' + bk.id + '.' + ext;
                        bk.zipPath = zipPath;
                        zipEntries.push({
                            name: zipPath,
                            data: content instanceof Uint8Array ? content : new Uint8Array(content)
                        });
                    }
                }

                // Build metadata.json
                var backup = {
                    version: BACKUP_VERSION,
                    exportedAt: new Date().toISOString(),
                    app: 'vietphrase-pwa',
                    data: data
                };
                var encoder = new TextEncoder();
                zipEntries.unshift({
                    name: 'metadata.json',
                    data: encoder.encode(JSON.stringify(backup))
                });

                var date = new Date().toISOString().slice(0, 10);
                return {
                    blob: _buildZip(zipEntries),
                    filename: 'vietphrase-backup-' + date + '.zip'
                };
            });
        });
    }

    // ===== Import =====
    // onProgress(msg): optional callback for UI status updates

    function importBackup(file, onProgress) {
        var progress = onProgress || _noop;
        var name = (file.name || '').toLowerCase();
        if (name.endsWith('.json')) {
            progress('Reading JSON...');
            return file.text().then(function (text) {
                return _importFromJson(text, progress);
            });
        } else if (name.endsWith('.zip')) {
            return _importFromZip(file, progress);
        } else {
            return Promise.reject(new Error('Unsupported format. Use .zip or .json'));
        }
    }

    // Legacy JSON import (backward compatibility)
    function _importFromJson(jsonText, progress) {
        var backup;
        try {
            backup = JSON.parse(jsonText);
        } catch (e) {
            return Promise.reject(new Error('Invalid JSON file'));
        }
        if (!backup.data) {
            return Promise.reject(new Error('Invalid backup format'));
        }
        return _restoreData(backup.data, null, progress);
    }

    // ZIP import using vendored zip.js
    function _importFromZip(file, progress) {
        progress('Reading ZIP...');
        return import('./foliate-js/vendor/zip.js').then(function (zipMod) {
            var reader = new zipMod.ZipReader(new zipMod.BlobReader(file));
            return reader.getEntries().then(function (entries) {
                // Build lookup by filename
                var entryMap = {};
                var metaEntry = null;
                for (var i = 0; i < entries.length; i++) {
                    entryMap[entries[i].filename] = entries[i];
                    if (entries[i].filename === 'metadata.json') {
                        metaEntry = entries[i];
                    }
                }

                if (!metaEntry) {
                    return reader.close().then(function () {
                        throw new Error('Invalid backup: metadata.json not found');
                    });
                }

                progress('Reading metadata...');
                // Read metadata.json
                return metaEntry.getData(new zipMod.TextWriter()).then(function (jsonText) {
                    var backup;
                    try {
                        backup = JSON.parse(jsonText);
                    } catch (e) {
                        return reader.close().then(function () {
                            throw new Error('Invalid metadata.json');
                        });
                    }
                    if (!backup.data) {
                        return reader.close().then(function () {
                            throw new Error('Invalid backup format');
                        });
                    }

                    var d = backup.data;

                    // Identify ebook books with ZIP content
                    var ebookBooks = [];
                    if (d.books) {
                        for (var j = 0; j < d.books.length; j++) {
                            if (d.books[j].zipPath && entryMap[d.books[j].zipPath]) {
                                ebookBooks.push(d.books[j]);
                            }
                        }
                    }

                    // Read ebook content from ZIP sequentially
                    var ebookMap = {};
                    var chain = Promise.resolve();
                    var ebookIdx = 0;
                    ebookBooks.forEach(function (book) {
                        chain = chain.then(function () {
                            ebookIdx++;
                            progress('Reading ebook ' + ebookIdx + '/' + ebookBooks.length + '...');
                            return entryMap[book.zipPath].getData(new zipMod.BlobWriter()).then(function (blob) {
                                return blob.arrayBuffer();
                            }).then(function (ab) {
                                ebookMap[book.id] = ab;
                            });
                        });
                    });

                    return chain.then(function () {
                        return reader.close();
                    }).then(function () {
                        return _restoreData(d, ebookMap, progress);
                    }).catch(function (err) {
                        return reader.close().then(
                            function () { throw err; },
                            function () { throw err; }
                        );
                    });
                });
            });
        });
    }

    // Shared restore logic — fully sequential to avoid IDB contention
    // ebookMap: null (JSON import) or { bookId: ArrayBuffer } (ZIP import)
    function _restoreData(d, ebookMap, progress) {
        var summary = { settings: false, phrases: 0, dicts: 0, books: 0 };

        // Step 1: Restore settings (sync)
        progress('Restoring settings...');
        if (d.settings) {
            if (d.settings.theme) localStorage.setItem('theme', d.settings.theme);
            if (d.settings.readerSettings) localStorage.setItem('readerSettings', d.settings.readerSettings);
            if (d.settings.lastReadBook) localStorage.setItem('lastReadBook', d.settings.lastReadBook);
            summary.settings = true;
        }

        // Step 2: Restore custom phrases (sync)
        if (d.customPhrases && window.DictEngine && DictEngine.isReady) {
            var current = DictEngine.getCustomEntries();
            for (var zh in d.customPhrases) {
                if (d.customPhrases.hasOwnProperty(zh)) {
                    current[zh] = d.customPhrases[zh];
                    summary.phrases++;
                }
            }
            DictEngine.setCustomEntries(current);
        }

        // Step 3: Restore imported dicts (async, sequential)
        return Promise.resolve().then(function () {
            if (d.importedDicts && d.importedDicts.length && window.DictEngine && DictEngine.isReady) {
                progress('Restoring dictionaries...');
                return DictEngine.restoreImports(d.importedDicts).then(function (count) {
                    summary.dicts = count;
                }).catch(function () { summary.dicts = 0; });
            }
        }).then(function () {
            // Step 4: Restore books — separate regular and ebook
            if (!d.books || !d.books.length) return;

            var regularBooks = [];
            var ebookBooksToRestore = [];

            for (var i = 0; i < d.books.length; i++) {
                var book = d.books[i];
                if (ebookMap && book.zipPath && ebookMap[book.id]) {
                    ebookBooksToRestore.push(book);
                } else {
                    regularBooks.push(book);
                }
            }

            // 4a: Restore regular (text) books
            var chain = Promise.resolve();
            if (regularBooks.length) {
                chain = chain.then(function () {
                    progress('Restoring text books...');
                    return ReaderLib.restoreBooks(regularBooks).then(function (count) {
                        summary.books += count;
                    }).catch(function () {});
                });
            }

            // 4b: Restore ebook books sequentially (meta + content per book)
            ebookBooksToRestore.forEach(function (book, idx) {
                chain = chain.then(function () {
                    progress('Restoring ebook ' + (idx + 1) + '/' + ebookBooksToRestore.length + '...');
                    // Clean metadata: strip zipPath and contentOmitted
                    var meta = {};
                    for (var k in book) {
                        if (book.hasOwnProperty(k) && k !== 'zipPath' && k !== 'contentOmitted' && k !== 'content') {
                            meta[k] = book[k];
                        }
                    }
                    var content = ebookMap[book.id];
                    return ReaderLib.saveBookMeta(meta).then(function () {
                        return ReaderLib.saveBookContent(meta.id, content);
                    }).then(function () {
                        summary.books++;
                    }).catch(function (err) {
                        console.warn('[Backup] Failed to restore ebook:', meta.title, err);
                    });
                });
            });

            return chain;
        }).then(function () {
            // Step 5: Restore progress
            if (d.progress && d.progress.length) {
                progress('Restoring progress...');
                return ReaderLib.restoreProgress(d.progress).catch(function () {});
            }
        }).then(function () {
            return summary;
        });
    }

    window.BackupManager = {
        exportBackup: exportBackup,
        importBackup: importBackup
    };
})();
