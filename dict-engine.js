// ===== Trie-based Offline Dictionary Engine (Webapp) =====
// Uses IndexedDB for imported dict persistence (no size limit)
// Uses localStorage for custom phrases only (small)
(function () {
    function isCJK(ch) {
        var code = ch.charCodeAt(0);
        return (code >= 0x4e00 && code <= 0x9fff) ||
            (code >= 0x3400 && code <= 0x4dbf) ||
            (code >= 0xf900 && code <= 0xfaff);
    }

    var root = null;
    var ready = false;
    var phienamMap = new Map();
    var customEntries = new Map();
    var cachedTSV = '';
    var baseTSV = '';
    var entryCount = 0;
    var loadedUrl = 'dict-default.json';
    var DB_NAME = 'cnvn-dict';
    var DB_VERSION = 1;

    function createNode() { return { c: Object.create(null), v: null, p: 0 }; }

    function buildTrie(entries) {
        var r = createNode();
        for (var i = 0; i < entries.length; i++) {
            var zh = entries[i][0], vi = entries[i][1], pri = entries[i][2] | 0;
            var node = r;
            for (var j = 0; j < zh.length; j++) {
                if (!node.c[zh[j]]) node.c[zh[j]] = createNode();
                node = node.c[zh[j]];
            }
            if (pri >= node.p) { node.v = vi; node.p = pri; }
        }
        return r;
    }

    function parseTSV(tsv) {
        var entries = [];
        var start = 0;
        while (start < tsv.length) {
            var nl = tsv.indexOf('\n', start);
            if (nl === -1) break;
            var line = tsv.substring(start, nl);
            start = nl + 1;
            var t1 = line.indexOf('\t');
            if (t1 === -1) continue;
            var t2 = line.indexOf('\t', t1 + 1);
            if (t2 === -1) continue;
            entries.push([line.substring(0, t1), line.substring(t1 + 1, t2), parseInt(line.substring(t2 + 1), 10)]);
        }
        return entries;
    }

    // Extract clean Vietnamese meaning from raw dict value
    // Handles both standard format (value/alt) and extended format:
    //   ✚[pinyin] Hán Việt: XXX\n\t1. meaning1; meaning2\n\t2. ...\n✚[pinyin2] ...
    function extractMeaning(raw) {
        // Extended format: contains ✚[ (U+271A) or +[ prefix
        if (raw.indexOf('\u271A[') !== -1 || raw.indexOf('+[') !== -1) {
            // Try first numbered meaning \t1. across all readings
            var t1 = raw.indexOf('\\t1.');
            if (t1 !== -1) {
                var meat = raw.substring(t1 + 4).trim();
                // Cut at next \n\t or \n or //
                var end = meat.search(/\\n|\/\//);
                if (end !== -1) meat = meat.substring(0, end);
                // Take first meaning before ;
                var semi = meat.indexOf(';');
                if (semi !== -1) meat = meat.substring(0, semi);
                // Strip parenthetical notes for cleaner output
                meat = meat.replace(/\s*\(.*?\)\s*/g, ' ').trim();
                if (meat) return meat;
            }
            // Fallback: extract Hán Việt reading
            var hv = raw.indexOf('Hán Việt:');
            if (hv !== -1) {
                var hvVal = raw.substring(hv + 9).trim();
                var hvEnd = hvVal.search(/\\[nt]|\/\//);
                if (hvEnd !== -1) hvVal = hvVal.substring(0, hvEnd);
                hvVal = hvVal.split(/[;；]/)[0].trim();
                if (hvVal) return hvVal;
            }
            // Fallback: strip ✚[...] / +[...] prefix, take direct meaning
            var stripped = raw.replace(/[\u271A+]\s*\[[^\]]*\]\s*/g, '');
            // Remove "Hán Việt: XXX " prefix if present
            stripped = stripped.replace(/Hán Việt:\s*\S+\s*/g, '').trim();
            // Clean literal escape sequences
            stripped = stripped.replace(/\\[nt]/g, ' ').trim();
            if (stripped) {
                var semi2 = stripped.indexOf(';');
                if (semi2 !== -1) stripped = stripped.substring(0, semi2).trim();
                stripped = stripped.replace(/\s*\(.*?\)\s*/g, ' ').trim();
                if (stripped) return stripped;
            }
        }
        // Standard format: split by // first, then / for alternatives
        var dslash = raw.indexOf('//');
        var first = dslash !== -1 ? raw.substring(0, dslash).trim() : raw;
        var slash = first.indexOf('/');
        return slash !== -1 ? first.substring(0, slash).trim() : first;
    }

    function parseDictText(text, priority) {
        var entries = [];
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line[0] === '#' || (line[0] === '/' && line[1] === '/')) continue;
            var eq = line.indexOf('=');
            if (eq < 1) continue;
            var zh = line.substring(0, eq).trim();
            var viRaw = line.substring(eq + 1).trim();
            var vi = extractMeaning(viRaw);
            if (zh) entries.push([zh, vi, priority]);
        }
        return entries;
    }

    // Chinese → Latin punctuation normalization
    var CN_PUNCT_MAP = {
        '，': ',', '。': '.', '？': '?', '！': '!', '；': ';', '：': ':',
        '「': '\u201C', '」': '\u201D', '『': '\u2018', '』': '\u2019',
        '《': '\u00AB', '》': '\u00BB', '（': '(', '）': ')',
        '【': '[', '】': ']', '〈': '<', '〉': '>',
        '、': ',', '～': '~'
    };
    var CN_PUNCT_RE = /[，。？！；：「」『』《》（）【】〈〉、～]/g;

    function normalizePunctuation(str) {
        // Double patterns first: …… → ... and —— → —
        str = str.replace(/……/g, '...').replace(/——/g, '\u2014');
        // Single ellipsis
        str = str.replace(/…/g, '...');
        // Single char replacements
        return str.replace(CN_PUNCT_RE, function (ch) { return CN_PUNCT_MAP[ch] || ch; });
    }

    // Normalize line breaks: trim whitespace around \n, collapse 3+ blank lines to 2
    function cleanLineBreaks(str) {
        str = str.replace(/\r\n/g, '\n');          // Windows → Unix
        str = str.replace(/[ \t]*\n[ \t]*/g, '\n'); // trim spaces around \n
        str = str.replace(/\n{3,}/g, '\n\n');       // collapse 3+ newlines → 2
        return str;
    }

    // Capitalize first letter of each sentence (after .!? or newline)
    function capitalizeSentences(str) {
        return str.replace(/(^|[.!?\n]\s*)([a-zàáạảãăắằặẳẵâấầậẩẫđèéẹẻẽêếềệểễìíịỉĩòóọỏõôốồộổỗơớờợởỡùúụủũưứừựửữỳýỵỷỹ])/gu, function (m, pre, ch) {
            return pre + ch.toUpperCase();
        });
    }

    function segmentAndTranslate(text) {
        if (!root) return text;
        var result = [];
        var i = 0;
        while (i < text.length) {
            if (!isCJK(text[i])) {
                var s = i;
                while (i < text.length && !isCJK(text[i])) i++;
                result.push(text.substring(s, i));
                continue;
            }
            var node = root, lastMatch = -1, lastValue = null, j = i;
            while (j < text.length && node.c[text[j]]) {
                node = node.c[text[j]]; j++;
                if (node.v !== null) { lastMatch = j; lastValue = node.v; }
            }
            if (lastMatch > i) { result.push(lastValue); i = lastMatch; }
            else { result.push(text[i]); i++; }
        }
        var out = result.join(' ').replace(/ {2,}/g, ' ');
        out = normalizePunctuation(out);
        out = out.replace(/ ([.,!?;:\)\]\u00BB\u201D\u2019>])/g, '$1');  // space before closing punct
        out = out.replace(/([\(\[\u00AB\u201C\u2018<]) /g, '$1');  // space after opening punct
        out = cleanLineBreaks(out);
        out = out.replace(/ {2,}/g, ' ').trim();
        return capitalizeSentences(out);
    }

    function applyCustomEntries() {
        if (!root) return;
        for (var entry of customEntries) {
            var zh = entry[0], vi = entry[1], node = root;
            for (var j = 0; j < zh.length; j++) {
                if (!node.c[zh[j]]) node.c[zh[j]] = createNode();
                node = node.c[zh[j]];
            }
            node.v = vi; node.p = 999;
        }
    }

    // Common CJK chars with empty values in base dict — patch with correct Hán Việt
    var HANVIET_PATCH = { '\u7684': 'đích', '\u4E86': 'liễu', '\u65F3': 'đích' };

    function buildFromTSV(tsv) {
        cachedTSV = tsv;
        var entries = parseTSV(tsv);
        if (entries.length === 0) return false;
        root = buildTrie(entries);
        entryCount = entries.length;
        phienamMap.clear();
        for (var i = 0; i < entries.length; i++) {
            if (entries[i][0].length === 1 && (entries[i][2] | 0) <= 1 && entries[i][1])
                phienamMap.set(entries[i][0], entries[i][1]);
        }
        // Patch known missing Hán Việt readings
        for (var ch in HANVIET_PATCH) {
            if (!phienamMap.has(ch)) phienamMap.set(ch, HANVIET_PATCH[ch]);
        }
        applyCustomEntries();
        ready = true;
        console.log('DictEngine: loaded', entries.length, 'entries,', phienamMap.size, 'phienam,', customEntries.size, 'custom');
        return true;
    }

    // ===== IndexedDB for imported dicts =====
    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('imports')) {
                    db.createObjectStore('imports', { keyPath: 'name' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    // Save an imported file's TSV to IDB
    function saveImport(name, tsv, count) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('imports', 'readwrite');
                tx.objectStore('imports').put({ name: name, tsv: tsv, count: count, date: Date.now() });
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // Get all imported files' TSV concatenated
    function loadAllImports() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('imports', 'readonly');
                var req = tx.objectStore('imports').getAll();
                req.onsuccess = function () { db.close(); resolve(req.result || []); };
                req.onerror = function () { db.close(); resolve([]); };
            });
        });
    }

    // Delete a single import source
    function deleteImport(name) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('imports', 'readwrite');
                tx.objectStore('imports').delete(name);
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // Delete all imports
    function clearAllImportsDB() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('imports', 'readwrite');
                tx.objectStore('imports').clear();
                tx.oncomplete = function () { db.close(); resolve(); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        });
    }

    // ===== Public API =====

    function loadDictionary(url) {
        var dictUrl = url || loadedUrl;
        loadedUrl = dictUrl;
        // Load custom entries from localStorage
        try {
            var stored = localStorage.getItem('customDict');
            if (stored) customEntries = new Map(Object.entries(JSON.parse(stored)));
        } catch (e) { /* ignore */ }

        return fetch(dictUrl).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        }).then(function (data) {
            if (!data.phienam) throw new Error('No phienam data');
            var keys = Object.keys(data.phienam);
            var parts = new Array(keys.length);
            for (var i = 0; i < keys.length; i++) {
                parts[i] = keys[i] + '\t' + data.phienam[keys[i]] + '\t0';
            }
            baseTSV = parts.join('\n') + '\n';
            // Load persisted imports from IndexedDB
            return loadAllImports().then(function (imports) {
                var fullTSV = baseTSV;
                for (var i = 0; i < imports.length; i++) {
                    fullTSV += imports[i].tsv;
                }
                return buildFromTSV(fullTSV);
            }).catch(function () {
                // IDB failed, use base only
                return buildFromTSV(baseTSV);
            });
        });
    }

    // Import .txt content, persist to IDB under sourceName
    function importDictText(text, priority, sourceName) {
        var newEntries = parseDictText(text, priority || 10);
        if (newEntries.length === 0) return Promise.resolve(0);
        var extraParts = [];
        for (var i = 0; i < newEntries.length; i++) {
            extraParts.push(newEntries[i][0] + '\t' + newEntries[i][1] + '\t' + newEntries[i][2]);
        }
        var extraTSV = extraParts.join('\n') + '\n';
        buildFromTSV(cachedTSV + extraTSV);
        // Persist to IDB
        var name = sourceName || ('import_' + Date.now());
        return saveImport(name, extraTSV, newEntries.length).then(function () {
            return newEntries.length;
        }).catch(function (e) {
            console.warn('DictEngine: IDB save failed:', e);
            return newEntries.length;
        });
    }

    // Get list of imported sources [{name, count, date}]
    function getImportedSources() {
        return loadAllImports().then(function (imports) {
            return imports.map(function (imp) {
                return { name: imp.name, count: imp.count, date: imp.date };
            });
        }).catch(function () { return []; });
    }

    // Remove one imported source, rebuild trie
    function removeImportedSource(name) {
        return deleteImport(name).then(function () {
            return rebuildFromDB();
        });
    }

    // Clear all imported, rebuild trie
    function clearAllImported() {
        return clearAllImportsDB().then(function () {
            buildFromTSV(baseTSV);
        });
    }

    // Rebuild trie from baseTSV + all IDB imports
    function rebuildFromDB() {
        return loadAllImports().then(function (imports) {
            var fullTSV = baseTSV;
            for (var i = 0; i < imports.length; i++) fullTSV += imports[i].tsv;
            buildFromTSV(fullTSV);
        }).catch(function () {
            buildFromTSV(baseTSV);
        });
    }

    function segment(text) {
        if (!root) return [];
        var segments = [];
        var i = 0;
        while (i < text.length) {
            if (!isCJK(text[i])) { i++; continue; }
            var node = root, lastMatch = -1, lastValue = null, j = i;
            while (j < text.length && node.c[text[j]]) {
                node = node.c[text[j]]; j++;
                if (node.v !== null) { lastMatch = j; lastValue = node.v; }
            }
            if (lastMatch > i) {
                segments.push({ zh: text.substring(i, lastMatch), vi: lastValue });
                i = lastMatch;
            } else { segments.push({ zh: text[i], vi: '' }); i++; }
        }
        return segments;
    }

    function hanviet(text) {
        var result = [];
        var i = 0;
        while (i < text.length) {
            if (isCJK(text[i])) {
                result.push(phienamMap.get(text[i]) || text[i]);
                i++;
            } else {
                // Collect non-CJK run (punctuation, spaces, newlines, etc.)
                var s = i;
                while (i < text.length && !isCJK(text[i])) i++;
                result.push(text.substring(s, i));
            }
        }
        var out = result.join(' ').replace(/ {2,}/g, ' ');
        out = normalizePunctuation(out);
        out = out.replace(/ ([.,!?;:\)\]\u00BB\u201D\u2019>])/g, '$1');
        out = out.replace(/([\(\[\u00AB\u201C\u2018<]) /g, '$1');
        out = cleanLineBreaks(out);
        out = out.replace(/ {2,}/g, ' ').trim();
        return capitalizeSentences(out);
    }

    function addCustom(zh, vi) {
        customEntries.set(zh, vi);
        if (root) {
            var node = root;
            for (var j = 0; j < zh.length; j++) {
                if (!node.c[zh[j]]) node.c[zh[j]] = createNode();
                node = node.c[zh[j]];
            }
            node.v = vi; node.p = 999;
        }
        try { localStorage.setItem('customDict', JSON.stringify(Object.fromEntries(customEntries))); } catch (e) {}
    }

    function removeCustom(zh) {
        if (!customEntries.has(zh)) return;
        customEntries.delete(zh);
        if (cachedTSV) {
            var entries = parseTSV(cachedTSV);
            root = buildTrie(entries);
            phienamMap.clear();
            for (var e of entries) { if (e[0].length === 1 && (e[2] | 0) <= 1) phienamMap.set(e[0], e[1]); }
            applyCustomEntries();
        }
        try { localStorage.setItem('customDict', JSON.stringify(Object.fromEntries(customEntries))); } catch (e) {}
    }

    function getCustomEntries() { return Object.fromEntries(customEntries); }

    function clearCustom() {
        customEntries.clear();
        if (cachedTSV) {
            var entries = parseTSV(cachedTSV);
            root = buildTrie(entries);
            phienamMap.clear();
            for (var e of entries) { if (e[0].length === 1 && (e[2] | 0) <= 1) phienamMap.set(e[0], e[1]); }
        }
        try { localStorage.setItem('customDict', '{}'); } catch (e) {}
    }

    function setCustomEntries(obj) {
        customEntries = new Map(Object.entries(obj));
        if (cachedTSV) {
            var entries = parseTSV(cachedTSV);
            root = buildTrie(entries);
            entryCount = entries.length;
            phienamMap.clear();
            for (var e of entries) { if (e[0].length === 1 && (e[2] | 0) <= 1) phienamMap.set(e[0], e[1]); }
            applyCustomEntries();
        }
        try { localStorage.setItem('customDict', JSON.stringify(obj)); } catch (e) {}
    }

    function reload() {
        root = null; ready = false; entryCount = 0;
        phienamMap.clear();
        return loadDictionary();
    }

    // Get all imported sources with full TSV data (for backup)
    function getImportedSourcesFull() {
        return loadAllImports().catch(function () { return []; });
    }

    // Restore imports from backup: bulk put all records, then rebuild
    function restoreImports(arr) {
        if (!arr || !arr.length) return Promise.resolve(0);
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('imports', 'readwrite');
                var store = tx.objectStore('imports');
                var count = 0;
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].name && arr[i].tsv) {
                        store.put(arr[i]);
                        count++;
                    }
                }
                tx.oncomplete = function () { db.close(); resolve(count); };
                tx.onerror = function () { db.close(); reject(tx.error); };
            });
        }).then(function (count) {
            return rebuildFromDB().then(function () { return count; });
        });
    }

    window.DictEngine = {
        loadDictionary: loadDictionary,
        translate: segmentAndTranslate,
        segment: segment,
        hanviet: hanviet,
        importDictText: importDictText,
        parseDictText: parseDictText,
        addCustom: addCustom,
        removeCustom: removeCustom,
        getCustomEntries: getCustomEntries,
        clearCustom: clearCustom,
        setCustomEntries: setCustomEntries,
        getImportedSources: getImportedSources,
        getImportedSourcesFull: getImportedSourcesFull,
        restoreImports: restoreImports,
        removeImportedSource: removeImportedSource,
        clearAllImported: clearAllImported,
        get customCount() { return customEntries.size; },
        get entryCount() { return entryCount; },
        get phienamCount() { return phienamMap.size; },
        get isReady() { return ready; },
        reload: reload
    };
})();
