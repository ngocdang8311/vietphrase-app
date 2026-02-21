// ===== Reader App UI Logic =====
(function () {
    var MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    var WARN_FILE_SIZE = 10 * 1024 * 1024; // 10MB

    // --- Theme toggle ---
    var btnTheme = document.getElementById('btnTheme');
    var savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    btnTheme.textContent = savedTheme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    btnTheme.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        var next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        btnTheme.textContent = next === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
        localStorage.setItem('theme', next);
        localStorage.setItem('vp_settings_ts', String(Date.now()));
    });

    // --- Tab switching ---
    var mainTabBar = document.getElementById('mainTabBar');
    var crawlerView = document.getElementById('crawlerView');
    var libraryToolbar = document.getElementById('libraryToolbar');
    var crawlerLoaded = false;

    if (mainTabBar) {
        mainTabBar.addEventListener('click', function (e) {
            var btn = e.target.closest('.tab-btn');
            if (!btn) return;
            var tab = btn.dataset.tab;
            // Update active tab button
            var btns = mainTabBar.querySelectorAll('.tab-btn');
            for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i] === btn);

            if (tab === 'library') {
                crawlerView.classList.add('hidden');
                libraryToolbar.classList.remove('hidden');
                document.getElementById('bookGrid').classList.remove('hidden');
                renderLibrary();
            } else if (tab === 'crawler') {
                libraryToolbar.classList.add('hidden');
                document.getElementById('bookGrid').classList.add('hidden');
                document.getElementById('emptyState').classList.add('hidden');
                crawlerView.classList.remove('hidden');
                if (!crawlerLoaded) {
                    crawlerLoaded = true;
                    var s = document.createElement('script');
                    s.src = 'crawler.js';
                    s.onload = function () {
                        if (window.CrawlerEngine) {
                            CrawlerEngine.init(document.getElementById('crawlerRoot'));
                        }
                    };
                    document.head.appendChild(s);
                }
            }
        });
    }

    // --- Elements ---
    var libraryView = document.getElementById('libraryView');
    var bookGrid = document.getElementById('bookGrid');
    var emptyState = document.getElementById('emptyState');
    var btnImportBook = document.getElementById('btnImportBook');
    var bookFileInput = document.getElementById('bookFileInput');
    var storageInfo = document.getElementById('storageInfo');

    // Reader
    var readerOverlay = document.getElementById('readerOverlay');
    var readerBookTitle = document.getElementById('readerBookTitle');
    var readerContent = document.getElementById('readerContent');
    var readerContentWrap = document.getElementById('readerContentWrap');
    var scrollProgressBar = document.getElementById('scrollProgressBar');
    var btnBackToLib = document.getElementById('btnBackToLib');
    var btnChapterList = document.getElementById('btnChapterList');
    var btnSettings = document.getElementById('btnSettings');
    var readerSettingsBar = document.getElementById('readerSettingsBar');
    var btnPrevCh = document.getElementById('btnPrevCh');
    var btnNextCh = document.getElementById('btnNextCh');
    var chapterIndicator = document.getElementById('chapterIndicator');
    var scrollIndicator = document.getElementById('scrollIndicator');
    var readerBottomNav = document.getElementById('readerBottomNav');

    // Settings controls
    var btnFontDown = document.getElementById('btnFontDown');
    var btnFontUp = document.getElementById('btnFontUp');
    var valFontSize = document.getElementById('valFontSize');
    var btnLineDown = document.getElementById('btnLineDown');
    var btnLineUp = document.getElementById('btnLineUp');
    var valLineHeight = document.getElementById('valLineHeight');
    var selFont = document.getElementById('selFont');
    var selReaderTheme = document.getElementById('selReaderTheme');

    // Chapter sidebar
    var chapterSidebar = document.getElementById('chapterSidebar');
    var sidebarBackdrop = document.getElementById('sidebarBackdrop');
    var chapterList = document.getElementById('chapterList');
    var btnCloseSidebar = document.getElementById('btnCloseSidebar');

    // Backup
    var btnBackup = document.getElementById('btnBackup');
    var backupModal = document.getElementById('backupModal');
    var btnExportBackup = document.getElementById('btnExportBackup');
    var btnImportBackup = document.getElementById('btnImportBackup');
    var backupFileInput = document.getElementById('backupFileInput');
    var backupStatus = document.getElementById('backupStatus');
    var btnCloseBackup = document.getElementById('btnCloseBackup');

    // Sync
    var btnSync = document.getElementById('btnSync');
    var syncModal = document.getElementById('syncModal');
    var syncStatusMsg = document.getElementById('syncStatusMsg');
    var syncConnected = document.getElementById('syncConnected');
    var syncDisconnected = document.getElementById('syncDisconnected');
    var syncProviderBadge = document.getElementById('syncProviderBadge');
    var btnDoSync = document.getElementById('btnDoSync');
    var btnConnectGoogle = document.getElementById('btnConnectGoogle');
    var btnConnectGithub = document.getElementById('btnConnectGithub');
    var btnDisconnect = document.getElementById('btnDisconnect');
    var btnCloseSync = document.getElementById('btnCloseSync');
    var syncCloudBooks = document.getElementById('syncCloudBooks');
    var deviceFlowUI = document.getElementById('deviceFlowUI');
    var deviceFlowCode = document.getElementById('deviceFlowCode');
    var btnCancelDevice = document.getElementById('btnCancelDevice');

    // --- State ---
    var currentBook = null;
    var currentChapters = null;
    var currentChapterIndex = 0;
    var currentMode = 'chapter'; // 'chapter' or 'scroll'
    var scrollSaveTimer = null;
    var scrollLines = null;       // lazy scroll-mode rendering
    var renderedLineCount = 0;
    var LINES_PER_CHUNK = 300;
    var epubView = null;           // <foliate-view> element (while reading EPUB)

    // Reading settings
    var settings = { fontSize: 18, lineHeight: 1.8, fontFamily: 'sans', readerTheme: 'default' };
    try {
        var saved = JSON.parse(localStorage.getItem('readerSettings'));
        if (saved) {
            settings.fontSize = saved.fontSize || 18;
            settings.lineHeight = saved.lineHeight || 1.8;
            settings.fontFamily = saved.fontFamily || 'sans';
            settings.readerTheme = saved.readerTheme || 'default';
        }
    } catch (e) {}

    function saveSettings() {
        localStorage.setItem('readerSettings', JSON.stringify(settings));
        localStorage.setItem('vp_settings_ts', String(Date.now()));
    }

    function applySettings() {
        readerContent.style.fontSize = settings.fontSize + 'px';
        readerContent.style.lineHeight = settings.lineHeight;
        readerContent.style.fontFamily = settings.fontFamily === 'serif'
            ? "'Noto Serif', 'Georgia', serif"
            : "var(--font)";
        valFontSize.textContent = settings.fontSize;
        valLineHeight.textContent = settings.lineHeight.toFixed(1);
        selFont.value = settings.fontFamily;
        selReaderTheme.value = settings.readerTheme;
        document.documentElement.setAttribute('data-reader-theme', settings.readerTheme);
        // Update EPUB styles if active
        if (epubView) applyEpubSettings();
    }

    // --- Bridge helper: wait for foliate-js ES module to load ---
    var _bridgePromise = null;
    function waitForBridge() {
        if (window.EpubBridge) return Promise.resolve();
        if (!_bridgePromise) {
            _bridgePromise = new Promise(function (resolve) {
                window._epubBridgeResolve = function () {
                    _bridgePromise = null;
                    resolve();
                };
            });
        }
        return _bridgePromise;
    }

    // --- Storage info ---
    function updateStorageInfo() {
        if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then(function (est) {
                var used = VP.formatSize(est.usage || 0);
                var total = VP.formatSize(est.quota || 0);
                storageInfo.textContent = used + ' / ' + total;
            }).catch(function () {});
        }
    }

    // ===== Library View =====

    function renderLibrary() {
        ReaderLib.getAllBooksMeta().then(function (books) {
            if (books.length === 0) {
                bookGrid.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }
            emptyState.classList.add('hidden');

            // Get all progress in parallel
            var progressPromises = books.map(function (b) {
                return ReaderLib.getProgress(b.id);
            });

            Promise.all(progressPromises).then(function (progresses) {
                var html = '';
                for (var i = 0; i < books.length; i++) {
                    var b = books[i];
                    var p = progresses[i];
                    var dateStr = b.dateAdded ? new Date(b.dateAdded).toLocaleDateString() : '';

                    if (b.cloudOnly) {
                        // Cloud-only stub
                        var isEpub = b.format === 'epub';
                        html += '<div class="book-card cloud-only" data-id="' + b.id + '">' +
                            '<div class="book-icon">&#x2601;</div>' +
                            '<div class="book-info">' +
                            '<div class="book-title">' + VP.escapeHtml(b.title) + '</div>' +
                            '<div class="book-meta">' + VP.formatSize(b.size) + (dateStr ? ' &middot; ' + dateStr : '') + '</div>' +
                            '<div class="cloud-badge">' + (isEpub ? 'EPUB \u2014 c\u1EA7n import l\u1EA1i' : 'Ch\u01B0a t\u1EA3i') + '</div>' +
                            '</div>' +
                            '<div class="book-actions">' +
                            (isEpub ? '' : '<button class="btn btn-accent btn-cloud-download" data-id="' + b.id + '">T\u1EA3i v\u1EC1</button>') +
                            '</div></div>';
                    } else {
                        // Local book: normal rendering
                        var info = b.chapters || { hasChapters: false, chapters: [] };
                        var progressText = '';
                        if (p) {
                            if (p.mode === 'epub' && p.fraction != null) {
                                progressText = Math.round(p.fraction * 100) + '% \u0111\u00E3 \u0111\u1ECDc';
                            } else if (p.mode === 'chapter' && info.hasChapters) {
                                progressText = 'Ch\u01B0\u01A1ng ' + (p.chapterIndex + 1) + '/' + info.chapters.length;
                            } else if (p.scrollPercent != null) {
                                progressText = Math.round(p.scrollPercent) + '% \u0111\u00E3 \u0111\u1ECDc';
                            }
                        }
                        if (!progressText) progressText = 'Ch\u01B0a \u0111\u1ECDc';

                        html += '<div class="book-card" data-id="' + b.id + '">' +
                            '<div class="book-icon">&#x1F4D6;</div>' +
                            '<div class="book-info">' +
                            '<div class="book-title">' + VP.escapeHtml(b.title) + '</div>' +
                            '<div class="book-meta">' + VP.formatSize(b.size) + ' &middot; ' + dateStr +
                            (info.hasChapters ? ' &middot; ' + info.chapters.length + ' ch\u01B0\u01A1ng' : '') + '</div>' +
                            '<div class="book-progress">' + progressText + '</div>' +
                            '</div>' +
                            '<div class="book-actions">' +
                            '<button class="btn btn-accent btn-read" data-id="' + b.id + '">\u0110\u1ECDc</button>' +
                            '<button class="btn btn-red btn-delete" data-id="' + b.id + '">X\u00F3a</button>' +
                            '</div></div>';
                    }
                }

                bookGrid.innerHTML = html;
            });
        });
        updateStorageInfo();
    }

    // Book grid click delegation
    bookGrid.addEventListener('click', function (e) {
        var readBtn = e.target.closest('.btn-read');
        if (readBtn) { openBook(readBtn.dataset.id); return; }
        // Cloud download button
        var cloudDlBtn = e.target.closest('.btn-cloud-download');
        if (cloudDlBtn && window.CloudSync) {
            var dlId = cloudDlBtn.dataset.id;
            cloudDlBtn.disabled = true;
            cloudDlBtn.textContent = 'Downloading...';
            ReaderLib.getBookMeta(dlId).then(function (meta) {
                if (!meta) throw new Error('Book metadata not found');
                return CloudSync.downloadBook(meta);
            }).then(function () {
                renderLibrary();
            }).catch(function (err) {
                cloudDlBtn.disabled = false;
                cloudDlBtn.textContent = 'T\u1EA3i v\u1EC1';
                alert('Download failed: ' + err.message);
            });
            return;
        }
        var delBtn = e.target.closest('.btn-delete');
        if (delBtn) {
            if (confirm('X\u00F3a s\u00E1ch n\u00E0y?')) {
                var delId = delBtn.dataset.id;
                // Track deletion for sync tombstone
                if (window.CloudSync) CloudSync.trackDeletion(delId);
                ReaderLib.deleteBook(delId).then(function () {
                    // Clear lastReadBook if it was this one
                    try {
                        var last = JSON.parse(localStorage.getItem('lastReadBook'));
                        if (last && last.id === delId) localStorage.removeItem('lastReadBook');
                    } catch (e) {}
                    renderLibrary();
                });
            }
        }
    });

    // --- Import book ---
    btnImportBook.addEventListener('click', function () { bookFileInput.click(); });
    bookFileInput.addEventListener('change', function () {
        var files = bookFileInput.files;
        if (!files.length) return;
        var pending = files.length;
        for (var i = 0; i < files.length; i++) {
            (function (file) {
                if (file.size > MAX_FILE_SIZE) {
                    alert('File "' + file.name + '" qu\u00E1 l\u1EDBn (>' + VP.formatSize(MAX_FILE_SIZE) + '). Vui l\u00F2ng ch\u1ECDn file nh\u1ECF h\u01A1n.');
                    pending--;
                    if (pending === 0) renderLibrary();
                    return;
                }
                if (file.size > WARN_FILE_SIZE) {
                    if (!confirm('File "' + file.name + '" kh\u00E1 l\u1EDBn (' + VP.formatSize(file.size) + '). Ti\u1EBFp t\u1EE5c import?')) {
                        pending--;
                        if (pending === 0) renderLibrary();
                        return;
                    }
                }
                var reader = new FileReader();
                var EBOOK_RE = /\.(epub|mobi|azw3?|fb2(\.zip)?|fbz|cbz)$/i;
                if (file.name.match(EBOOK_RE)) {
                    // Ebook import via foliate-js bridge (EPUB, MOBI, FB2, CBZ)
                    reader.onload = function (ev) {
                        var ab = ev.target.result;
                        waitForBridge().then(function () {
                            return EpubBridge.parseMetadata(ab, file.name);
                        }).then(function (parsed) {
                            var title = parsed.metadata.title || file.name.replace(/\.[^.]+$/, '');
                            // Build spine from toc if available, otherwise generate from section count
                            var spine;
                            if (parsed.toc.length > 0) {
                                spine = parsed.toc.map(function (t) { return { href: t.href }; });
                            } else {
                                spine = [];
                                for (var si = 0; si < parsed.sectionCount; si++) {
                                    spine.push({ href: String(si) });
                                }
                            }
                            var epubMeta = {
                                metadata: parsed.metadata,
                                toc: parsed.toc,
                                spine: spine,
                                filename: file.name
                            };
                            return ReaderLib.importEpubBook(title, ab, epubMeta);
                        }).then(function () {
                            pending--;
                            if (pending === 0) renderLibrary();
                        }).catch(function (err) {
                            console.error('Ebook import error:', err);
                            alert('L\u1ED7i import: ' + err.message);
                            pending--;
                            if (pending === 0) renderLibrary();
                        });
                    };
                    reader.readAsArrayBuffer(file);
                } else {
                    // Text/HTML import
                    reader.onload = function (ev) {
                        var content = VP.decodeBuffer(ev.target.result);
                        var format = file.name.match(/\.html?$/i) ? 'html' : 'txt';
                        var title = file.name.replace(/\.[^.]+$/, '');
                        ReaderLib.importBook(title, content, format).then(function () {
                            pending--;
                            if (pending === 0) renderLibrary();
                        }).catch(function (err) {
                            console.error('Import error:', err);
                            pending--;
                            if (pending === 0) renderLibrary();
                        });
                    };
                    reader.readAsArrayBuffer(file);
                }
            })(files[i]);
        }
        bookFileInput.value = '';
    });

    // ===== Reader View =====

    function openBook(id) {
        ReaderLib.getBook(id).then(function (book) {
            if (!book) { alert('Kh\u00F4ng t\u00ECm th\u1EA5y s\u00E1ch'); return; }

            if (book.format === 'epub') {
                openEpubBook(book);
                return;
            }

            currentBook = book;
            var info = book.chapters;
            if (!info) {
                info = ReaderLib.splitChapters(book.content);
                book.chapters = info;
                ReaderLib.updateBook(book);
            }
            currentChapters = info;
            readerBookTitle.textContent = book.title;

            ReaderLib.getProgress(id).then(function (progress) {
                if (info.hasChapters) {
                    currentMode = 'chapter';
                    scrollLines = null;
                    currentChapterIndex = progress && progress.mode === 'chapter' ? progress.chapterIndex : 0;
                    if (currentChapterIndex >= info.chapters.length) currentChapterIndex = 0;
                    showChapterMode();
                    renderChapter(currentChapterIndex);
                    // Restore scroll position after render
                    if (progress && progress.scrollTop) {
                        setTimeout(function () { readerContentWrap.scrollTop = progress.scrollTop; }, 50);
                    }
                } else {
                    currentMode = 'scroll';
                    showScrollMode();
                    renderFullContent();
                    if (progress && progress.scrollPercent > 0) {
                        renderToScrollPercent(progress.scrollPercent + 5, function () {
                            if (progress.scrollTop) {
                                setTimeout(function () { readerContentWrap.scrollTop = progress.scrollTop; }, 50);
                            }
                        });
                    }
                }
                readerOverlay.classList.remove('hidden');
                applySettings();

                // Save as last read
                var lastRead = { id: book.id, title: book.title };
                if (currentMode === 'chapter') lastRead.chapterIndex = currentChapterIndex;
                localStorage.setItem('lastReadBook', JSON.stringify(lastRead));
            });
        });
    }

    function showChapterMode() {
        btnChapterList.classList.remove('hidden');
        btnPrevCh.classList.remove('hidden');
        btnNextCh.classList.remove('hidden');
        chapterIndicator.classList.remove('hidden');
        scrollIndicator.classList.add('hidden');
        buildChapterList();
    }

    function showScrollMode() {
        btnChapterList.classList.add('hidden');
        btnPrevCh.classList.add('hidden');
        btnNextCh.classList.add('hidden');
        chapterIndicator.classList.add('hidden');
        scrollIndicator.classList.remove('hidden');
    }

    function renderChapter(index) {
        if (!currentChapters || !currentChapters.hasChapters) return;
        var ch = currentChapters.chapters[index];
        var text = currentBook.content.substring(ch.start, ch.end);
        readerContent.innerHTML = textToHtml(text);
        readerContentWrap.scrollTop = 0;
        currentChapterIndex = index;
        updateChapterUI();
        saveProgressDebounced();

        // Update lastReadBook
        try {
            var last = JSON.parse(localStorage.getItem('lastReadBook'));
            if (last && last.id === currentBook.id) {
                last.chapterIndex = index;
                localStorage.setItem('lastReadBook', JSON.stringify(last));
            }
        } catch (e) {}
    }

    function renderFullContent() {
        scrollLines = currentBook.content.split('\n');
        renderedLineCount = 0;
        readerContent.innerHTML = '';
        appendScrollChunks(3);
    }

    function appendScrollChunks(count) {
        if (!scrollLines) return true;
        var total = scrollLines.length;
        var fragment = document.createDocumentFragment();
        for (var c = 0; c < count && renderedLineCount < total; c++) {
            var end = Math.min(renderedLineCount + LINES_PER_CHUNK, total);
            var html = '';
            for (var i = renderedLineCount; i < end; i++) {
                var line = scrollLines[i].trim();
                html += line ? '<p>' + VP.escapeHtml(line) + '</p>' : '<p></p>';
            }
            var div = document.createElement('div');
            div.innerHTML = html;
            fragment.appendChild(div);
            renderedLineCount = end;
        }
        readerContent.appendChild(fragment);
        return renderedLineCount >= total;
    }

    function renderToScrollPercent(percent, callback) {
        if (!scrollLines || percent <= 0) { callback(); return; }
        var targetLine = Math.ceil(scrollLines.length * percent / 100);
        function batch() {
            if (renderedLineCount >= targetLine || renderedLineCount >= scrollLines.length) {
                callback();
                return;
            }
            appendScrollChunks(5);
            requestAnimationFrame(batch);
        }
        batch();
    }

    function textToHtml(text) {
        var lines = text.split('\n');
        var parts = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line) {
                parts.push('<p>' + VP.escapeHtml(line) + '</p>');
            } else {
                parts.push('<p></p>');
            }
        }
        return parts.join('');
    }

    // ===== EPUB Reader (foliate-js powered) =====

    function openEpubBook(book) {
        var content = book.content; // ArrayBuffer from IDB
        if (!content) {
            alert('Kh\u00F4ng t\u00ECm th\u1EA5y n\u1ED9i dung EPUB');
            return;
        }
        // Cleanup previous EPUB view if any
        if (epubView) { epubView.close(); epubView.remove(); epubView = null; }

        waitForBridge().then(function () {
            var fname = book.filename || (book.title + '.epub');
            var file = new File([content], fname, { type: 'application/octet-stream' });
            var view = EpubBridge.createView();
            epubView = view;
            currentBook = book;
            currentMode = 'chapter';
            scrollLines = null;

            // Append to DOM before opening
            readerContentWrap.appendChild(view);

            return view.open(file).then(function () {
                var bookObj = view.book;

                // Build chapter list from TOC
                var toc = EpubBridge.flattenToc(bookObj.toc);
                if (toc.length === 0) {
                    toc = bookObj.sections.map(function (s, i) {
                        return { title: 'Chapter ' + (i + 1), href: i };
                    });
                }
                currentChapters = { hasChapters: true, chapters: toc };
                readerBookTitle.textContent = book.title;

                // Configure renderer: paginated, single column
                if (view.renderer) {
                    view.renderer.setAttribute('max-inline-size', '720px');
                    view.renderer.setAttribute('max-column-count', '1');
                    view.renderer.setAttribute('gap', '5%');
                    view.renderer.setAttribute('margin', '16px');
                }

                return ReaderLib.getProgress(book.id).then(function (progress) {
                    currentChapterIndex = 0;

                    // Show EPUB mode
                    readerContentWrap.classList.add('epub-active');
                    showChapterMode();

                    // Apply user styles
                    applyEpubSettings();

                    // Set up event listeners
                    view.addEventListener('relocate', function (e) {
                        var loc = e.detail;
                        var fraction = loc.fraction || 0;
                        scrollProgressBar.style.width = (fraction * 100).toFixed(1) + '%';

                        // Update chapter from tocItem
                        if (loc.tocItem) {
                            var tocHref = loc.tocItem.href || '';
                            for (var i = 0; i < currentChapters.chapters.length; i++) {
                                if (currentChapters.chapters[i].href === tocHref ||
                                    currentChapters.chapters[i].title === loc.tocItem.label) {
                                    currentChapterIndex = i;
                                    updateChapterUI();
                                    break;
                                }
                            }
                        } else if (loc.section != null) {
                            // Fallback for books without TOC
                            var secIdx = typeof loc.section === 'number' ? loc.section : (loc.section.current || 0);
                            if (secIdx !== currentChapterIndex && secIdx < currentChapters.chapters.length) {
                                currentChapterIndex = secIdx;
                                updateChapterUI();
                            }
                        }
                        saveProgressDebounced();
                    });

                    // external-link: foliate-js opens in new tab by default

                    view.addEventListener('load', function (e) {
                        var doc = e.detail.doc;
                        if (!doc) return;
                        // Tap zones for pagination and immersive toggle
                        doc.addEventListener('click', function (ev) {
                            // Don't interfere with text selection
                            if (doc.defaultView && doc.defaultView.getSelection().toString()) return;
                            // Don't interfere with link clicks
                            var a = ev.target.closest ? ev.target.closest('a[href]') : null;
                            if (a) return;
                            var rect = doc.documentElement.getBoundingClientRect();
                            var x = ev.clientX - rect.left;
                            var w = rect.width;
                            var zone = x / w;
                            if (zone < 0.25) {
                                view.goLeft();
                            } else if (zone > 0.75) {
                                view.goRight();
                            } else {
                                readerOverlay.classList.toggle('immersive');
                            }
                        });
                    });

                    // Initialize position
                    if (progress && progress.cfi) {
                        // Restore from saved CFI (most precise)
                        return view.init({ lastLocation: progress.cfi });
                    } else if (progress && progress.scrollPercent > 0) {
                        // Legacy: approximate from scroll percent
                        return view.init({ showTextStart: true }).then(function () {
                            return view.goToFraction(progress.scrollPercent / 100);
                        });
                    } else {
                        return view.init({ showTextStart: true });
                    }
                }).then(function () {
                    readerOverlay.classList.remove('hidden');
                    applySettings();

                    // Save as last read
                    localStorage.setItem('lastReadBook', JSON.stringify({
                        id: book.id, title: book.title, chapterIndex: currentChapterIndex
                    }));
                });
            });
        }).catch(function (err) {
            console.error('EPUB open error:', err);
            alert('L\u1ED7i m\u1EDF EPUB: ' + err.message);
        });
    }

    function applyEpubSettings() {
        if (!epubView || !epubView.renderer) return;
        var cs = getComputedStyle(readerOverlay);
        var bg = cs.getPropertyValue('--reader-bg').trim() || '#0a0a12';
        var fg = cs.getPropertyValue('--reader-text').trim() || '#d4d0e0';
        var fontFam = settings.fontFamily === 'serif'
            ? "'Noto Serif', 'Georgia', serif"
            : "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
        var css = 'html, body { background: ' + bg + '; color: ' + fg + '; }' +
            'body { font-family: ' + fontFam + '; font-size: ' + settings.fontSize + 'px; ' +
            'line-height: ' + settings.lineHeight + '; }' +
            'img, svg, video { max-width: 100%; height: auto; }' +
            'a { color: inherit; }';
        epubView.renderer.setStyles(css);
    }

    function updateChapterUI() {
        if (!currentChapters || !currentChapters.hasChapters) return;
        var total = currentChapters.chapters.length;
        chapterIndicator.textContent = 'Ch\u01B0\u01A1ng ' + (currentChapterIndex + 1) + '/' + total;
        btnPrevCh.disabled = currentChapterIndex <= 0;
        btnNextCh.disabled = currentChapterIndex >= total - 1;
        btnPrevCh.style.opacity = currentChapterIndex <= 0 ? '0.4' : '1';
        btnNextCh.style.opacity = currentChapterIndex >= total - 1 ? '0.4' : '1';

        // Update sidebar active
        var items = chapterList.querySelectorAll('.chapter-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('active', i === currentChapterIndex);
        }
    }

    function buildChapterList() {
        if (!currentChapters || !currentChapters.hasChapters) return;
        var html = '';
        for (var i = 0; i < currentChapters.chapters.length; i++) {
            var active = i === currentChapterIndex ? ' active' : '';
            html += '<div class="chapter-item' + active + '" data-index="' + i + '">' +
                VP.escapeHtml(currentChapters.chapters[i].title) + '</div>';
        }
        chapterList.innerHTML = html;
    }

    // Chapter nav
    btnPrevCh.addEventListener('click', function () {
        if (currentChapterIndex > 0) {
            if (epubView) {
                var ch = currentChapters.chapters[currentChapterIndex - 1];
                epubView.goTo(ch.href);
            } else {
                renderChapter(currentChapterIndex - 1);
            }
        }
    });
    btnNextCh.addEventListener('click', function () {
        if (currentChapters && currentChapterIndex < currentChapters.chapters.length - 1) {
            if (epubView) {
                var ch = currentChapters.chapters[currentChapterIndex + 1];
                epubView.goTo(ch.href);
            } else {
                renderChapter(currentChapterIndex + 1);
            }
        }
    });

    // Chapter sidebar
    btnChapterList.addEventListener('click', function () { toggleSidebar(true); });
    btnCloseSidebar.addEventListener('click', function () { toggleSidebar(false); });
    sidebarBackdrop.addEventListener('click', function () { toggleSidebar(false); });

    function toggleSidebar(open) {
        chapterSidebar.classList.toggle('open', open);
        sidebarBackdrop.classList.toggle('open', open);
        if (open) {
            // Scroll active chapter into view
            var active = chapterList.querySelector('.chapter-item.active');
            if (active) active.scrollIntoView({ block: 'center' });
        }
    }

    chapterList.addEventListener('click', function (e) {
        var item = e.target.closest('.chapter-item');
        if (!item) return;
        var idx = parseInt(item.dataset.index, 10);
        if (epubView) {
            var ch = currentChapters.chapters[idx];
            epubView.goTo(ch.href);
        } else {
            renderChapter(idx);
        }
        toggleSidebar(false);
    });

    // Back to library
    btnBackToLib.addEventListener('click', function () {
        saveCurrentProgress();
        // Cleanup EPUB foliate-view
        if (epubView) {
            epubView.close();
            epubView.remove();
            epubView = null;
        }
        readerContent.style.display = '';
        readerContentWrap.classList.remove('epub-active');
        readerOverlay.classList.add('hidden');
        readerOverlay.classList.remove('immersive');
        currentBook = null;
        currentChapters = null;
        scrollLines = null;
        renderedLineCount = 0;
        renderLibrary();
    });

    // Settings toggle
    btnSettings.addEventListener('click', function () {
        readerSettingsBar.classList.toggle('hidden');
    });

    // Font size
    btnFontDown.addEventListener('click', function () {
        if (settings.fontSize > 14) { settings.fontSize -= 2; applySettings(); saveSettings(); }
    });
    btnFontUp.addEventListener('click', function () {
        if (settings.fontSize < 28) { settings.fontSize += 2; applySettings(); saveSettings(); }
    });

    // Line height
    btnLineDown.addEventListener('click', function () {
        if (settings.lineHeight > 1.4) { settings.lineHeight = Math.round((settings.lineHeight - 0.1) * 10) / 10; applySettings(); saveSettings(); }
    });
    btnLineUp.addEventListener('click', function () {
        if (settings.lineHeight < 2.4) { settings.lineHeight = Math.round((settings.lineHeight + 0.1) * 10) / 10; applySettings(); saveSettings(); }
    });

    // Font family
    selFont.addEventListener('change', function () {
        settings.fontFamily = selFont.value;
        applySettings(); saveSettings();
    });

    // Reader theme
    selReaderTheme.addEventListener('change', function () {
        settings.readerTheme = selReaderTheme.value;
        applySettings(); saveSettings();
    });

    // --- Scroll progress + save ---
    readerContentWrap.addEventListener('scroll', function () {
        var el = readerContentWrap;
        var scrollTop = el.scrollTop;
        var scrollHeight = el.scrollHeight - el.clientHeight;
        var percent = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

        if (currentMode === 'scroll' && scrollLines && scrollLines.length > 0) {
            // Real percent based on line position within full content
            var scrollRatio = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
            var currentLine = scrollRatio * renderedLineCount;
            percent = (currentLine / scrollLines.length) * 100;
            scrollIndicator.textContent = Math.round(percent) + '% \u0111\u00E3 \u0111\u1ECDc';
            if (renderedLineCount < scrollLines.length) {
                if (scrollTop + el.clientHeight >= el.scrollHeight - 800) {
                    appendScrollChunks(2);
                }
            }
        }
        scrollProgressBar.style.width = percent.toFixed(1) + '%';

        saveProgressDebounced();
    });

    function saveProgressDebounced() {
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(saveCurrentProgress, 500);
    }

    function saveCurrentProgress() {
        if (!currentBook) return;
        var data;

        if (epubView) {
            // EPUB: save CFI + fraction from foliate-view
            var loc = epubView.lastLocation;
            if (!loc || (!loc.cfi && !loc.fraction)) return; // skip if no relocate yet
            var fraction = loc.fraction || 0;
            data = {
                bookId: currentBook.id,
                mode: 'epub',
                cfi: loc.cfi || null,
                fraction: fraction,
                chapterIndex: currentChapterIndex,
                scrollPercent: fraction * 100,
                lastRead: Date.now()
            };
        } else {
            var el = readerContentWrap;
            var scrollHeight = el.scrollHeight - el.clientHeight;
            var percent2 = scrollHeight > 0 ? (el.scrollTop / scrollHeight) * 100 : 0;
            if (currentMode === 'scroll' && scrollLines && scrollLines.length > 0) {
                var scrollRatio = scrollHeight > 0 ? el.scrollTop / scrollHeight : 0;
                percent2 = (scrollRatio * renderedLineCount / scrollLines.length) * 100;
            }
            data = {
                bookId: currentBook.id,
                mode: currentMode,
                scrollTop: el.scrollTop,
                scrollPercent: percent2,
                lastRead: Date.now()
            };
            if (currentMode === 'chapter') {
                data.chapterIndex = currentChapterIndex;
            }
        }

        ReaderLib.saveProgress(data).catch(function () {});
    }

    // --- Immersive mode: tap content to toggle bars ---
    readerContent.addEventListener('click', function (e) {
        // Don't toggle if user is selecting text
        if (window.getSelection().toString()) return;
        readerOverlay.classList.toggle('immersive');
    });

    // Keyboard shortcuts in reader
    document.addEventListener('keydown', function (e) {
        if (readerOverlay.classList.contains('hidden')) return;
        if (epubView && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            if (e.key === 'ArrowLeft') epubView.goLeft();
            else epubView.goRight();
            return;
        }
        if (e.key === 'ArrowLeft' && currentMode === 'chapter') {
            btnPrevCh.click();
        } else if (e.key === 'ArrowRight' && currentMode === 'chapter') {
            btnNextCh.click();
        } else if (e.key === 'Escape') {
            if (readerOverlay.classList.contains('immersive')) {
                readerOverlay.classList.remove('immersive');
            } else if (chapterSidebar.classList.contains('open')) {
                toggleSidebar(false);
            } else {
                btnBackToLib.click();
            }
        }
    });

    // ===== Backup =====
    btnBackup.addEventListener('click', function () {
        backupModal.classList.remove('hidden');
        backupStatus.textContent = '';
    });
    btnCloseBackup.addEventListener('click', function () {
        backupModal.classList.add('hidden');
    });
    backupModal.addEventListener('click', function (e) {
        if (e.target === backupModal) backupModal.classList.add('hidden');
    });

    btnExportBackup.addEventListener('click', function () {
        backupStatus.textContent = '\u0110ang xu\u1EA5t backup...';
        BackupManager.exportBackup().then(function (result) {
            VP.downloadFile(result.filename, result.blob, 'application/zip');
            backupStatus.textContent = '\u0110\u00E3 xu\u1EA5t backup th\u00E0nh c\u00F4ng!';
        }).catch(function (err) {
            backupStatus.textContent = 'L\u1ED7i: ' + err.message;
        });
    });

    btnImportBackup.addEventListener('click', function () { backupFileInput.click(); });
    backupFileInput.addEventListener('change', function () {
        var file = backupFileInput.files[0];
        if (!file) return;
        backupStatus.textContent = '\u0110ang nh\u1EADp backup...';
        BackupManager.importBackup(file, function (msg) { backupStatus.textContent = msg; }).then(function (summary) {
            var msg = 'Kh\u00F4i ph\u1EE5c: ';
            var parts = [];
            if (summary.books) parts.push(summary.books + ' s\u00E1ch');
            if (summary.phrases) parts.push(summary.phrases + ' c\u1EE5m t\u1EEB');
            if (summary.dicts) parts.push(summary.dicts + ' t\u1EEB \u0111i\u1EC3n');
            if (summary.settings) parts.push('c\u00E0i \u0111\u1EB7t');
            backupStatus.textContent = msg + (parts.length ? parts.join(', ') : 'kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u');
            renderLibrary();
        }).catch(function (err) {
            backupStatus.textContent = 'L\u1ED7i: ' + err.message;
        });
        backupFileInput.value = '';
    });

    // ===== Cloud Sync =====

    var autoSyncTimer = null;

    function updateSyncButton() {
        if (!window.CloudSync) return;
        if (CloudSync.isSignedIn()) {
            btnSync.classList.add('connected');
            btnSync.title = 'Cloud Sync (connected)';
        } else {
            btnSync.classList.remove('connected');
            btnSync.title = 'Cloud Sync';
        }
    }

    function updateSyncModal() {
        if (!window.CloudSync) return;
        if (CloudSync.isSignedIn()) {
            syncConnected.classList.remove('hidden');
            syncDisconnected.classList.add('hidden');
            deviceFlowUI.classList.add('hidden');
            var providerName = CloudSync.getActiveProviderName();
            var label = providerName === 'github' ? 'GitHub Gist' : 'Google Drive';
            syncProviderBadge.textContent = 'Connected via ' + label;
            var lastSync = CloudSync.getLastSyncTime();
            if (lastSync) {
                syncStatusMsg.textContent = 'Last sync: ' + new Date(lastSync).toLocaleString();
            } else {
                syncStatusMsg.textContent = 'Connected. Click Sync to start.';
            }
            renderCloudBooks();
        } else {
            syncConnected.classList.add('hidden');
            syncDisconnected.classList.remove('hidden');
            syncStatusMsg.textContent = '';
        }
    }

    function renderCloudBooks() {
        if (!window.CloudSync) return;
        ReaderLib.getAllBooksMeta().then(function (allBooks) {
            // Only show downloadable cloud books (exclude EPUB — content not synced)
            var books = allBooks.filter(function (b) { return b.cloudOnly && b.format !== 'epub'; });
            if (!books.length) {
                syncCloudBooks.innerHTML = '';
                return;
            }
            var totalSize = 0;
            for (var i = 0; i < books.length; i++) totalSize += books[i].size || 0;
            syncCloudBooks.innerHTML =
                '<div style="padding:10px 12px;background:var(--surface);border:1px dashed var(--border);border-radius:10px">' +
                '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">' +
                books.length + ' s\u00E1ch tr\u00EAn cloud ch\u01B0a t\u1EA3i (' + VP.formatSize(totalSize) + ')' +
                '</div>' +
                '<button class="btn btn-accent" id="btnDownloadAll" style="width:100%;padding:10px;font-size:13px">' +
                'T\u1EA3i t\u1EA5t c\u1EA3</button></div>';
        });
    }

    // Sync modal handlers
    if (btnSync) {
        btnSync.addEventListener('click', function () {
            syncModal.classList.remove('hidden');
            updateSyncModal();
        });
    }
    if (btnCloseSync) {
        btnCloseSync.addEventListener('click', function () {
            syncModal.classList.add('hidden');
        });
        syncModal.addEventListener('click', function (e) {
            if (e.target === syncModal) syncModal.classList.add('hidden');
        });
    }
    if (btnConnectGoogle) {
        btnConnectGoogle.addEventListener('click', function () {
            CloudSync.setProvider('google');
            btnConnectGoogle.disabled = true;
            btnConnectGoogle.textContent = 'Connecting...';
            CloudSync.signIn().then(function () {
                btnConnectGoogle.disabled = false;
                btnConnectGoogle.textContent = 'Google Drive';
                updateSyncButton();
                updateSyncModal();
            }).catch(function (err) {
                btnConnectGoogle.disabled = false;
                btnConnectGoogle.textContent = 'Google Drive';
                syncStatusMsg.textContent = 'Error: ' + err.message;
            });
        });
    }
    if (btnConnectGithub) {
        btnConnectGithub.addEventListener('click', function () {
            CloudSync.setProvider('github');
            btnConnectGithub.disabled = true;
            btnConnectGithub.textContent = 'Connecting...';
            deviceFlowUI.classList.add('hidden');
            CloudSync.signIn({
                onDeviceCode: function (info) {
                    deviceFlowUI.classList.remove('hidden');
                    deviceFlowCode.textContent = info.userCode;
                    btnConnectGithub.textContent = 'Waiting...';
                }
            }).then(function () {
                btnConnectGithub.disabled = false;
                btnConnectGithub.textContent = 'GitHub Gist';
                deviceFlowUI.classList.add('hidden');
                updateSyncButton();
                updateSyncModal();
            }).catch(function (err) {
                btnConnectGithub.disabled = false;
                btnConnectGithub.textContent = 'GitHub Gist';
                deviceFlowUI.classList.add('hidden');
                syncStatusMsg.textContent = 'Error: ' + err.message;
            });
        });
    }
    if (btnCancelDevice) {
        btnCancelDevice.addEventListener('click', function () {
            if (window.GitHubGistProvider) GitHubGistProvider.cancelSignIn();
            deviceFlowUI.classList.add('hidden');
            if (btnConnectGithub) {
                btnConnectGithub.disabled = false;
                btnConnectGithub.textContent = 'GitHub Gist';
            }
        });
    }
    if (btnDisconnect) {
        btnDisconnect.addEventListener('click', function () {
            CloudSync.signOut();
            updateSyncButton();
            updateSyncModal();
        });
    }
    if (btnDoSync) {
        btnDoSync.addEventListener('click', function () {
            btnDoSync.disabled = true;
            btnSync.classList.add('syncing');
            syncStatusMsg.textContent = 'Syncing...';
            CloudSync.sync(function (msg) {
                syncStatusMsg.textContent = msg;
            }).then(function (summary) {
                btnDoSync.disabled = false;
                btnSync.classList.remove('syncing');
                var parts = [];
                if (summary.uploaded) parts.push(summary.uploaded + ' uploaded');
                if (summary.downloaded) parts.push(summary.downloaded + ' downloaded');
                if (summary.deleted) parts.push(summary.deleted + ' deleted');
                syncStatusMsg.textContent = 'Sync done! ' + (parts.length ? parts.join(', ') : 'Everything up to date.');
                renderCloudBooks();
                renderLibrary();
                updateSyncButton();
            }).catch(function (err) {
                btnDoSync.disabled = false;
                btnSync.classList.remove('syncing');
                if (err.message === 'TOKEN_EXPIRED') {
                    syncStatusMsg.textContent = 'Session expired. Please reconnect.';
                    CloudSync.signOut();
                    updateSyncButton();
                    updateSyncModal();
                } else {
                    syncStatusMsg.textContent = 'Sync error: ' + err.message;
                }
            });
        });
    }

    // Download all cloud-only books from sync modal
    if (syncCloudBooks) {
        syncCloudBooks.addEventListener('click', function (e) {
            var dlAllBtn = e.target.closest('#btnDownloadAll');
            if (!dlAllBtn) return;
            dlAllBtn.disabled = true;
            dlAllBtn.textContent = '\u0110ang t\u1EA3i...';
            ReaderLib.getAllBooksMeta().then(function (allBooks) {
                var cloudBooks = allBooks.filter(function (b) { return b.cloudOnly && b.format !== 'epub'; });
                if (!cloudBooks.length) return;
                var total = cloudBooks.length;
                var done = 0;
                var chain = Promise.resolve();
                cloudBooks.forEach(function (meta) {
                    chain = chain.then(function () {
                        done++;
                        dlAllBtn.textContent = '\u0110ang t\u1EA3i ' + done + '/' + total + '...';
                        return CloudSync.downloadBook(meta).catch(function (err) {
                            console.warn('[Sync] Download failed:', meta.title, err.message);
                        });
                    });
                });
                return chain;
            }).then(function () {
                renderCloudBooks();
                renderLibrary();
            }).catch(function (err) {
                dlAllBtn.disabled = false;
                dlAllBtn.textContent = 'T\u1EA3i t\u1EA5t c\u1EA3';
                alert('Download failed: ' + err.message);
            });
        });
    }

    // Auto-sync after saving progress (debounced 10s)
    var origSaveProgress = saveCurrentProgress;
    saveCurrentProgress = function () {
        origSaveProgress();
        if (window.CloudSync && CloudSync.isSignedIn()) {
            clearTimeout(autoSyncTimer);
            autoSyncTimer = setTimeout(function () {
                CloudSync.sync().catch(function () {});
            }, 10000);
        }
    };

    // ===== Init =====

    // One-time migration: cache chapter info for old books (imported before optimization)
    function migrateOldBooks() {
        ReaderLib.getAllBooksMeta().then(function (books) {
            var needMigration = books.filter(function (b) { return !b.chapters; });
            if (!needMigration.length) return;
            var chain = Promise.resolve();
            needMigration.forEach(function (meta) {
                chain = chain.then(function () {
                    return ReaderLib.getBook(meta.id).then(function (book) {
                        if (book && !book.chapters) {
                            if (book.format === 'epub') return; // EPUB chapters set at import time
                            book.chapters = ReaderLib.splitChapters(book.content);
                            return ReaderLib.updateBook(book);
                        }
                    });
                });
            });
            chain.then(function () { renderLibrary(); });
        });
    }

    function init() {
        renderLibrary();
        migrateOldBooks();
        // Request persistent storage to reduce iOS eviction risk
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().then(function (granted) {
                if (granted) console.log('[Reader] Persistent storage granted');
            }).catch(function () {});
        }
        var params = new URLSearchParams(window.location.search);
        var bookId = params.get('book');
        if (bookId) {
            openBook(bookId);
        }
        // Init cloud sync
        if (window.CloudSync) {
            CloudSync.init();
            updateSyncButton();
        }
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
            console.warn('SW registration failed:', err);
        });
    }

    init();
})();
