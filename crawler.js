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
    // NOTE: Sites behind Cloudflare bot challenge (69shuba.com, biquge.net)
    // will return 403 via server proxy. Only sites without aggressive bot
    // protection work (e.g. uukanshu.cc).
    var SITE_PRESETS = [
        {
            id: 'uukanshu',
            name: 'UU\u770B\u66F8',
            icon: '\uD83D\uDCD6',
            baseUrl: 'https://www.uukanshu.cc',
            urlPattern: /uukanshu/,
            home: {
                featured: {
                    container: '#fengtui .item',
                    title: 'dl dt a',
                    author: 'dl dt span',
                    description: 'dl dd',
                    link: 'dl dt a'
                },
                categories: [
                    { name: '\u7384\u5E7B\u5947\u5E7B', url: '/class_1_1.html' },
                    { name: '\u6B66\u4FE0\u4ED9\u4FE0', url: '/class_2_1.html' },
                    { name: '\u73FE\u4EE3\u90FD\u5E02', url: '/class_3_1.html' },
                    { name: '\u6B77\u53F2\u8ECD\u4E8B', url: '/class_4_1.html' },
                    { name: '\u79D1\u5E7B\u5C0F\u8AAA', url: '/class_5_1.html' },
                    { name: '\u904A\u6232\u7AF6\u6280', url: '/class_6_1.html' },
                    { name: '\u6050\u6016\u9748\u7570', url: '/class_7_1.html' },
                    { name: '\u8A00\u60C5\u5C0F\u8AAA', url: '/class_8_1.html' },
                    { name: '\u52D5\u6F2B\u540C\u4EBA', url: '/class_9_1.html' },
                    { name: '\u5176\u4ED6\u985E\u578B', url: '/class_10_1.html' }
                ],
                rankings: [
                    { name: 'T\u1ED5ng BXH',    url: '/top/allvisit_1.html' },
                    { name: 'Th\u00E1ng',       url: '/top/monthvisit_1.html' },
                    { name: 'Tu\u1EA7n',        url: '/top/weekvisit_1.html' },
                    { name: 'M\u1EDBi \u0111\u0103ng',    url: '/top/postdate_1.html' },
                    { name: 'M\u1EDBi update',  url: '/top/lastupdate_1.html' }
                ],
                novelList: {
                    container: '.bookbox',
                    title: '.bookname a',
                    author: '.author',
                    description: '.update',
                    link: '.bookname a'
                },
                pagination: {
                    next: '.pagelink .next',
                    pages: '.pagelink a'
                }
            },
            novel: {
                title: 'h1.booktitle, h1',
                author: '.booktag a.red',
                description: '.bookintro',
                chapterList: '.chapterlist dd a',
                reverseChapters: false
            },
            chapter: {
                content: '.readcotent',
                title: 'h1.pt10, h1',
                remove: ['script', '.ads', '.aadd', '.aminus', '.pattern', '.toolbar'],
                nextLink: 'a:contains("\u4E0B\u4E00\u7AE0"), a:contains("\u4E0B\u4E00\u9801")',
                prevLink: 'a:contains("\u4E0A\u4E00\u7AE0"), a:contains("\u4E0A\u4E00\u9801")'
            }
        },
        {
            id: 'biquge',
            name: 'Biquge',
            icon: '\uD83D\uDCD5',
            baseUrl: 'https://www.biquge.net',
            urlPattern: /biquge|biqg|xbiquge|ibiquge|bqg/,
            home: null,
            novel: {
                title: '#info h1, .info h1, h1',
                chapterList: '#list dd a, .listmain dd a, #chapterlist a',
                reverseChapters: false
            },
            chapter: {
                content: '#content, .content',
                title: '.bookname h1, .content h1, h1',
                remove: ['script', '.bottem', '.google', 'div[align="center"]', 'p:empty'],
                nextLink: '#next_url, a:contains("\u4E0B\u4E00\u7AE0")',
                prevLink: '#prev_url, a:contains("\u4E0A\u4E00\u7AE0")'
            }
        },
        {
            id: '69shu',
            name: '69\u4E66\u5427',
            icon: '\uD83D\uDCD7',
            baseUrl: 'https://www.69shuba.com',
            urlPattern: /69shu/,
            home: null,
            novel: {
                title: '.bread-crumbs a:last-child, h1',
                chapterList: '.mu_contain li a',
                reverseChapters: false
            },
            chapter: {
                content: '.txtnav',
                title: 'h1, .h1title',
                remove: ['script', '.txtinfo', '.bottom-ad', 'div[align="center"]', '.ads'],
                nextLink: '#next_url, a:contains("\u4E0B\u4E00\u7AE0")',
                prevLink: '#prev_url, a:contains("\u4E0A\u4E00\u7AE0")'
            }
        }
    ];

    function detectSite(url) {
        for (var i = 0; i < SITE_PRESETS.length; i++) {
            if (SITE_PRESETS[i].urlPattern.test(url)) return SITE_PRESETS[i];
        }
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
            var body = doc.body;
            result.title = doc.title || '';
            result.content = extractTextContent(body);
            return result;
        }

        // Try index page FIRST (chapter list is a strong signal)
        var chapterEls = safeQueryAll(doc, siteConfig.novel.chapterList);
        if (chapterEls.length > 0) {
            result.isIndexPage = true;
            var titleEl2 = safeQuery(doc, siteConfig.novel.title);
            result.title = titleEl2 ? titleEl2.textContent.trim() : doc.title || '';
            // Extract author and description if selectors exist
            if (siteConfig.novel.author) {
                var authorEl = safeQuery(doc, siteConfig.novel.author);
                if (authorEl) result.author = authorEl.textContent.trim();
            }
            if (siteConfig.novel.description) {
                var descEl = safeQuery(doc, siteConfig.novel.description);
                if (descEl) result.description = extractTextContent(descEl);
            }
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

        // Then try chapter page
        var contentEl = safeQuery(doc, siteConfig.chapter.content);
        if (contentEl) {
            result.isChapterPage = true;
            var titleEl = safeQuery(doc, siteConfig.chapter.title);
            result.title = titleEl ? titleEl.textContent.trim() : doc.title || '';
            if (siteConfig.chapter.remove) {
                siteConfig.chapter.remove.forEach(function (sel) {
                    var remEls = contentEl.querySelectorAll(sel);
                    for (var i = 0; i < remEls.length; i++) remEls[i].remove();
                });
            }
            result.content = extractTextContent(contentEl);
            result.prevUrl = findNavLink(doc, siteConfig.chapter.prevLink, pageUrl);
            result.nextUrl = findNavLink(doc, siteConfig.chapter.nextLink, pageUrl);
            return result;
        }

        // Fallback
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
        try {
            var all = doc.querySelectorAll(selector);
            if (all.length > 0) return all;
        } catch (e) {}
        var sels = selector.split(',');
        for (var i = 0; i < sels.length; i++) {
            try {
                var els2 = doc.querySelectorAll(sels[i].trim());
                if (els2.length > 0) return els2;
            } catch (e) {}
        }
        return [];
    }

    function extractTextContent(el) {
        if (!el) return '';
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
        return text.replace(/\n{3,}/g, '\n\n').trim();
    }

    function findNavLink(doc, selector, baseUrl) {
        if (!selector) return null;
        var sels = selector.split(',');
        for (var i = 0; i < sels.length; i++) {
            try {
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
        loading: false,
        // View system
        viewStack: ['home'],
        activePreset: null
    };

    // ===== UI =====

    var rootEl = null;
    var els = {};

    // View IDs mapping
    var VIEW_IDS = {
        home: 'crawlerHome',
        siteHome: 'crawlerSiteHome',
        list: 'crawlerList',
        browse: 'crawlerBrowse'
    };

    function init(container) {
        rootEl = container;
        renderShell();
        bindEvents();
        showView('home');
        renderSiteGrid();
        renderSavedNovels();
    }

    function renderShell() {
        rootEl.innerHTML =
            '<div class="crawler-shell">' +
                // ===== Home View =====
                '<div class="crawler-home" id="crawlerHome">' +
                    '<div class="crawler-section-title">' +
                        '<span>Ch\u1ECDn ngu\u1ED3n truy\u1EC7n</span>' +
                    '</div>' +
                    '<div class="crawler-site-grid" id="crawlerSiteGrid"></div>' +
                    '<div class="crawler-section-title" style="margin-top:28px">' +
                        '<span>Truy\u1EC7n \u0111\u00E3 l\u01B0u</span>' +
                        '<button class="btn btn-default" id="crawlerBrowseUrl" style="font-size:12px;padding:6px 14px;margin-left:auto">' +
                            'Duy\u1EC7t URL' +
                        '</button>' +
                    '</div>' +
                    '<div class="crawler-novels-list" id="crawlerNovelsList"></div>' +
                    '<div class="crawler-novels-empty hidden" id="crawlerNovelsEmpty">' +
                        '<div class="empty-icon">&#x1F310;</div>' +
                        '<div class="empty-title">Ch\u01B0a c\u00F3 truy\u1EC7n n\u00E0o</div>' +
                        '<div class="empty-sub">Ch\u1ECDn ngu\u1ED3n truy\u1EC7n \u1EDF tr\u00EAn ho\u1EB7c d\u00F9ng "Duy\u1EC7t URL"</div>' +
                    '</div>' +
                '</div>' +
                // ===== Site Home View =====
                '<div class="crawler-site-home hidden" id="crawlerSiteHome">' +
                    '<div class="crawler-site-home-header">' +
                        '<button class="btn btn-default crawler-back-btn" id="crawlerSiteHomeBack">&larr;</button>' +
                        '<span class="crawler-site-home-name" id="crawlerSiteHomeName"></span>' +
                    '</div>' +
                    '<div class="crawler-section-title">Th\u1EC3 lo\u1EA1i</div>' +
                    '<div class="crawler-cat-grid" id="crawlerCatGrid"></div>' +
                    '<div class="crawler-section-title" style="margin-top:24px">B\u1EA3ng x\u1EBFp h\u1EA1ng</div>' +
                    '<div class="crawler-rank-tabs" id="crawlerRankTabs"></div>' +
                    '<div class="crawler-novel-grid" id="crawlerRankContent"></div>' +
                    '<div class="crawler-loading hidden" id="crawlerRankLoading">' +
                        '<div class="crawler-spinner"></div>' +
                        '<span>\u0110ang t\u1EA3i...</span>' +
                    '</div>' +
                    '<div class="crawler-section-title" style="margin-top:24px">Truy\u1EC7n n\u1ED5i b\u1EADt</div>' +
                    '<div class="crawler-novel-grid" id="crawlerFeatured"></div>' +
                    '<div class="crawler-loading hidden" id="crawlerFeaturedLoading">' +
                        '<div class="crawler-spinner"></div>' +
                        '<span>\u0110ang t\u1EA3i...</span>' +
                    '</div>' +
                '</div>' +
                // ===== List View =====
                '<div class="crawler-list hidden" id="crawlerList">' +
                    '<div class="crawler-list-header">' +
                        '<button class="btn btn-default crawler-back-btn" id="crawlerListBack">&larr;</button>' +
                        '<span class="crawler-list-title" id="crawlerListTitle"></span>' +
                    '</div>' +
                    '<div class="crawler-novel-grid" id="crawlerListContent"></div>' +
                    '<div class="crawler-loading hidden" id="crawlerListLoading">' +
                        '<div class="crawler-spinner"></div>' +
                        '<span>\u0110ang t\u1EA3i...</span>' +
                    '</div>' +
                    '<div class="crawler-pagination" id="crawlerListPagination"></div>' +
                '</div>' +
                // ===== Browse View =====
                '<div class="crawler-browse hidden" id="crawlerBrowse">' +
                    '<div class="crawler-topbar">' +
                        '<button class="btn btn-default crawler-back-btn" id="crawlerBackBtn" title="Quay l\u1EA1i">&larr;</button>' +
                        '<input type="text" class="crawler-url-input" id="crawlerUrlInput" placeholder="Nh\u1EADp URL truy\u1EC7n...">' +
                        '<button class="btn btn-accent crawler-go-btn" id="crawlerGoBtn">\u0110i</button>' +
                        '<select class="crawler-site-select" id="crawlerSiteSelect">' +
                            '<option value="auto">T\u1EF1 nh\u1EADn di\u1EC7n</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="reader-settings" id="crawlerSettingsBar">' +
                        '<div class="settings-group">' +
                            '<label>C\u1EE1</label>' +
                            '<button class="settings-btn" id="crawlerBtnFontDown">A-</button>' +
                            '<span class="settings-val" id="crawlerValFontSize">18</span>' +
                            '<button class="settings-btn" id="crawlerBtnFontUp">A+</button>' +
                        '</div>' +
                        '<div class="settings-sep"></div>' +
                        '<div class="settings-group">' +
                            '<label>D\u00E3n</label>' +
                            '<button class="settings-btn" id="crawlerBtnLineDown">-</button>' +
                            '<span class="settings-val" id="crawlerValLineHeight">1.8</span>' +
                            '<button class="settings-btn" id="crawlerBtnLineUp">+</button>' +
                        '</div>' +
                        '<div class="settings-sep"></div>' +
                        '<div class="settings-group">' +
                            '<label>Font</label>' +
                            '<select class="font-select" id="crawlerSelFont">' +
                                '<option value="sans">Sans-serif</option>' +
                                '<option value="serif">Serif</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="settings-sep"></div>' +
                        '<div class="settings-group">' +
                            '<label>Theme</label>' +
                            '<select class="theme-select" id="crawlerSelTheme">' +
                                '<option value="default">Auto</option>' +
                                '<option value="sepia">Sepia</option>' +
                            '</select>' +
                        '</div>' +
                    '</div>' +
                    '<div class="crawler-main">' +
                        '<div class="crawler-sidebar hidden" id="crawlerSidebar">' +
                            '<div class="crawler-sidebar-header">' +
                                '<span id="crawlerSidebarTitle">Danh s\u00E1ch ch\u01B0\u01A1ng</span>' +
                                '<button class="btn btn-default crawler-sidebar-close" id="crawlerSidebarClose">&times;</button>' +
                            '</div>' +
                            '<div class="crawler-chapter-list" id="crawlerChapterList"></div>' +
                        '</div>' +
                        '<div class="crawler-content-area">' +
                            '<div class="crawler-loading hidden" id="crawlerLoading">' +
                                '<div class="crawler-spinner"></div>' +
                                '<span>\u0110ang t\u1EA3i...</span>' +
                            '</div>' +
                            '<div class="crawler-content" id="crawlerContent"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="crawler-bottombar" id="crawlerBottombar">' +
                        '<button class="btn btn-default" id="crawlerPrevBtn">&larr; Tr\u01B0\u1EDBc</button>' +
                        '<button class="btn btn-green" id="crawlerSaveBtn">L\u01B0u ch\u01B0\u01A1ng</button>' +
                        '<button class="btn btn-default" id="crawlerToggleSidebar">M\u1EE5c l\u1EE5c</button>' +
                        '<button class="btn btn-default" id="crawlerNextBtn">Ti\u1EBFp &rarr;</button>' +
                    '</div>' +
                '</div>' +
                // ===== Edit Modal =====
                '<div class="crawler-edit-modal hidden" id="crawlerEditModal">' +
                    '<div class="crawler-edit-overlay"></div>' +
                    '<div class="crawler-edit-box">' +
                        '<div class="crawler-edit-header">' +
                            '<span>Ch\u1EC9nh s\u1EEDa b\u1EA3n d\u1ECBch</span>' +
                            '<button class="btn btn-default" id="crawlerEditClose">&times;</button>' +
                        '</div>' +
                        '<div class="crawler-edit-body">' +
                            '<div class="crawler-edit-col">' +
                                '<label>Nguy\u00EAn v\u0103n (\u4E2D\u6587)</label>' +
                                '<textarea readonly id="crawlerEditZh"></textarea>' +
                            '</div>' +
                            '<div class="crawler-edit-col">' +
                                '<label>B\u1EA3n d\u1ECBch (Ti\u1EBFng Vi\u1EC7t)</label>' +
                                '<textarea id="crawlerEditVi"></textarea>' +
                            '</div>' +
                        '</div>' +
                        '<div class="crawler-edit-footer">' +
                            '<button class="btn btn-accent" id="crawlerEditSave">L\u01B0u</button>' +
                            '<button class="btn btn-default" id="crawlerEditCancel">H\u1EE7y</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        // Cache DOM refs — Home
        els.home = rootEl.querySelector('#crawlerHome');
        els.siteGrid = rootEl.querySelector('#crawlerSiteGrid');
        els.novelsList = rootEl.querySelector('#crawlerNovelsList');
        els.novelsEmpty = rootEl.querySelector('#crawlerNovelsEmpty');
        els.browseUrlBtn = rootEl.querySelector('#crawlerBrowseUrl');
        // Cache DOM refs — Site Home
        els.siteHome = rootEl.querySelector('#crawlerSiteHome');
        els.siteHomeName = rootEl.querySelector('#crawlerSiteHomeName');
        els.siteHomeBack = rootEl.querySelector('#crawlerSiteHomeBack');
        els.catGrid = rootEl.querySelector('#crawlerCatGrid');
        els.rankTabs = rootEl.querySelector('#crawlerRankTabs');
        els.rankContent = rootEl.querySelector('#crawlerRankContent');
        els.rankLoading = rootEl.querySelector('#crawlerRankLoading');
        els.featured = rootEl.querySelector('#crawlerFeatured');
        els.featuredLoading = rootEl.querySelector('#crawlerFeaturedLoading');
        // Cache DOM refs — List
        els.list = rootEl.querySelector('#crawlerList');
        els.listTitle = rootEl.querySelector('#crawlerListTitle');
        els.listBack = rootEl.querySelector('#crawlerListBack');
        els.listContent = rootEl.querySelector('#crawlerListContent');
        els.listLoading = rootEl.querySelector('#crawlerListLoading');
        els.listPagination = rootEl.querySelector('#crawlerListPagination');
        // Cache DOM refs — Browse
        els.browse = rootEl.querySelector('#crawlerBrowse');
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
        // Cache DOM refs — Settings bar
        els.settingsBar = rootEl.querySelector('#crawlerSettingsBar');
        els.valFontSize = rootEl.querySelector('#crawlerValFontSize');
        els.valLineHeight = rootEl.querySelector('#crawlerValLineHeight');
        els.selFont = rootEl.querySelector('#crawlerSelFont');
        els.selTheme = rootEl.querySelector('#crawlerSelTheme');
        els.btnFontDown = rootEl.querySelector('#crawlerBtnFontDown');
        els.btnFontUp = rootEl.querySelector('#crawlerBtnFontUp');
        els.btnLineDown = rootEl.querySelector('#crawlerBtnLineDown');
        els.btnLineUp = rootEl.querySelector('#crawlerBtnLineUp');
        // Cache DOM refs — Edit modal
        els.editModal = rootEl.querySelector('#crawlerEditModal');
        els.editZh = rootEl.querySelector('#crawlerEditZh');
        els.editVi = rootEl.querySelector('#crawlerEditVi');
        els.editSave = rootEl.querySelector('#crawlerEditSave');
        els.editClose = rootEl.querySelector('#crawlerEditClose');
        els.editCancel = rootEl.querySelector('#crawlerEditCancel');

        // Populate site selector in browse view
        for (var i = 0; i < SITE_PRESETS.length; i++) {
            var opt = document.createElement('option');
            opt.value = SITE_PRESETS[i].id;
            opt.textContent = SITE_PRESETS[i].name;
            els.siteSelect.appendChild(opt);
        }

        applyReaderSettings();
    }

    function loadSettings() {
        try {
            var s = JSON.parse(localStorage.getItem('readerSettings'));
            return {
                fontSize: (s && s.fontSize) || 18,
                lineHeight: (s && s.lineHeight) || 1.8,
                fontFamily: (s && s.fontFamily) || 'sans',
                readerTheme: (s && s.readerTheme) || 'default'
            };
        } catch (e) {
            return { fontSize: 18, lineHeight: 1.8, fontFamily: 'sans', readerTheme: 'default' };
        }
    }

    function saveSettings(s) {
        localStorage.setItem('readerSettings', JSON.stringify(s));
        localStorage.setItem('vp_settings_ts', String(Date.now()));
    }

    function applyReaderSettings() {
        var s = loadSettings();
        if (els.content) {
            els.content.style.fontSize = s.fontSize + 'px';
            els.content.style.lineHeight = s.lineHeight;
            els.content.style.fontFamily = s.fontFamily === 'serif'
                ? "'Noto Serif', 'Georgia', serif"
                : "var(--font)";
        }
        if (els.valFontSize) els.valFontSize.textContent = s.fontSize;
        if (els.valLineHeight) els.valLineHeight.textContent = s.lineHeight.toFixed(1);
        if (els.selFont) els.selFont.value = s.fontFamily;
        if (els.selTheme) els.selTheme.value = s.readerTheme;
        var browse = rootEl.querySelector('#crawlerBrowse');
        if (browse) browse.setAttribute('data-reader-theme', s.readerTheme);
    }

    function bindEvents() {
        // ===== Home View Events =====
        els.browseUrlBtn.addEventListener('click', function () {
            pushView('browse');
            state.novelProject = null;
            state.history = [];
            state.historyIndex = -1;
            els.urlInput.value = '';
            els.content.innerHTML = '';
            els.chapterList.innerHTML = '';
            els.sidebar.classList.add('hidden');
            els.urlInput.focus();
        });

        // Site grid clicks
        els.siteGrid.addEventListener('click', function (e) {
            var card = e.target.closest('.crawler-site-card');
            if (!card || card.classList.contains('disabled')) return;
            var presetId = card.dataset.presetId;
            for (var i = 0; i < SITE_PRESETS.length; i++) {
                if (SITE_PRESETS[i].id === presetId) {
                    openSiteHome(SITE_PRESETS[i]);
                    break;
                }
            }
        });

        // Saved novels list click delegation
        els.novelsList.addEventListener('click', function (e) {
            var openBtn = e.target.closest('.crawler-novel-open');
            if (openBtn) {
                pushView('browse');
                openNovel(openBtn.dataset.id);
                return;
            }
            var exportBtn = e.target.closest('.crawler-novel-export');
            if (exportBtn) { exportToLibrary(exportBtn.dataset.id); return; }
            var deleteBtn = e.target.closest('.crawler-novel-delete');
            if (deleteBtn) {
                if (confirm('X\u00F3a truy\u1EC7n n\u00E0y v\u00E0 t\u1EA5t c\u1EA3 ch\u01B0\u01A1ng \u0111\u00E3 l\u01B0u?')) {
                    deleteNovel(deleteBtn.dataset.id);
                }
                return;
            }
        });

        // ===== Site Home Events =====
        els.siteHomeBack.addEventListener('click', function () { popView(); });

        // Category pills
        els.catGrid.addEventListener('click', function (e) {
            var pill = e.target.closest('.crawler-cat-pill');
            if (!pill) return;
            var url = pill.dataset.url;
            var name = pill.textContent;
            if (url) openNovelList(url, name);
        });

        // Ranking tabs
        els.rankTabs.addEventListener('click', function (e) {
            var tab = e.target.closest('.crawler-rank-tab');
            if (!tab) return;
            var tabs = els.rankTabs.querySelectorAll('.crawler-rank-tab');
            for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
            tab.classList.add('active');
            loadRankingNovels(tab.dataset.url);
        });

        // Novel card clicks in site home (ranking + featured)
        els.rankContent.addEventListener('click', function (e) {
            var card = e.target.closest('.crawler-browse-card');
            if (card && card.dataset.url) openNovelFromCard(card.dataset.url);
        });
        els.featured.addEventListener('click', function (e) {
            var card = e.target.closest('.crawler-browse-card');
            if (card && card.dataset.url) openNovelFromCard(card.dataset.url);
        });

        // ===== List View Events =====
        els.listBack.addEventListener('click', function () { popView(); });

        // Novel card clicks in list
        els.listContent.addEventListener('click', function (e) {
            var card = e.target.closest('.crawler-browse-card');
            if (card && card.dataset.url) openNovelFromCard(card.dataset.url);
        });

        // Pagination clicks
        els.listPagination.addEventListener('click', function (e) {
            var btn = e.target.closest('.crawler-page-btn');
            if (!btn) return;
            var url = btn.dataset.url;
            if (url) loadNovelList(url);
        });

        // ===== Browse View Events =====
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

        els.backBtn.addEventListener('click', goBack);

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

        els.toggleSidebar.addEventListener('click', function () {
            els.sidebar.classList.toggle('hidden');
        });
        els.sidebarClose.addEventListener('click', function () {
            els.sidebar.classList.add('hidden');
        });

        els.chapterList.addEventListener('click', function (e) {
            var item = e.target.closest('.crawler-ch-item');
            if (!item) return;
            var url = item.dataset.url;
            if (url) navigateTo(url);
        });

        els.prevBtn.addEventListener('click', function () {
            if (state.parsedPage && state.parsedPage.prevUrl) navigateTo(state.parsedPage.prevUrl);
        });
        els.nextBtn.addEventListener('click', function () {
            if (state.parsedPage && state.parsedPage.nextUrl) navigateTo(state.parsedPage.nextUrl);
        });

        els.saveBtn.addEventListener('click', saveCurrentChapter);

        // Edit modal
        els.editClose.addEventListener('click', function () { els.editModal.classList.add('hidden'); });
        els.editCancel.addEventListener('click', function () { els.editModal.classList.add('hidden'); });
        els.editSave.addEventListener('click', saveEditedChapter);

        // Reader settings controls
        els.btnFontDown.addEventListener('click', function () {
            var s = loadSettings();
            if (s.fontSize > 14) { s.fontSize -= 2; saveSettings(s); applyReaderSettings(); }
        });
        els.btnFontUp.addEventListener('click', function () {
            var s = loadSettings();
            if (s.fontSize < 28) { s.fontSize += 2; saveSettings(s); applyReaderSettings(); }
        });
        els.btnLineDown.addEventListener('click', function () {
            var s = loadSettings();
            if (s.lineHeight > 1.4) { s.lineHeight = Math.round((s.lineHeight - 0.1) * 10) / 10; saveSettings(s); applyReaderSettings(); }
        });
        els.btnLineUp.addEventListener('click', function () {
            var s = loadSettings();
            if (s.lineHeight < 2.4) { s.lineHeight = Math.round((s.lineHeight + 0.1) * 10) / 10; saveSettings(s); applyReaderSettings(); }
        });
        els.selFont.addEventListener('change', function () {
            var s = loadSettings();
            s.fontFamily = els.selFont.value;
            saveSettings(s); applyReaderSettings();
        });
        els.selTheme.addEventListener('change', function () {
            var s = loadSettings();
            s.readerTheme = els.selTheme.value;
            saveSettings(s); applyReaderSettings();
        });

        // Hover tooltip for original Chinese
        els.content.addEventListener('mouseover', function (e) {
            var p = e.target.closest('[data-zh]');
            if (p) p.title = p.dataset.zh;
        });
    }

    // ===== View System =====

    function showView(name) {
        var keys = Object.keys(VIEW_IDS);
        for (var i = 0; i < keys.length; i++) {
            var viewEl = rootEl.querySelector('#' + VIEW_IDS[keys[i]]);
            if (viewEl) viewEl.classList.toggle('hidden', keys[i] !== name);
        }
    }

    function pushView(name) {
        state.viewStack.push(name);
        showView(name);
    }

    function popView() {
        if (state.viewStack.length > 1) {
            state.viewStack.pop();
            var prev = state.viewStack[state.viewStack.length - 1];
            showView(prev);
            if (prev === 'home') {
                renderSavedNovels();
            }
        }
    }

    // ===== Home View: Site Grid + Saved Novels =====

    function renderSiteGrid() {
        var html = '';
        for (var i = 0; i < SITE_PRESETS.length; i++) {
            var p = SITE_PRESETS[i];
            var disabled = !p.home ? ' disabled' : '';
            html += '<div class="crawler-site-card' + disabled + '" data-preset-id="' + p.id + '">' +
                '<div class="crawler-site-card-icon">' + (p.icon || '\uD83D\uDCDA') + '</div>' +
                '<div class="crawler-site-card-name">' + VP.escapeHtml(p.name) + '</div>' +
                '<div class="crawler-site-card-url">' + VP.escapeHtml(p.baseUrl ? p.baseUrl.replace(/^https?:\/\//, '') : '') + '</div>' +
                (disabled ? '<div class="crawler-site-card-badge">B\u1ECB ch\u1EB7n</div>' : '') +
            '</div>';
        }
        els.siteGrid.innerHTML = html;
    }

    function renderSavedNovels() {
        dbGetAll('novels').then(function (novels) {
            if (!novels.length) {
                els.novelsList.innerHTML = '';
                els.novelsEmpty.classList.remove('hidden');
                return;
            }
            els.novelsEmpty.classList.add('hidden');
            novels.sort(function (a, b) { return (b.dateAdded || 0) - (a.dateAdded || 0); });

            var html = '';
            for (var i = 0; i < novels.length; i++) {
                var n = novels[i];
                var totalCh = n.chapters ? n.chapters.length : 0;
                html += '<div class="crawler-novel-card">' +
                    '<div class="crawler-novel-info">' +
                        '<div class="crawler-novel-name">' + VP.escapeHtml(n.title) + '</div>' +
                        '<div class="crawler-novel-meta">' + n.savedCount + '/' + totalCh + ' ch\u01B0\u01A1ng \u0111\u00E3 l\u01B0u</div>' +
                    '</div>' +
                    '<div class="crawler-novel-actions">' +
                        '<button class="btn btn-accent crawler-novel-open" data-id="' + n.id + '">M\u1EDF</button>' +
                        '<button class="btn btn-default crawler-novel-export" data-id="' + n.id + '">Xu\u1EA5t</button>' +
                        '<button class="btn btn-red crawler-novel-delete" data-id="' + n.id + '">X\u00F3a</button>' +
                    '</div>' +
                '</div>';
            }
            els.novelsList.innerHTML = html;
        });
    }

    // ===== Site Home =====

    function openSiteHome(preset) {
        state.activePreset = preset;
        state.siteConfig = preset;
        pushView('siteHome');
        els.siteHomeName.textContent = preset.icon + ' ' + preset.name;

        // Render categories
        renderCategoryGrid(preset.home.categories);

        // Render ranking tabs and load first
        renderRankingTabs(preset.home.rankings);

        // Load featured novels
        loadFeaturedNovels();
    }

    function renderCategoryGrid(categories) {
        var html = '';
        for (var i = 0; i < categories.length; i++) {
            var c = categories[i];
            var fullUrl = state.activePreset.baseUrl + c.url;
            html += '<button class="crawler-cat-pill" data-url="' + VP.escapeHtml(fullUrl) + '" data-zh="' +
                VP.escapeHtml(c.name) + '">' + VP.escapeHtml(c.name) + '</button>';
        }
        els.catGrid.innerHTML = html;

        // Translate category names asynchronously
        ensureDict().then(function () {
            var pills = els.catGrid.querySelectorAll('.crawler-cat-pill[data-zh]');
            for (var i = 0; i < pills.length; i++) {
                pills[i].textContent = DictEngine.translate(pills[i].dataset.zh);
            }
        }).catch(function () {});
    }

    function renderRankingTabs(rankings) {
        var html = '';
        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            var active = i === 0 ? ' active' : '';
            var fullUrl = state.activePreset.baseUrl + r.url;
            html += '<button class="crawler-rank-tab' + active + '" data-url="' +
                VP.escapeHtml(fullUrl) + '">' + VP.escapeHtml(r.name) + '</button>';
        }
        els.rankTabs.innerHTML = html;

        // Load first ranking
        if (rankings.length > 0) {
            loadRankingNovels(state.activePreset.baseUrl + rankings[0].url);
        }
    }

    function loadRankingNovels(url) {
        els.rankContent.innerHTML = '';
        els.rankLoading.classList.remove('hidden');

        fetchPage(url).then(function (html) {
            var result = parseNovelListPage(html, url, state.activePreset);
            renderNovelCards(els.rankContent, result.novels);
            translateNovelMeta(els.rankContent);
            els.rankLoading.classList.add('hidden');
        }).catch(function (err) {
            els.rankContent.innerHTML = '<p style="color:#ff6b6b">L\u1ED7i: ' + VP.escapeHtml(err.message) + '</p>';
            els.rankLoading.classList.add('hidden');
        });
    }

    function loadFeaturedNovels() {
        els.featured.innerHTML = '';
        els.featuredLoading.classList.remove('hidden');

        fetchPage(state.activePreset.baseUrl).then(function (html) {
            var novels = parseFeaturedNovels(html, state.activePreset.baseUrl, state.activePreset);
            if (novels.length > 0) {
                renderNovelCards(els.featured, novels);
                translateNovelMeta(els.featured);
            } else {
                els.featured.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Kh\u00F4ng t\u00ECm th\u1EA5y truy\u1EC7n n\u1ED5i b\u1EADt</p>';
            }
            els.featuredLoading.classList.add('hidden');
        }).catch(function (err) {
            els.featured.innerHTML = '<p style="color:#ff6b6b">L\u1ED7i: ' + VP.escapeHtml(err.message) + '</p>';
            els.featuredLoading.classList.add('hidden');
        });
    }

    // ===== Novel List View =====

    function openNovelList(url, title) {
        pushView('list');
        els.listTitle.textContent = title || 'Danh s\u00E1ch';
        els.listContent.innerHTML = '';
        els.listPagination.innerHTML = '';
        loadNovelList(url);
    }

    function loadNovelList(url) {
        els.listContent.innerHTML = '';
        els.listPagination.innerHTML = '';
        els.listLoading.classList.remove('hidden');

        fetchPage(url).then(function (html) {
            var result = parseNovelListPage(html, url, state.activePreset);
            renderNovelCards(els.listContent, result.novels);
            renderPagination(result.pagination);
            translateNovelMeta(els.listContent);
            els.listLoading.classList.add('hidden');
        }).catch(function (err) {
            els.listContent.innerHTML = '<p style="color:#ff6b6b">L\u1ED7i: ' + VP.escapeHtml(err.message) + '</p>';
            els.listLoading.classList.add('hidden');
        });
    }

    // ===== Novel List Parsing =====

    function parseNovelListPage(html, baseUrl, preset) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var base = doc.createElement('base');
        base.href = baseUrl;
        doc.head.prepend(base);

        var novels = [];
        var containers = doc.querySelectorAll(preset.home.novelList.container);
        for (var i = 0; i < containers.length; i++) {
            var el = containers[i];
            var titleEl = el.querySelector(preset.home.novelList.title);
            var authorEl = el.querySelector(preset.home.novelList.author);
            var descEl = el.querySelector(preset.home.novelList.description);
            var linkEl = el.querySelector(preset.home.novelList.link);

            if (!titleEl || !linkEl) continue;
            var href = linkEl.getAttribute('href');
            if (!href) continue;

            try {
                novels.push({
                    title: titleEl.textContent.trim(),
                    author: authorEl ? authorEl.textContent.trim() : '',
                    description: descEl ? descEl.textContent.trim() : '',
                    url: new URL(href, baseUrl).href
                });
            } catch (e) {}
        }

        // Parse pagination
        var pagination = { pages: [], nextUrl: null };
        if (preset.home.pagination) {
            var nextEl = safeQuery(doc, preset.home.pagination.next);
            if (nextEl) {
                var nextHref = nextEl.getAttribute('href');
                if (nextHref) {
                    try { pagination.nextUrl = new URL(nextHref, baseUrl).href; } catch (e) {}
                }
            }
            var pageEls = safeQueryAll(doc, preset.home.pagination.pages);
            for (var j = 0; j < pageEls.length; j++) {
                var pe = pageEls[j];
                var pageHref = pe.getAttribute('href');
                var pageText = pe.textContent.trim();
                var pageNum = parseInt(pageText);
                if (pageHref && !isNaN(pageNum)) {
                    try {
                        pagination.pages.push({
                            num: pageNum,
                            url: new URL(pageHref, baseUrl).href,
                            active: pe.classList.contains('current') || (pe.parentElement && pe.parentElement.classList.contains('current'))
                        });
                    } catch (e) {}
                }
            }
        }

        return { novels: novels, pagination: pagination };
    }

    function parseFeaturedNovels(html, baseUrl, preset) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var base = doc.createElement('base');
        base.href = baseUrl;
        doc.head.prepend(base);

        var novels = [];
        var containers = doc.querySelectorAll(preset.home.featured.container);
        for (var i = 0; i < containers.length; i++) {
            var el = containers[i];
            var titleEl = el.querySelector(preset.home.featured.title);
            var authorEl = el.querySelector(preset.home.featured.author);
            var descEl = el.querySelector(preset.home.featured.description);
            var linkEl = el.querySelector(preset.home.featured.link);

            if (!titleEl || !linkEl) continue;
            var href = linkEl.getAttribute('href');
            if (!href) continue;

            try {
                novels.push({
                    title: titleEl.textContent.trim(),
                    author: authorEl ? authorEl.textContent.trim() : '',
                    description: descEl ? descEl.textContent.trim() : '',
                    url: new URL(href, baseUrl).href
                });
            } catch (e) {}
        }

        return novels;
    }

    // ===== Novel Card Rendering =====

    function renderNovelCards(container, novels) {
        var html = '';
        for (var i = 0; i < novels.length; i++) {
            var n = novels[i];
            html += '<div class="crawler-browse-card" data-url="' + VP.escapeHtml(n.url) + '">' +
                '<div class="crawler-browse-card-title" data-zh="' + VP.escapeHtml(n.title) + '">' +
                    VP.escapeHtml(n.title) +
                '</div>' +
                (n.author ? '<div class="crawler-browse-card-author" data-zh="' + VP.escapeHtml(n.author) + '">' + VP.escapeHtml(n.author) + '</div>' : '') +
                (n.description ? '<div class="crawler-browse-card-desc" data-zh="' + VP.escapeHtml(n.description) + '">' +
                    VP.escapeHtml(n.description) + '</div>' : '') +
            '</div>';
        }
        container.innerHTML = html;
    }

    function renderPagination(pagination) {
        if (!pagination || (!pagination.pages.length && !pagination.nextUrl)) {
            els.listPagination.innerHTML = '';
            return;
        }

        var html = '';
        for (var i = 0; i < pagination.pages.length; i++) {
            var p = pagination.pages[i];
            var active = p.active ? ' active' : '';
            html += '<button class="crawler-page-btn' + active + '" data-url="' +
                VP.escapeHtml(p.url) + '">' + p.num + '</button>';
        }
        if (pagination.nextUrl) {
            html += '<button class="crawler-page-btn crawler-page-next" data-url="' +
                VP.escapeHtml(pagination.nextUrl) + '">Ti\u1EBFp &rarr;</button>';
        }
        els.listPagination.innerHTML = html;
    }

    // ===== Translate Novel Meta =====

    function translateNovelMeta(containerEl) {
        ensureDict().then(function () {
            var titles = containerEl.querySelectorAll('.crawler-browse-card-title[data-zh]');
            for (var i = 0; i < titles.length; i++) {
                var zh = titles[i].dataset.zh;
                if (zh) titles[i].textContent = DictEngine.translate(zh);
            }
            var authors = containerEl.querySelectorAll('.crawler-browse-card-author[data-zh]');
            for (var k = 0; k < authors.length; k++) {
                var zh3 = authors[k].dataset.zh;
                if (zh3) authors[k].textContent = DictEngine.translate(zh3);
            }
            var descs = containerEl.querySelectorAll('.crawler-browse-card-desc[data-zh]');
            for (var j = 0; j < descs.length; j++) {
                var zh2 = descs[j].dataset.zh;
                if (zh2) descs[j].textContent = DictEngine.translate(zh2);
            }
        }).catch(function () {});
    }

    // ===== Open Novel from Browse Card =====

    function openNovelFromCard(url) {
        if (state.activePreset) {
            state.siteConfig = state.activePreset;
            els.siteSelect.value = state.activePreset.id;
        }
        pushView('browse');
        state.history = [];
        state.historyIndex = -1;
        state.novelProject = null;
        els.urlInput.value = '';
        els.content.innerHTML = '';
        els.chapterList.innerHTML = '';
        els.sidebar.classList.add('hidden');
        navigateTo(url);
    }

    // ===== Navigation =====

    function navigateTo(url) {
        if (state.loading) return;
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

        // Push to browse history
        if (state.currentUrl && state.currentUrl !== url) {
            state.history = state.history.slice(0, state.historyIndex + 1);
            state.history.push(state.currentUrl);
            state.historyIndex = state.history.length - 1;
        }

        state.currentUrl = url;
        state.loading = true;
        showView('browse');
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

            els.content.innerHTML = '<p style="color:var(--text-muted)">Kh\u00F4ng nh\u1EADn di\u1EC7n \u0111\u01B0\u1EE3c n\u1ED9i dung. Th\u1EED ch\u1ECDn \u0111\u00FAng site preset.</p>';
            state.loading = false;
            setLoading(false);
        }).catch(function (err) {
            els.content.innerHTML = '<p style="color:#ff6b6b">L\u1ED7i: ' + VP.escapeHtml(err.message) + '</p>';
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
            popView();
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

            els.content.innerHTML = '<p style="color:var(--text-muted)">Kh\u00F4ng nh\u1EADn di\u1EC7n \u0111\u01B0\u1EE3c n\u1ED9i dung.</p>';
            state.loading = false;
            setLoading(false);
        }).catch(function (err) {
            els.content.innerHTML = '<p style="color:#ff6b6b">L\u1ED7i: ' + VP.escapeHtml(err.message) + '</p>';
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

    // ===== Browse View Rendering =====

    function renderIndexPage(parsed) {
        var html = '<div class="crawler-index-title" data-zh="' + VP.escapeHtml(parsed.title) + '">' +
            VP.escapeHtml(parsed.title) + '</div>';
        if (parsed.author) {
            html += '<div class="crawler-index-author" data-zh="' + VP.escapeHtml(parsed.author) + '">' +
                VP.escapeHtml(parsed.author) + '</div>';
        }
        html += '<div class="crawler-index-info">' + parsed.chapterLinks.length + ' ch\u01B0\u01A1ng</div>';
        if (parsed.description) {
            html += '<div class="crawler-index-desc" data-zh="' + VP.escapeHtml(parsed.description) + '">' +
                VP.escapeHtml(parsed.description) + '</div>';
        }
        html += '<div class="crawler-index-list">';
        for (var i = 0; i < parsed.chapterLinks.length; i++) {
            html += '<a class="crawler-index-link" href="javascript:void(0)" data-url="' +
                VP.escapeHtml(parsed.chapterLinks[i].url) + '" data-zh="' +
                VP.escapeHtml(parsed.chapterLinks[i].title) + '">' +
                VP.escapeHtml(parsed.chapterLinks[i].title) + '</a>';
        }
        html += '</div>';

        if (!state.novelProject) {
            html += '<div style="margin-top:16px;text-align:center">' +
                '<button class="btn btn-accent" id="crawlerSaveNovel">L\u01B0u truy\u1EC7n n\u00E0y</button></div>';
        }

        els.content.innerHTML = html;
        updateNavButtons();

        var links = els.content.querySelectorAll('.crawler-index-link');
        for (var j = 0; j < links.length; j++) {
            links[j].addEventListener('click', function (e) {
                e.preventDefault();
                navigateTo(this.dataset.url);
            });
        }

        var saveBtn = els.content.querySelector('#crawlerSaveNovel');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                saveAsNovel(parsed);
            });
        }

        populateSidebar(parsed.chapterLinks);

        // Async translate title, author, description, and chapter names
        translateIndexPage();
    }

    function translateIndexPage() {
        ensureDict().then(function () {
            var titleEl = els.content.querySelector('.crawler-index-title[data-zh]');
            if (titleEl) titleEl.textContent = DictEngine.translate(titleEl.dataset.zh);

            var authorEl = els.content.querySelector('.crawler-index-author[data-zh]');
            if (authorEl) authorEl.textContent = DictEngine.translate(authorEl.dataset.zh);

            var descEl = els.content.querySelector('.crawler-index-desc[data-zh]');
            if (descEl) descEl.textContent = DictEngine.translate(descEl.dataset.zh);

            var links = els.content.querySelectorAll('.crawler-index-link[data-zh]');
            for (var i = 0; i < links.length; i++) {
                links[i].textContent = DictEngine.translate(links[i].dataset.zh);
            }
        }).catch(function () {});
    }

    function renderChapterPage(parsed, viContent) {
        var zhLines = (state.zhContent || '').split('\n');
        var viLines = viContent.split('\n');
        var html = '';

        if (parsed.title) {
            var chTitle = parsed.title;
            if (typeof DictEngine !== 'undefined' && DictEngine.isReady) {
                chTitle = DictEngine.translate(parsed.title);
            }
            html += '<div class="crawler-chapter-title" data-zh="' + VP.escapeHtml(parsed.title) + '">' + VP.escapeHtml(chTitle) + '</div>';
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

        html += '<div style="text-align:center;margin-top:24px">' +
            '<button class="btn btn-default" id="crawlerEditBtn">Ch\u1EC9nh s\u1EEDa b\u1EA3n d\u1ECBch</button></div>';

        els.content.innerHTML = html;
        els.content.scrollTop = 0;
        updateNavButtons();
        updateSidebarActive();

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
            var saved = savedSet[ch.url] ? ' \u2713' : '';
            var activeClass = (state.currentUrl === ch.url) ? ' active' : '';
            html += '<div class="crawler-ch-item' + activeClass + '" data-url="' +
                VP.escapeHtml(ch.url) + '" data-index="' + j + '">' +
                '<span class="crawler-ch-name" data-zh="' + VP.escapeHtml(ch.title) + '">' +
                VP.escapeHtml(ch.title) + '</span>' +
                '<span class="crawler-ch-saved">' + saved + '</span></div>';
        }
        els.chapterList.innerHTML = html;

        if (window.innerWidth > 700) {
            els.sidebar.classList.remove('hidden');
        }

        // Async translate sidebar chapter titles
        ensureDict().then(function () {
            var names = els.chapterList.querySelectorAll('.crawler-ch-name[data-zh]');
            for (var k = 0; k < names.length; k++) {
                names[k].textContent = DictEngine.translate(names[k].dataset.zh);
            }
        }).catch(function () {});
    }

    function updateSidebarActive() {
        var items = els.chapterList.querySelectorAll('.crawler-ch-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('active', items[i].dataset.url === state.currentUrl);
        }
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
            var saveBtn = els.content.querySelector('#crawlerSaveNovel');
            if (saveBtn) {
                saveBtn.textContent = '\u0110\u00E3 l\u01B0u!';
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
            alert('H\u00E3y m\u1EDF trang m\u1EE5c l\u1EE5c tr\u01B0\u1EDBc v\u00E0 nh\u1EA5n "L\u01B0u truy\u1EC7n n\u00E0y"');
            return;
        }

        var chapterIndex = -1;
        for (var i = 0; i < novel.chapters.length; i++) {
            if (novel.chapters[i].url === state.currentUrl) {
                chapterIndex = i;
                break;
            }
        }
        if (chapterIndex === -1) {
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
        els.saveBtn.textContent = '\u0110ang l\u01B0u...';

        dbPut('chapter-content', chapterData).then(function () {
            novel.chapters[chapterIndex].saved = true;
            novel.savedCount = novel.chapters.filter(function (c) { return c.saved; }).length;
            return dbPut('novels', novel);
        }).then(function () {
            els.saveBtn.textContent = '\u0110\u00E3 l\u01B0u \u2713';
            els.saveBtn.classList.remove('btn-green');
            els.saveBtn.classList.add('btn-default');
            setTimeout(function () {
                els.saveBtn.textContent = 'L\u01B0u ch\u01B0\u01A1ng';
                els.saveBtn.classList.remove('btn-default');
                els.saveBtn.classList.add('btn-green');
                els.saveBtn.disabled = false;
            }, 2000);
            updateSidebarSaved();
        }).catch(function (err) {
            els.saveBtn.textContent = 'L\u1ED7i!';
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
                savedSpan.textContent = ' \u2713';
            }
        }
    }

    function openNovel(novelId) {
        dbGet('novels', novelId).then(function (novel) {
            if (!novel) return;
            state.novelProject = novel;
            if (novel.siteConfig) {
                state.siteConfig = novel.siteConfig;
            } else {
                var preset = SITE_PRESETS.find(function (p) { return p.id === novel.siteId; });
                if (preset) state.siteConfig = preset;
            }
            if (state.siteConfig) {
                els.siteSelect.value = state.siteConfig.id || 'auto';
            }
            showView('browse');
            els.urlInput.value = novel.sourceUrl || '';
            populateSidebar(novel.chapters);
            els.content.innerHTML =
                '<div class="crawler-index-title">' + VP.escapeHtml(novel.title) + '</div>' +
                '<div class="crawler-index-info">' + novel.savedCount + '/' + novel.chapters.length + ' ch\u01B0\u01A1ng \u0111\u00E3 l\u01B0u</div>' +
                '<p style="color:var(--text-secondary);margin-top:12px">Ch\u1ECDn m\u1ED9t ch\u01B0\u01A1ng t\u1EEB m\u1EE5c l\u1EE5c \u0111\u1EC3 \u0111\u1ECDc.</p>';
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
            renderSavedNovels();
        });
    }

    // ===== Export to Library =====

    function exportToLibrary(novelId) {
        dbGet('novels', novelId).then(function (novel) {
            if (!novel) return;
            return getNovelChapters(novelId).then(function (chapters) {
                if (!chapters.length) {
                    alert('Ch\u01B0a l\u01B0u ch\u01B0\u01A1ng n\u00E0o \u0111\u1EC3 xu\u1EA5t!');
                    return;
                }
                chapters.sort(function (a, b) { return a.chapterIndex - b.chapterIndex; });
                var fullText = '';
                for (var i = 0; i < chapters.length; i++) {
                    var ch = chapters[i];
                    var chMeta = novel.chapters[ch.chapterIndex];
                    var title = chMeta ? chMeta.title : ('Ch\u01B0\u01A1ng ' + (ch.chapterIndex + 1));
                    var content = ch.viEdited || ch.viContent || '';
                    fullText += title + '\n\n' + content + '\n\n';
                }
                return ReaderLib.importBook(novel.title, fullText.trim(), 'txt').then(function (result) {
                    novel.exportedBookId = result.id;
                    return dbPut('novels', novel);
                }).then(function () {
                    alert('\u0110\u00E3 xu\u1EA5t "' + novel.title + '" v\u00E0o Th\u01B0 vi\u1EC7n! (' + chapters.length + ' ch\u01B0\u01A1ng)');
                });
            });
        }).catch(function (err) {
            alert('L\u1ED7i xu\u1EA5t: ' + err.message);
        });
    }

    // ===== Edit Modal =====

    var editingChapterIndex = -1;

    function openEditModal(zh, vi) {
        els.editZh.value = zh || '';
        els.editVi.value = vi || '';
        els.editModal.classList.remove('hidden');

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
        if (state.parsedPage) {
            renderChapterPage(state.parsedPage, newVi);
        }
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
        detectSite: detectSite,
        openSiteHome: openSiteHome,
        openNovelList: openNovelList
    };
})();
