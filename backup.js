// ===== BackupManager — Export/Import All App State =====
// ZIP-based backup: ebook binary files + JSON metadata in a single .zip
// Backward-compatible: imports both .zip (new) and .json (legacy)
(function () {
    var BACKUP_VERSION = 2;
    var LOG = '[Backup]';

    // ===== Minimal ZIP builder (STORE, no compression) =====

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

    function _buildZip(entries) {
        var encoder = new TextEncoder();
        var now = _dosDateTime(new Date());
        var localHeaders = [];
        var offset = 0;

        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var nameBytes = encoder.encode(e.name);
            var crc = _crc32(e.data);
            var size = e.data.length;

            var lh = new ArrayBuffer(30 + nameBytes.length);
            var lv = new DataView(lh);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint16(6, 0x0800, true);
            lv.setUint16(8, 0, true);
            lv.setUint16(10, now.time, true);
            lv.setUint16(12, now.date, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            new Uint8Array(lh).set(nameBytes, 30);

            localHeaders.push({ lh: lh, data: e.data, nameBytes: nameBytes, crc: crc, size: size, offset: offset });
            offset += lh.byteLength + size;
        }

        var cdParts = [];
        var cdSize = 0;
        for (var j = 0; j < localHeaders.length; j++) {
            var rec = localHeaders[j];
            var cd = new ArrayBuffer(46 + rec.nameBytes.length);
            var cv = new DataView(cd);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, now.time, true);
            cv.setUint16(14, now.date, true);
            cv.setUint32(16, rec.crc, true);
            cv.setUint32(20, rec.size, true);
            cv.setUint32(24, rec.size, true);
            cv.setUint16(28, rec.nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0, true);
            cv.setUint32(42, rec.offset, true);
            new Uint8Array(cd).set(rec.nameBytes, 46);
            cdParts.push(cd);
            cdSize += cd.byteLength;
        }

        var eocd = new ArrayBuffer(22);
        var ev = new DataView(eocd);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, entries.length, true);
        ev.setUint16(10, entries.length, true);
        ev.setUint32(12, cdSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true);

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

    // Blob → ArrayBuffer with FileReader fallback for older browsers
    function _blobToArrayBuffer(blob) {
        if (blob.arrayBuffer) return blob.arrayBuffer();
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(fr.error); };
            fr.readAsArrayBuffer(blob);
        });
    }

    // ===== Export =====

    function exportBackup() {
        var data = {};

        data.settings = {
            theme: localStorage.getItem('theme'),
            readerSettings: localStorage.getItem('readerSettings'),
            lastReadBook: localStorage.getItem('lastReadBook')
        };

        var customPromise;
        if (window.DictEngine && DictEngine.isReady) {
            data.customPhrases = DictEngine.getCustomEntries();
            customPromise = DictEngine.getImportedSourcesFull();
        } else {
            data.customPhrases = null;
            customPromise = Promise.resolve(null);
        }

        return Promise.all([
            customPromise,
            ReaderLib.exportAllBooks(),
            ReaderLib.exportAllProgress()
        ]).then(function (results) {
            data.importedDicts = results[0];
            data.books = results[1];
            data.progress = results[2];

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

    function importBackup(file, onProgress) {
        var progress = onProgress || _noop;
        var name = (file.name || '').toLowerCase();
        console.log(LOG, 'importBackup start, file:', name, 'size:', file.size);
        if (name.endsWith('.json')) {
            progress('Đọc file JSON...');
            return file.text().then(function (text) {
                console.log(LOG, 'JSON text read, length:', text.length);
                return _importFromJson(text, progress);
            });
        } else if (name.endsWith('.zip')) {
            return _importFromZip(file, progress);
        } else {
            return Promise.reject(new Error('Unsupported format. Use .zip or .json'));
        }
    }

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

    function _importFromZip(file, progress) {
        progress('Đọc file ZIP...');
        console.log(LOG, 'Loading zip.js module...');
        return import('./foliate-js/vendor/zip.js').then(function (zipMod) {
            console.log(LOG, 'zip.js loaded, disabling web workers...');
            // Disable web workers — avoids silent hangs when loaded from SW cache
            zipMod.configure({ useWebWorkers: false });
            var reader = new zipMod.ZipReader(new zipMod.BlobReader(file));
            return reader.getEntries().then(function (entries) {
                console.log(LOG, 'ZIP entries:', entries.length, entries.map(function (e) { return e.filename; }));

                var entryMap = {};
                var metaEntry = null;
                for (var i = 0; i < entries.length; i++) {
                    entryMap[entries[i].filename] = entries[i];
                    if (entries[i].filename === 'metadata.json') {
                        metaEntry = entries[i];
                    }
                }

                if (!metaEntry) {
                    reader.close().catch(function () {});
                    return Promise.reject(new Error('Invalid backup: metadata.json not found'));
                }

                progress('Đọc metadata...');
                console.log(LOG, 'Reading metadata.json via BlobWriter...');
                // Use BlobWriter instead of TextWriter — more reliable for large entries
                return metaEntry.getData(new zipMod.BlobWriter()).then(function (blob) {
                    console.log(LOG, 'metadata.json blob ready, size:', blob.size, '→ reading as text');
                    return blob.text();
                }).then(function (jsonText) {
                    console.log(LOG, 'metadata.json read, length:', jsonText.length);
                    var backup;
                    try {
                        backup = JSON.parse(jsonText);
                    } catch (e) {
                        reader.close().catch(function () {});
                        return Promise.reject(new Error('Invalid metadata.json'));
                    }
                    if (!backup.data) {
                        reader.close().catch(function () {});
                        return Promise.reject(new Error('Invalid backup format'));
                    }

                    var d = backup.data;
                    var bookCount = d.books ? d.books.length : 0;
                    console.log(LOG, 'Parsed: books=' + bookCount + ', progress=' + (d.progress ? d.progress.length : 0));

                    // Identify ebook books with ZIP content
                    var ebookBooks = [];
                    if (d.books) {
                        for (var j = 0; j < d.books.length; j++) {
                            if (d.books[j].zipPath && entryMap[d.books[j].zipPath]) {
                                ebookBooks.push(d.books[j]);
                            }
                        }
                    }
                    console.log(LOG, 'Ebook entries to read from ZIP:', ebookBooks.length);

                    // Read ebook content from ZIP sequentially
                    var ebookMap = {};
                    var chain = Promise.resolve();
                    var ebookIdx = 0;
                    ebookBooks.forEach(function (book) {
                        chain = chain.then(function () {
                            ebookIdx++;
                            progress('Đọc ebook ' + ebookIdx + '/' + ebookBooks.length + '...');
                            console.log(LOG, 'Reading ZIP entry:', book.zipPath);
                            return entryMap[book.zipPath].getData(new zipMod.BlobWriter()).then(function (blob) {
                                console.log(LOG, 'Got blob, size:', blob.size, '→ converting to ArrayBuffer');
                                return _blobToArrayBuffer(blob);
                            }).then(function (ab) {
                                console.log(LOG, 'ArrayBuffer ready, bytes:', ab.byteLength);
                                ebookMap[book.id] = ab;
                            });
                        });
                    });

                    return chain.then(function () {
                        console.log(LOG, 'All ebook entries read, closing ZipReader...');
                        // Fire-and-forget close — don't let it block restore
                        reader.close().catch(function () {});
                        return _restoreData(d, ebookMap, progress);
                    }).catch(function (err) {
                        console.error(LOG, 'ZIP read error:', err);
                        reader.close().catch(function () {});
                        throw err;
                    });
                });
            });
        });
    }

    // Shared restore logic — fully sequential to avoid IDB contention
    function _restoreData(d, ebookMap, progress) {
        var summary = { settings: false, phrases: 0, dicts: 0, books: 0 };
        console.log(LOG, '_restoreData start');

        // Step 1: Restore settings (sync)
        progress('Khôi phục cài đặt...');
        if (d.settings) {
            if (d.settings.theme) localStorage.setItem('theme', d.settings.theme);
            if (d.settings.readerSettings) localStorage.setItem('readerSettings', d.settings.readerSettings);
            if (d.settings.lastReadBook) localStorage.setItem('lastReadBook', d.settings.lastReadBook);
            summary.settings = true;
        }
        console.log(LOG, 'Settings restored');

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
        console.log(LOG, 'Phrases restored:', summary.phrases);

        // Step 3: Restore imported dicts
        return Promise.resolve().then(function () {
            if (d.importedDicts && d.importedDicts.length && window.DictEngine && DictEngine.isReady) {
                progress('Khôi phục từ điển (' + d.importedDicts.length + ')...');
                console.log(LOG, 'Restoring', d.importedDicts.length, 'dicts...');
                return DictEngine.restoreImports(d.importedDicts).then(function (count) {
                    summary.dicts = count;
                    console.log(LOG, 'Dicts restored:', count);
                }).catch(function (err) {
                    console.warn(LOG, 'Dict restore failed:', err);
                    summary.dicts = 0;
                });
            } else {
                console.log(LOG, 'Skipping dict restore (no data or DictEngine not ready)');
            }
        }).then(function () {
            // Step 4: Restore books
            if (!d.books || !d.books.length) {
                console.log(LOG, 'No books to restore');
                return;
            }

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
            console.log(LOG, 'Books split: regular=' + regularBooks.length + ', ebook=' + ebookBooksToRestore.length);

            // 4a: Restore regular (text) books
            var chain = Promise.resolve();
            if (regularBooks.length) {
                chain = chain.then(function () {
                    progress('Khôi phục ' + regularBooks.length + ' sách text...');
                    console.log(LOG, 'restoreBooks() start...');
                    return ReaderLib.restoreBooks(regularBooks).then(function (count) {
                        summary.books += count;
                        console.log(LOG, 'restoreBooks() done, count:', count);
                    }).catch(function (err) {
                        console.error(LOG, 'restoreBooks() error:', err);
                    });
                });
            }

            // 4b: Restore ebook books sequentially
            ebookBooksToRestore.forEach(function (book, idx) {
                chain = chain.then(function () {
                    progress('Khôi phục ebook ' + (idx + 1) + '/' + ebookBooksToRestore.length + '...');
                    console.log(LOG, 'Restoring ebook:', book.title || book.id);
                    var meta = {};
                    for (var k in book) {
                        if (book.hasOwnProperty(k) && k !== 'zipPath' && k !== 'contentOmitted' && k !== 'content') {
                            meta[k] = book[k];
                        }
                    }
                    var content = ebookMap[book.id];
                    return ReaderLib.saveBookMeta(meta).then(function () {
                        console.log(LOG, 'Meta saved, saving content', content.byteLength, 'bytes...');
                        return ReaderLib.saveBookContent(meta.id, content);
                    }).then(function () {
                        summary.books++;
                        console.log(LOG, 'Ebook restored OK');
                    }).catch(function (err) {
                        console.warn(LOG, 'Failed to restore ebook:', meta.title, err);
                    });
                });
            });

            return chain;
        }).then(function () {
            // Step 5: Restore progress
            if (d.progress && d.progress.length) {
                progress('Khôi phục tiến độ đọc...');
                console.log(LOG, 'Restoring', d.progress.length, 'progress records...');
                return ReaderLib.restoreProgress(d.progress).then(function () {
                    console.log(LOG, 'Progress restored');
                }).catch(function (err) {
                    console.warn(LOG, 'Progress restore failed:', err);
                });
            }
        }).then(function () {
            console.log(LOG, 'Import complete:', JSON.stringify(summary));
            return summary;
        });
    }

    window.BackupManager = {
        exportBackup: exportBackup,
        importBackup: importBackup
    };
})();
