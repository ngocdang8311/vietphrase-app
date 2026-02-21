// ===== Novel Crawler — Browse + Translate + Save =====
// IIFE exposing window.CrawlerEngine
(function () {
    'use strict';

    // ===== IDB: vietphrase-crawler v1 =====
    var DB_NAME = 'vietphrase-crawler';
    var DB_VERSION = 1;

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('novels')) {
                    db.createObjectStore('novels', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('chapter-content')) {
                    db.createObjectStore('chapter-content', { keyPath: ['novelId', 'chapterIndex'] });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbGet(storeName, key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var req = tx.objectStore(storeName).get(key);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
                tx.oncomplete = function () { db.close(); };
            });
        });
    }

    function dbPut(storeName, obj) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).put(obj);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function dbDelete(storeName, key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).delete(key);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    function dbGetAll(storeName) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var req = tx.objectStore(storeName).getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
                tx.oncomplete = function () { db.close(); };
            });
        });
    }

    // Get all saved chapters for a novel
    function getNovelChapters(novelId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('chapter-content', 'readonly');
                var store = tx.objectStore('chapter-content');
                var results = [];
                var cursor = store.openCursor();
                cursor.onsuccess = function (e) {
                    var c = e.target.result;
                    if (c) {
                        if (c.value.novelId === novelId) results.push(c.value);
                        c.continue();
                    }
                };
                tx.oncomplete = function () { db.close(); resolve(results); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // Delete all chapters of a novel
    function deleteNovelChapters(novelId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('chapter-content', 'readwrite');
                var store = tx.objectStore('chapter-content');
                var cursor = store.openCursor();
                cursor.onsuccess = function (e) {
                    var c = e.target.result;
                    if (c) {
                        if (c.value.novelId === novelId) c.delete();
                        c.continue();
                    }
                };
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // ===== Site Presets =====
    var SITE_PRESETS = [
        {
            id: 'uukanshu',
            name: 'UU看書 (uukanshu.cc)',
            urlPattern: /uukanshu/,
            novel: {
                title: '.booktitle, h1',
                chapterList: '.chapterlist dd a',
                reverseChapters: false
            },
            chapter: {
                content: '.content',
                title: 'h1, .booktitle',
                remove: ['script', '.ads', '.aadd', '.aminus', '.pattern'],
                nextLink: 'a:contains("下一章"), a:contains("下一頁")',
                prevLink: 'a:contains("上一章"), a:contains("上一頁")'
            }
        },
        {
            id: 'biquge',
            name: 'Biquge variants',
            urlPattern: /biquge|biqg|xbiquge|ibiquge|bqg/,
            novel: {
                title: '#info h1, .info h1, h1',
                chapterList: '#list dd a, .listmain dd a, #chapterlist a',
                reverseChapters: false
            },
            chapter: {
                content: '#content, .content',
                title: '.bookname h1, .content h1, h1',
                remove: ['script', '.bottem', '.google', 'div[align="center"]', 'p:empty'],
                nextLink: '#next_url, a:contains("下一章")',
                prevLink: '#prev_url, a:contains("上一章")'
            }
        },
        {
            id: '69shu',
            name: '69书吧 (69shuba)',
            urlPattern: /69shu/,
            novel: {
                title: '.bread-crumbs a:last-child, h1',
                chapterList: '.mu_contain li a',
                reverseChapters: false
            },
            chapter: {
                content: '.txtnav',
                title: 'h1, .h1title',
                remove: ['script', '.txtinfo', '.bottom-ad', 'div[align="center"]', '.ads'],
                nextLink: '#next_url, a:contains("下一章")',
                prevLink: '#prev_url, a:contains("上一章")'
            }
        }
    ];

    function detectSite(url) {
        for (var i = 0; i < SITE_PRESETS.length; i++) {
            if (SITE_PRESETS[i].urlPattern.test(url)) return SITE_PRESETS[i];
        }
        // Check custom sites
        var customs = loadCustomSites();
        for (var j = 0; j < customs.length; j++) {
            try {
                if (new RegExp(customs[j].urlPatternStr).test(url)) return customs[j];
            } catch (e) {}
        }
        return null;
    }

    function loadCustomSites() {
        try {
            return JSON.parse(localStorage.getItem('crawler_custom_sites') || '[]');
        } catch (e) { return []; }
    }

    function saveCustomSites(sites) {
        localStorage.setItem('crawler_custom_sites', JSON.stringify(sites));
    }

    // ===== Core Browse Functions =====

    function fetchPage(url) {
        return fetch('/api/fetch-page?url=' + encodeURIComponent(url))
            .then(function (resp) {
                if (!resp.ok) {
                    return resp.json().catch(function () { return { message: 'HTTP ' + resp.status }; })
                        .then(function (err) { throw new Error(err.message || 'Fetch failed'); });
                }
                return resp.text();
            });
    }

    function parsePage(html, pageUrl, siteConfig) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // Fix base URL for relative links
        var base = doc.createElement('base');
        base.href = pageUrl;
        doc.head.prepend(base);

        var result = {
            title: '',
            content: null,
            chapterLinks: null,
            prevUrl: null,
            nextUrl: null,
            isChapterPage: false,
            isIndexPage: false
        };

        if (!siteConfig) {
            // Generic: try to extract main content
            var body = doc.body;
            result.title = doc.title || '';
            result.content = extractTextContent(body);
            return result;
        }

        // Try chapter page first
        var contentEl = safeQuery(doc, siteConfig.chapter.content);
        if (contentEl) {
            result.isChapterPage = true;
            // Title
            var titleEl = safeQuery(doc, siteConfig.chapter.title);
            result.title = titleEl ? titleEl.textContent.trim() : doc.title || '';
            // Remove unwanted elements
            if (siteConfig.chapter.remove) {
                siteConfig.chapter.remove.forEach(function (sel) {
                    var els = contentEl.querySelectorAll(sel);
                    for (var i = 0; i < els.length; i++) els[i].remove();
                });
            }
            result.content = extractTextContent(contentEl);
            // Prev/next links
            result.prevUrl = findNavLink(doc, siteConfig.chapter.prevLink, pageUrl);
            result.nextUrl = findNavLink(doc, siteConfig.chapter.nextLink, pageUrl);
            return result;
        }

        // Try index page
        var chapterEls = safeQueryAll(doc, siteConfig.novel.chapterList);
        if (chapterEls.length > 0) {
            result.isIndexPage = true;
            var titleEl2 = safeQuery(doc, siteConfig.novel.title);
            result.title = titleEl2 ? titleEl2.textContent.trim() : doc.title || '';
            result.chapterLinks = [];
            for (var i = 0; i < chapterEls.length; i++) {
                var a = chapterEls[i];
                var href = a.getAttribute('href');
                if (!href) continue;
                try {
                    result.chapterLinks.push({
                        title: a.textContent.trim(),
                        url: new URL(href, pageUrl).href
                    });
                } catch (e) {}
            }
            if (siteConfig.novel.reverseChapters) {
                result.chapterLinks.reverse();
            }
            return result;
        }

        // Fallback: extract all text
        result.title = doc.title || '';
        result.content = extractTextContent(doc.body);
        return result;
    }

    function safeQuery(doc, selector) {
        if (!selector) return null;
        var sels = selector.split(',');
        for (var i = 0; i < sels.length; i++) {
            try {
                var el = doc.querySelector(sels[i].trim());
                if (el) return el;
            } catch (e) {}
        }
        return null;
    }

    function safeQueryAll(doc, selector) {
        if (!selector) return [];
        // Try full selector first (handles native comma-separated lists)
        try {
            var all = doc.querySelectorAll(selector);
            if (all.length > 0) return all;
        } catch (e) {}
        // Fallback: try each part individually
        var sels = selector.split(',');
        for (var i = 0; i < sels.length; i++) {
            try {
                var els = doc.querySelectorAll(sels[i].trim());
                if (els.length > 0) return els;
            } catch (e) {}
        }
        return [];
    }

    function extractTextContent(el) {
        if (!el) return '';
        // Walk nodes, converting block elements to newlines
        var text = '';
        var blockTags = { P: 1, DIV: 1, BR: 1, H1: 1, H2: 1, H3: 1, H4: 1, LI: 1, TR: 1, BLOCKQUOTE: 1 };
        function walk(node) {
            if (node.nodeType === 3) {
                text += node.textContent;
                return;
            }
            if (node.nodeType !== 1) return;
            if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'NOSCRIPT') return;
            var isBlock = blockTags[node.tagName];
            if (isBlock && text.length > 0 && text[text.length - 1] !== '\n') text += '\n';
            if (node.tagName === 'BR') { text += '\n'; return; }
            var children = node.childNodes;
            for (var i = 0; i < children.length; i++) walk(children[i]);
            if (isBlock && text.length > 0 && text[text.length - 1] !== '\n') text += '\n';
        }
        walk(el);
        // Clean up multiple blank lines
        return text.replace(/\n{3,}/g, '\n\n').trim();
    }

    function findNavLink(doc, selector, baseUrl) {
        if (!selector) return null;
        var sels = selector.split(',');
        for (var i = 0; i < sels.length; i++) {
            try {
                // Handle :contains pseudo (not native CSS)
                var sel = sels[i].trim();
                var containsMatch = sel.match(/a:contains\("(.+?)"\)/);
                if (containsMatch) {
                    var links = doc.querySelectorAll('a[href]');
                    var needle = containsMatch[1];
                    for (var j = 0; j < links.length; j++) {
                        if (links[j].textContent.indexOf(needle) >= 0) {
                            var href = links[j].getAttribute('href');
                            try { return new URL(href, baseUrl).href; } catch (e) {}
                        }
                    }
                } else {
                    var el = doc.querySelector(sel);
                    if (el) {
                        var href2 = el.getAttribute('href');
                        if (href2) {
                            try { return new URL(href2, baseUrl).href; } catch (e) {}
                        }
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    // ===== Translation =====

    var dictLoaded = false;

    function ensureDict() {
        if (dictLoaded && window.DictEngine && DictEngine.isReady) return Promise.resolve();
        if (!window.DictEngine) return Promise.reject(new Error('DictEngine not loaded'));
        dictLoaded = true;
        return DictEngine.loadDictionary();
    }

    function translateText(text) {
        return ensureDict().then(function () {
            var lines = text.split('\n');
            var result = [];
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                result.push(line ? DictEngine.translate(line) : '');
            }
            return result.join('\n');
        });
    }

    // ===== Browse State =====

    var state = {
        currentUrl: null,
        parsedPage: null,
        translatedContent: null,
        zhContent: null,
        history: [],
        historyIndex: -1,
        novelProject: null,
        siteConfig: null,
        loading: false
    };

    // ===== UI =====

    var rootEl = null;
    var els = {}; // cached DOM refs

    function init(container) {
        rootEl = container;
        renderShell();
        bindEvents();
        showNovelsView();
    }

    function renderShell() {
        rootEl.innerHTML =
            '<div class="crawler-shell">' +
                // Browse view
                '<div class="crawler-browse hidden" id="crawlerBrowse">' +
                    // Top bar
                    '<div class="crawler-topbar">' +
                        '<button class="btn btn-default crawler-back-btn" id="crawlerBackBtn" title="Quay lại">&larr;</button>' +
                        '<input type="text" class="crawler-url-input" id="crawlerUrlInput" placeholder="Nhập URL truyện...">' +
                        '<button class="btn btn-accent crawler-go-btn" id="crawlerGoBtn">Đi</button>' +
                        '<select class="crawler-site-select" id="crawlerSiteSelect">' +
                            '<option value="auto">Tự nhận diện</option>' +
                        '</select>' +
                    '</div>' +
                    // Main area: sidebar + content
                    '<div class="crawler-main">' +
                        '<div class="crawler-sidebar hidden" id="crawlerSidebar">' +
                            '<div class="crawler-sidebar-header">' +
                                '<span id="crawlerSidebarTitle">Danh sách chương</span>' +
                                '<button class="btn btn-default crawler-sidebar-close" id="crawlerSidebarClose">&times;</button>' +
                            '</div>' +
                            '<div class="crawler-chapter-list" id="crawlerChapterList"></div>' +
                        '</div>' +
                        '<div class="crawler-content-area">' +
                            '<div class="crawler-loading hidden" id="crawlerLoading">' +
                                '<div class="crawler-spinner"></div>' +
                                '<span>Đang tải...</span>' +
                            '</div>' +
                            '<div class="crawler-content" id="crawlerContent"></div>' +
                        '</div>' +
                    '</div>' +
                    // Bottom bar
                    '<div class="crawler-bottombar" id="crawlerBottombar">' +
                        '<button class="btn btn-default" id="crawlerPrevBtn">&larr; Trước</button>' +
                        '<button class="btn btn-green" id="crawlerSaveBtn">Lưu chương</button>' +
                        '<button class="btn btn-default" id="crawlerToggleSidebar">Mục lục</button>' +
                        '<button class="btn btn-default" id="crawlerNextBtn">Tiếp &rarr;</button>' +
                    '</div>' +
                '</div>' +
                // Novels list view
                '<div class="crawler-novels" id="crawlerNovels">' +
                    '<div class="crawler-novels-header">' +
                        '<div class="crawler-novels-title">Truyện đã lưu</div>' +
                        '<button class="btn btn-accent" id="crawlerNewBrowse">+ Duyệt mới</button>' +
                    '</div>' +
                    '<div class="crawler-novels-list" id="crawlerNovelsList"></div>' +
                    '<div class="crawler-novels-empty hidden" id="crawlerNovelsEmpty">' +
                        '<div class="empty-icon">&#x1F310;</div>' +
                        '<div class="empty-title">Chưa có truyện nào</div>' +
                        '<div class="empty-sub">Nhấn "Duyệt mới" để bắt đầu</div>' +
                    '</div>' +
                '</div>' +
                // Edit modal
                '<div class="crawler-edit-modal hidden" id="crawlerEditModal">' +
                    '<div class="crawler-edit-overlay"></div>' +
                    '<div class="crawler-edit-box">' +
                        '<div class="crawler-edit-header">' +
                            '<span>Chỉnh sửa bản dịch</span>' +
                            '<button class="btn btn-default" id="crawlerEditClose">&times;</button>' +
                        '</div>' +
                        '<div class="crawler-edit-body">' +
                            '<div class="crawler-edit-col">' +
                                '<label>Nguyên văn (中文)</label>' +
                                '<textarea readonly id="crawlerEditZh"></textarea>' +
                            '</div>' +
                            '<div class="crawler-edit-col">' +
                                '<label>Bản dịch (Tiếng Việt)</label>' +
                                '<textarea id="crawlerEditVi"></textarea>' +
                            '</div>' +
                        '</div>' +
                        '<div class="crawler-edit-footer">' +
                            '<button class="btn btn-accent" id="crawlerEditSave">Lưu</button>' +
                            '<button class="btn btn-default" id="crawlerEditCancel">Hủy</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        // Cache refs
        els.browse = rootEl.querySelector('#crawlerBrowse');
        els.novels = rootEl.querySelector('#crawlerNovels');
        els.urlInput = rootEl.querySelector('#crawlerUrlInput');
        els.goBtn = rootEl.querySelector('#crawlerGoBtn');
        els.backBtn = rootEl.querySelector('#crawlerBackBtn');
        els.siteSelect = rootEl.querySelector('#crawlerSiteSelect');
        els.sidebar = rootEl.querySelector('#crawlerSidebar');
        els.sidebarTitle = rootEl.querySelector('#crawlerSidebarTitle');
        els.sidebarClose = rootEl.querySelector('#crawlerSidebarClose');
        els.chapterList = rootEl.querySelector('#crawlerChapterList');
        els.content = rootEl.querySelector('#crawlerContent');
        els.loading = rootEl.querySelector('#crawlerLoading');
        els.prevBtn = rootEl.querySelector('#crawlerPrevBtn');
        els.nextBtn = rootEl.querySelector('#crawlerNextBtn');
        els.saveBtn = rootEl.querySelector('#crawlerSaveBtn');
        els.toggleSidebar = rootEl.querySelector('#crawlerToggleSidebar');
        els.bottombar = rootEl.querySelector('#crawlerBottombar');
        els.novelsList = rootEl.querySelector('#crawlerNovelsList');
        els.novelsEmpty = rootEl.querySelector('#crawlerNovelsEmpty');
        els.newBrowse = rootEl.querySelector('#crawlerNewBrowse');
        els.editModal = rootEl.querySelector('#crawlerEditModal');
        els.editZh = rootEl.querySelector('#crawlerEditZh');
        els.editVi = rootEl.querySelector('#crawlerEditVi');
        els.editSave = rootEl.querySelector('#crawlerEditSave');
        els.editClose = rootEl.querySelector('#crawlerEditClose');
        els.editCancel = rootEl.querySelector('#crawlerEditCancel');

        // Populate site selector
        for (var i = 0; i < SITE_PRESETS.length; i++) {
            var opt = document.createElement('option');
            opt.value = SITE_PRESETS[i].id;
            opt.textContent = SITE_PRESETS[i].name;
            els.siteSelect.appendChild(opt);
        }

        // Apply reader font settings
        applyReaderSettings();
    }

    function applyReaderSettings() {
        try {
            var s = JSON.parse(localStorage.getItem('readerSettings'));
            if (s && els.content) {
                els.content.style.fontSize = (s.fontSize || 18) + 'px';
                els.content.style.lineHeight = s.lineHeight || 1.8;
                els.content.style.fontFamily = s.fontFamily === 'serif'
                    ? "'Noto Serif', 'Georgia', serif"
                    : "var(--font)";
            }
        } catch (e) {}
    }

    function bindEvents() {
        // Go button / enter key
        els.goBtn.addEventListener('click', function () {
            var url = els.urlInput.value.trim();
            if (url) navigateTo(url);
        });
        els.urlInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                var url = els.urlInput.value.trim();
                if (url) navigateTo(url);
            }
        });

        // Back button
        els.backBtn.addEventListener('click', goBack);

        // Site select
        els.siteSelect.addEventListener('change', function () {
            var val = els.siteSelect.value;
            if (val === 'auto') {
                state.siteConfig = null;
            } else {
                for (var i = 0; i < SITE_PRESETS.length; i++) {
                    if (SITE_PRESETS[i].id === val) { state.siteConfig = SITE_PRESETS[i]; break; }
                }
            }
        });

        // Sidebar toggle
        els.toggleSidebar.addEventListener('click', function () {
            els.sidebar.classList.toggle('hidden');
        });
        els.sidebarClose.addEventListener('click', function () {
            els.sidebar.classList.add('hidden');
        });

        // Chapter list click
        els.chapterList.addEventListener('click', function (e) {
            var item = e.target.closest('.crawler-ch-item');
            if (!item) return;
            var url = item.dataset.url;
            if (url) navigateTo(url);
        });

        // Prev/next
        els.prevBtn.addEventListener('click', function () {
            if (state.parsedPage && state.parsedPage.prevUrl) navigateTo(state.parsedPage.prevUrl);
        });
        els.nextBtn.addEventListener('click', function () {
            if (state.parsedPage && state.parsedPage.nextUrl) navigateTo(state.parsedPage.nextUrl);
        });

        // Save chapter
        els.saveBtn.addEventListener('click', saveCurrentChapter);

        // New browse
        els.newBrowse.addEventListener('click', function () {
            state.novelProject = null;
            state.history = [];
            state.historyIndex = -1;
            els.urlInput.value = '';
            els.content.innerHTML = '';
            els.chapterList.innerHTML = '';
            els.sidebar.classList.add('hidden');
            showBrowseView();
            els.urlInput.focus();
        });

        // Novels list click delegation
        els.novelsList.addEventListener('click', function (e) {
            var openBtn = e.target.closest('.crawler-novel-open');
            if (openBtn) { openNovel(openBtn.dataset.id); return; }
            var exportBtn = e.target.closest('.crawler-novel-export');
            if (exportBtn) { exportToLibrary(exportBtn.dataset.id); return; }
            var deleteBtn = e.target.closest('.crawler-novel-delete');
            if (deleteBtn) {
                if (confirm('Xóa truyện này và tất cả chương đã lưu?')) {
                    deleteNovel(deleteBtn.dataset.id);
                }
                return;
            }
        });

        // Edit modal
        els.editClose.addEventListener('click', function () { els.editModal.classList.add('hidden'); });
        els.editCancel.addEventListener('click', function () { els.editModal.classList.add('hidden'); });
        els.editSave.addEventListener('click', saveEditedChapter);

        // Hover tooltip for original Chinese
        els.content.addEventListener('mouseover', function (e) {
            var p = e.target.closest('[data-zh]');
            if (p) p.title = p.dataset.zh;
        });
    }

    // ===== View Switching =====

    function showBrowseView() {
        els.browse.classList.remove('hidden');
        els.novels.classList.add('hidden');
    }

    function showNovelsView() {
        els.browse.classList.add('hidden');
        els.novels.classList.remove('hidden');
        renderNovelsList();
    }

    // ===== Navigation =====

    function navigateTo(url) {
        if (state.loading) return;
        // Ensure URL has protocol
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        els.urlInput.value = url;

        // Auto-detect site
        if (!state.siteConfig || els.siteSelect.value === 'auto') {
            var detected = detectSite(url);
            if (detected) {
                state.siteConfig = detected;
                els.siteSelect.value = detected.id || 'auto';
            }
        }

        // Push to history
        if (state.currentUrl && state.currentUrl !== url) {
            // Trim forward history
            state.history = state.history.slice(0, state.historyIndex + 1);
            state.history.push(state.currentUrl);
            state.historyIndex = state.history.length - 1;
        }

        state.currentUrl = url;
        state.loading = true;
        showBrowseView();
        setLoading(true);
        els.content.innerHTML = '';

        fetchPage(url).then(function (html) {
            var parsed = parsePage(html, url, state.siteConfig);
            state.parsedPage = parsed;

            if (parsed.isIndexPage && parsed.chapterLinks) {
                renderIndexPage(parsed);
                state.loading = false;
                setLoading(false);
                return;
            }

            if (parsed.content) {
                state.zhContent = parsed.content;
                return translateText(parsed.content).then(function (vi) {
                    state.translatedContent = vi;
                    renderChapterPage(parsed, vi);
                    state.loading = false;
                    setLoading(false);
                });
            }

            // Fallback: show raw text
            els.content.innerHTML = '<p style="color:var(--text-muted)">Không nhận diện được nội dung. Thử chọn đúng site preset.</p>';
            state.loading = false;
            setLoading(false);
        }).catch(function (err) {
            els.content.innerHTML = '<p style="color:#ff6b6b">Lỗi: ' + VP.escapeHtml(err.message) + '</p>';
            state.loading = false;
            setLoading(false);
        });
    }

    function goBack() {
        if (state.historyIndex >= 0) {
            var url = state.history[state.historyIndex];
            state.historyIndex--;
            state.currentUrl = url;
            els.urlInput.value = url;
            navigateWithoutHistory(url);
        } else {
            showNovelsView();
        }
    }

    function navigateWithoutHistory(url) {
        state.loading = true;
        setLoading(true);
        els.content.innerHTML = '';

        fetchPage(url).then(function (html) {
            var parsed = parsePage(html, url, state.siteConfig);
            state.parsedPage = parsed;

            if (parsed.isIndexPage && parsed.chapterLinks) {
                renderIndexPage(parsed);
                state.loading = false;
                setLoading(false);
                return;
            }

            if (parsed.content) {
                state.zhContent = parsed.content;
                return translateText(parsed.content).then(function (vi) {
                    state.translatedContent = vi;
                    renderChapterPage(parsed, vi);
                    state.loading = false;
                    setLoading(false);
                });
            }

            els.content.innerHTML = '<p style="color:var(--text-muted)">Không nhận diện được nội dung.</p>';
            state.loading = false;
            setLoading(false);
        }).catch(function (err) {
            els.content.innerHTML = '<p style="color:#ff6b6b">Lỗi: ' + VP.escapeHtml(err.message) + '</p>';
            state.loading = false;
            setLoading(false);
        });
    }

    function setLoading(on) {
        if (on) {
            els.loading.classList.remove('hidden');
            els.content.classList.add('hidden');
        } else {
            els.loading.classList.add('hidden');
            els.content.classList.remove('hidden');
        }
    }

    // ===== Rendering =====

    function renderIndexPage(parsed) {
        // Show chapter links as the main content + populate sidebar
        var html = '<div class="crawler-index-title">' + VP.escapeHtml(parsed.title) + '</div>';
        html += '<div class="crawler-index-info">' + parsed.chapterLinks.length + ' chương</div>';
        html += '<div class="crawler-index-list">';
        for (var i = 0; i < parsed.chapterLinks.length; i++) {
            html += '<a class="crawler-index-link" href="javascript:void(0)" data-url="' +
                VP.escapeHtml(parsed.chapterLinks[i].url) + '">' +
                VP.escapeHtml(parsed.chapterLinks[i].title) + '</a>';
        }
        html += '</div>';

        // Save to novel project button
        if (!state.novelProject) {
            html += '<div style="margin-top:16px;text-align:center">' +
                '<button class="btn btn-accent" id="crawlerSaveNovel">Lưu truyện này</button></div>';
        }

        els.content.innerHTML = html;
        updateNavButtons();

        // Bind index link clicks
        var links = els.content.querySelectorAll('.crawler-index-link');
        for (var j = 0; j < links.length; j++) {
            links[j].addEventListener('click', function (e) {
                e.preventDefault();
                navigateTo(this.dataset.url);
            });
        }

        // Save novel button
        var saveBtn = els.content.querySelector('#crawlerSaveNovel');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                saveAsNovel(parsed);
            });
        }

        // Populate sidebar
        populateSidebar(parsed.chapterLinks);
    }

    function renderChapterPage(parsed, viContent) {
        var zhLines = (state.zhContent || '').split('\n');
        var viLines = viContent.split('\n');
        var html = '';

        if (parsed.title) {
            html += '<div class="crawler-chapter-title">' + VP.escapeHtml(parsed.title) + '</div>';
        }

        for (var i = 0; i < viLines.length; i++) {
            var vi = viLines[i].trim();
            var zh = zhLines[i] ? zhLines[i].trim() : '';
            if (vi) {
                html += '<p data-zh="' + VP.escapeHtml(zh) + '">' + VP.escapeHtml(vi) + '</p>';
            } else {
                html += '<p></p>';
            }
        }

        // Edit button at end
        html += '<div style="text-align:center;margin-top:24px">' +
            '<button class="btn btn-default" id="crawlerEditBtn">Chỉnh sửa bản dịch</button></div>';

        els.content.innerHTML = html;
        els.content.scrollTop = 0;
        updateNavButtons();
        updateSidebarActive();

        // Edit button
        var editBtn = els.content.querySelector('#crawlerEditBtn');
        if (editBtn) {
            editBtn.addEventListener('click', function () {
                openEditModal(state.zhContent, state.translatedContent);
            });
        }
    }

    function populateSidebar(chapterLinks) {
        if (!chapterLinks || chapterLinks.length === 0) {
            els.sidebar.classList.add('hidden');
            return;
        }

        var novel = state.novelProject;
        var savedSet = {};
        if (novel && novel.chapters) {
            for (var i = 0; i < novel.chapters.length; i++) {
                if (novel.chapters[i].saved) savedSet[novel.chapters[i].url] = true;
            }
        }

        var html = '';
        for (var j = 0; j < chapterLinks.length; j++) {
            var ch = chapterLinks[j];
            var saved = savedSet[ch.url] ? ' ✓' : '';
            var activeClass = (state.currentUrl === ch.url) ? ' active' : '';
            html += '<div class="crawler-ch-item' + activeClass + '" data-url="' +
                VP.escapeHtml(ch.url) + '" data-index="' + j + '">' +
                VP.escapeHtml(ch.title) + '<span class="crawler-ch-saved">' + saved + '</span></div>';
        }
        els.chapterList.innerHTML = html;

        // Show sidebar on desktop
        if (window.innerWidth > 700) {
            els.sidebar.classList.remove('hidden');
        }
    }

    function updateSidebarActive() {
        var items = els.chapterList.querySelectorAll('.crawler-ch-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('active', items[i].dataset.url === state.currentUrl);
        }
        // Scroll active into view
        var active = els.chapterList.querySelector('.crawler-ch-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function updateNavButtons() {
        var p = state.parsedPage;
        els.prevBtn.disabled = !(p && p.prevUrl);
        els.nextBtn.disabled = !(p && p.nextUrl);
        els.prevBtn.style.opacity = (p && p.prevUrl) ? '1' : '0.4';
        els.nextBtn.style.opacity = (p && p.nextUrl) ? '1' : '0.4';
        els.saveBtn.style.display = (p && p.isChapterPage) ? '' : 'none';
    }

    // ===== Novel Projects =====

    function saveAsNovel(parsed) {
        var novel = {
            id: 'novel_' + Date.now(),
            title: parsed.title || 'Untitled',
            author: '',
            sourceUrl: state.currentUrl,
            siteId: state.siteConfig ? state.siteConfig.id : 'custom',
            siteConfig: state.siteConfig || null,
            chapters: parsed.chapterLinks.map(function (ch, i) {
                return { index: i, title: ch.title, url: ch.url, saved: false };
            }),
            savedCount: 0,
            customPhrases: {},
            dateAdded: Date.now(),
            exportedBookId: null
        };

        dbPut('novels', novel).then(function () {
            state.novelProject = novel;
            populateSidebar(parsed.chapterLinks);
            // Replace save button with status
            var saveBtn = els.content.querySelector('#crawlerSaveNovel');
            if (saveBtn) {
                saveBtn.textContent = 'Đã lưu!';
                saveBtn.disabled = true;
                saveBtn.classList.remove('btn-accent');
                saveBtn.classList.add('btn-green');
            }
        });
    }

    function saveCurrentChapter() {
        if (!state.parsedPage || !state.parsedPage.isChapterPage) return;
        if (!state.zhContent || !state.translatedContent) return;

        var novel = state.novelProject;
        if (!novel) {
            // Auto-create novel project if we have sidebar data
            alert('Hãy mở trang mục lục trước và nhấn "Lưu truyện này"');
            return;
        }

        // Find chapter index
        var chapterIndex = -1;
        for (var i = 0; i < novel.chapters.length; i++) {
            if (novel.chapters[i].url === state.currentUrl) {
                chapterIndex = i;
                break;
            }
        }
        if (chapterIndex === -1) {
            // Chapter not in list — append it
            chapterIndex = novel.chapters.length;
            novel.chapters.push({
                index: chapterIndex,
                title: state.parsedPage.title || 'Chapter ' + (chapterIndex + 1),
                url: state.currentUrl,
                saved: false
            });
        }

        var chapterData = {
            novelId: novel.id,
            chapterIndex: chapterIndex,
            zhContent: state.zhContent,
            viContent: state.translatedContent,
            viEdited: null,
            dateSaved: Date.now()
        };

        els.saveBtn.disabled = true;
        els.saveBtn.textContent = 'Đang lưu...';

        dbPut('chapter-content', chapterData).then(function () {
            novel.chapters[chapterIndex].saved = true;
            novel.savedCount = novel.chapters.filter(function (c) { return c.saved; }).length;
            return dbPut('novels', novel);
        }).then(function () {
            els.saveBtn.textContent = 'Đã lưu ✓';
            els.saveBtn.classList.remove('btn-green');
            els.saveBtn.classList.add('btn-default');
            setTimeout(function () {
                els.saveBtn.textContent = 'Lưu chương';
                els.saveBtn.classList.remove('btn-default');
                els.saveBtn.classList.add('btn-green');
                els.saveBtn.disabled = false;
            }, 2000);
            // Update sidebar checkmark
            updateSidebarSaved();
        }).catch(function (err) {
            els.saveBtn.textContent = 'Lỗi!';
            els.saveBtn.disabled = false;
            console.error('Save chapter error:', err);
        });
    }

    function updateSidebarSaved() {
        var novel = state.novelProject;
        if (!novel) return;
        var items = els.chapterList.querySelectorAll('.crawler-ch-item');
        for (var i = 0; i < items.length; i++) {
            var url = items[i].dataset.url;
            var ch = novel.chapters.find(function (c) { return c.url === url; });
            var savedSpan = items[i].querySelector('.crawler-ch-saved');
            if (savedSpan && ch && ch.saved) {
                savedSpan.textContent = ' ✓';
            }
        }
    }

    // ===== Novels List =====

    function renderNovelsList() {
        dbGetAll('novels').then(function (novels) {
            if (!novels.length) {
                els.novelsList.innerHTML = '';
                els.novelsEmpty.classList.remove('hidden');
                return;
            }
            els.novelsEmpty.classList.add('hidden');
            // Sort by date desc
            novels.sort(function (a, b) { return (b.dateAdded || 0) - (a.dateAdded || 0); });

            var html = '';
            for (var i = 0; i < novels.length; i++) {
                var n = novels[i];
                var totalCh = n.chapters ? n.chapters.length : 0;
                html += '<div class="crawler-novel-card">' +
                    '<div class="crawler-novel-info">' +
                        '<div class="crawler-novel-name">' + VP.escapeHtml(n.title) + '</div>' +
                        '<div class="crawler-novel-meta">' + n.savedCount + '/' + totalCh + ' chương đã lưu</div>' +
                    '</div>' +
                    '<div class="crawler-novel-actions">' +
                        '<button class="btn btn-accent crawler-novel-open" data-id="' + n.id + '">Mở</button>' +
                        '<button class="btn btn-default crawler-novel-export" data-id="' + n.id + '">Xuất</button>' +
                        '<button class="btn btn-red crawler-novel-delete" data-id="' + n.id + '">Xóa</button>' +
                    '</div>' +
                '</div>';
            }
            els.novelsList.innerHTML = html;
        });
    }

    function openNovel(novelId) {
        dbGet('novels', novelId).then(function (novel) {
            if (!novel) return;
            state.novelProject = novel;
            // Restore site config
            if (novel.siteConfig) {
                state.siteConfig = novel.siteConfig;
            } else {
                var preset = SITE_PRESETS.find(function (p) { return p.id === novel.siteId; });
                if (preset) state.siteConfig = preset;
            }
            if (state.siteConfig) {
                els.siteSelect.value = state.siteConfig.id || 'auto';
            }
            // Show browse view with chapter list
            showBrowseView();
            els.urlInput.value = novel.sourceUrl || '';
            populateSidebar(novel.chapters);
            els.content.innerHTML =
                '<div class="crawler-index-title">' + VP.escapeHtml(novel.title) + '</div>' +
                '<div class="crawler-index-info">' + novel.savedCount + '/' + novel.chapters.length + ' chương đã lưu</div>' +
                '<p style="color:var(--text-secondary);margin-top:12px">Chọn một chương từ mục lục để đọc.</p>';
            els.sidebar.classList.remove('hidden');
        });
    }

    function deleteNovel(novelId) {
        deleteNovelChapters(novelId).then(function () {
            return dbDelete('novels', novelId);
        }).then(function () {
            if (state.novelProject && state.novelProject.id === novelId) {
                state.novelProject = null;
            }
            renderNovelsList();
        });
    }

    // ===== Export to Library =====

    function exportToLibrary(novelId) {
        dbGet('novels', novelId).then(function (novel) {
            if (!novel) return;
            return getNovelChapters(novelId).then(function (chapters) {
                if (!chapters.length) {
                    alert('Chưa lưu chương nào để xuất!');
                    return;
                }
                // Sort by chapterIndex
                chapters.sort(function (a, b) { return a.chapterIndex - b.chapterIndex; });
                // Concatenate
                var fullText = '';
                for (var i = 0; i < chapters.length; i++) {
                    var ch = chapters[i];
                    var chMeta = novel.chapters[ch.chapterIndex];
                    var title = chMeta ? chMeta.title : ('Chương ' + (ch.chapterIndex + 1));
                    var content = ch.viEdited || ch.viContent || '';
                    fullText += title + '\n\n' + content + '\n\n';
                }
                return ReaderLib.importBook(novel.title, fullText.trim(), 'txt').then(function (result) {
                    novel.exportedBookId = result.id;
                    return dbPut('novels', novel);
                }).then(function () {
                    alert('Đã xuất "' + novel.title + '" vào Thư viện! (' + chapters.length + ' chương)');
                });
            });
        }).catch(function (err) {
            alert('Lỗi xuất: ' + err.message);
        });
    }

    // ===== Edit Modal =====

    var editingChapterIndex = -1;

    function openEditModal(zh, vi) {
        els.editZh.value = zh || '';
        els.editVi.value = vi || '';
        els.editModal.classList.remove('hidden');

        // Find current chapter index in novel
        editingChapterIndex = -1;
        if (state.novelProject) {
            for (var i = 0; i < state.novelProject.chapters.length; i++) {
                if (state.novelProject.chapters[i].url === state.currentUrl) {
                    editingChapterIndex = i;
                    break;
                }
            }
        }
    }

    function saveEditedChapter() {
        var newVi = els.editVi.value;
        state.translatedContent = newVi;
        // Re-render with edited content
        if (state.parsedPage) {
            renderChapterPage(state.parsedPage, newVi);
        }
        // Save to IDB if chapter is saved
        if (state.novelProject && editingChapterIndex >= 0) {
            var key = [state.novelProject.id, editingChapterIndex];
            dbGet('chapter-content', key).then(function (existing) {
                if (existing) {
                    existing.viEdited = newVi;
                    return dbPut('chapter-content', existing);
                }
            });
        }
        els.editModal.classList.add('hidden');
    }

    // ===== Public API =====

    window.CrawlerEngine = {
        init: init,
        navigateTo: navigateTo,
        goBack: goBack,
        saveCurrentChapter: saveCurrentChapter,
        getAllNovels: function () { return dbGetAll('novels'); },
        openNovel: openNovel,
        deleteNovel: deleteNovel,
        exportToLibrary: exportToLibrary,
        getPresets: function () { return SITE_PRESETS.slice(); },
        detectSite: detectSite
    };
})();
