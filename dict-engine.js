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

    // Traditional → Simplified conversion
    var tradSimpMap = null;
    var chuyenGianThe = localStorage.getItem('vp_chuyen_gian_the') !== '0';

    // ThuatToanNhan: constrain LuatNhan {0} captures
    // 0=off, 1=pronouns only, 2=pronouns+names(pri>=20), 3=pronouns+names+vietphrase(pri>=10)
    var thuatToanNhan = parseInt(localStorage.getItem('vp_thuat_toan_nhan'), 10);
    if (isNaN(thuatToanNhan) || thuatToanNhan < 0 || thuatToanNhan > 3) thuatToanNhan = 2;

    // Built-in pronouns (28 entries from QT's Pronouns.txt)
    var PRONOUNS_RAW = '你自己\t大家伙儿\t同学们\t大伙儿\t老师们\t自个儿\t他人\t他们\t你们\t别人\t同学\t咱们\t她们\t它们\t您们\t我们\t旁人\t老师\t自己\t诸位\t他\t你\t咱\t她\t它\t您\t我\t朕';
    var pronounSet = new Set(PRONOUNS_RAW.split('\t'));

    // LuatNhan pattern matching state
    var patPrefixRoot = null;  // Trie of pattern prefixes → leaf.patterns = [{suffix, template}]
    var patSuffixRoot = null;  // Trie of suffixes for {0}-starting patterns → leaf.templates = [template]
    var hasPatterns = false;

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

    // Load Traditional→Simplified mapping file
    function loadTradSimp() {
        return fetch('dicts/trad-simp.txt').then(function(r) { return r.text(); })
            .then(function(raw) {
                var cleaned = raw.replace(/^\uFEFF/, '').replace(/[\r\n\s]/g, '');
                // Use Array.from for codepoint-aware iteration (handles surrogate pairs)
                var codepoints = Array.from(cleaned);
                if (codepoints.length % 2 !== 0) {
                    console.warn('DictEngine: trad-simp.txt has odd codepoint count, skipping last');
                    codepoints.pop();
                }
                tradSimpMap = new Map();
                for (var i = 0; i < codepoints.length; i += 2)
                    tradSimpMap.set(codepoints[i], codepoints[i + 1]);
                console.log('DictEngine: loaded', tradSimpMap.size, 'trad→simp mappings');
            }).catch(function(e) { console.warn('DictEngine: trad-simp load failed', e); tradSimpMap = null; });
    }

    // Convert Traditional Chinese text to Simplified
    function convertToSimplified(text) {
        if (!tradSimpMap || !chuyenGianThe) return text;
        var out = '';
        // Use for...of for codepoint-aware iteration (handles surrogate pairs)
        for (var ch of text)
            out += tradSimpMap.get(ch) || ch;
        return out;
    }

    // Check if {0} capture is allowed by ThuatToanNhan mode
    function isCaptureAllowed(capText, matchPri) {
        if (thuatToanNhan === 0) return false;
        if (pronounSet.has(capText)) return true;
        if (thuatToanNhan >= 2 && matchPri >= 20) return true;
        if (thuatToanNhan >= 3 && matchPri >= 10) return true;
        return false;
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
            var vi;
            if (zh.indexOf('{0}') !== -1) {
                vi = viRaw.replace(/\s*\*$/, '');  // strip trailing *
            } else {
                vi = extractMeaning(viRaw);
            }
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

    // ===== LuatNhan Pattern Matching =====

    function buildPatterns(patEntries) {
        if (!patEntries || patEntries.length === 0) {
            patPrefixRoot = null;
            patSuffixRoot = null;
            hasPatterns = false;
            return;
        }
        patPrefixRoot = { c: Object.create(null) };
        patSuffixRoot = { c: Object.create(null) };
        var prefixCount = 0, suffixCount = 0;
        for (var i = 0; i < patEntries.length; i++) {
            var pe = patEntries[i];
            if (pe.prefix.length > 0) {
                // Insert prefix into patPrefixRoot Trie
                var node = patPrefixRoot;
                for (var j = 0; j < pe.prefix.length; j++) {
                    if (!node.c[pe.prefix[j]]) node.c[pe.prefix[j]] = { c: Object.create(null) };
                    node = node.c[pe.prefix[j]];
                }
                if (!node.patterns) node.patterns = [];
                node.patterns.push({ suffix: pe.suffix, template: pe.template });
                prefixCount++;
            } else {
                // suffix-only: {0}xxx=yyy — insert suffix into patSuffixRoot
                var node2 = patSuffixRoot;
                for (var k = 0; k < pe.suffix.length; k++) {
                    if (!node2.c[pe.suffix[k]]) node2.c[pe.suffix[k]] = { c: Object.create(null) };
                    node2 = node2.c[pe.suffix[k]];
                }
                if (!node2.templates) node2.templates = [];
                node2.templates.push(pe.template);
                suffixCount++;
            }
        }
        hasPatterns = prefixCount > 0 || suffixCount > 0;
        console.log('DictEngine: patterns loaded — prefix:', prefixCount, 'suffix-only:', suffixCount);
    }

    // Trie-only longest match at a position (no pattern recursion)
    function trieMatchAt(pos, text) {
        if (!root) return null;
        var node = root, lastMatch = -1, lastValue = null, lastPri = 0, j = pos;
        while (j < text.length && node.c[text[j]]) {
            node = node.c[text[j]]; j++;
            if (node.v !== null) { lastMatch = j; lastValue = node.v; lastPri = node.p; }
        }
        if (lastMatch > pos) return { end: lastMatch, value: lastValue, pri: lastPri };
        return null;
    }

    // Translate a CJK substring using Trie only (for {0} captures)
    function trieTranslateRun(text, start, end) {
        if (!root || start >= end) return '';
        var parts = [];
        var i = start;
        while (i < end) {
            if (!isCJK(text[i])) {
                var s = i;
                while (i < end && !isCJK(text[i])) i++;
                parts.push(text.substring(s, i));
                continue;
            }
            var m = trieMatchAt(i, text);
            if (m && m.end <= end) {
                parts.push(m.value);
                i = m.end;
            } else {
                parts.push(phienamMap.get(text[i]) || text[i]);
                i++;
            }
        }
        return parts.join(' ').replace(/ {2,}/g, ' ').trim();
    }

    // Try prefix-based pattern match at position
    function tryPrefixPattern(text, pos) {
        if (!patPrefixRoot) return null;
        var node = patPrefixRoot;
        var best = null;
        for (var p = pos; p < text.length; p++) {
            if (!node.c[text[p]]) break;
            node = node.c[text[p]];
            if (!node.patterns) continue;
            var prefixLen = p - pos + 1;
            var captureStart = pos + prefixLen;
            // Try each pattern attached to this prefix node
            for (var pi = 0; pi < node.patterns.length; pi++) {
                var pat = node.patterns[pi];
                if (pat.suffix.length === 0) {
                    // prefix-only: capture = next Trie-matched word
                    var m = trieMatchAt(captureStart, text);
                    if (m) {
                        var capText = text.substring(captureStart, m.end);
                        if (!isCaptureAllowed(capText, m.pri)) continue;
                        var totalLen = prefixLen + (m.end - captureStart);
                        if (!best || prefixLen > best.compareLen || (prefixLen === best.compareLen && totalLen > best.len)) {
                            best = {
                                len: totalLen,
                                compareLen: prefixLen,
                                value: pat.template.replace('{0}', m.value)
                            };
                        }
                    }
                } else {
                    // prefix+suffix: scan for suffix match after capture
                    var suffLen = pat.suffix.length;
                    var maxCap = Math.min(captureStart + 30, text.length - suffLen);
                    for (var cs = captureStart + 1; cs <= maxCap; cs++) {
                        var suffMatch = true;
                        for (var si = 0; si < suffLen; si++) {
                            if (text[cs + si] !== pat.suffix[si]) { suffMatch = false; break; }
                        }
                        if (suffMatch) {
                            // prefix+suffix: capture is free-form (no isCaptureAllowed constraint)
                            var totalLen2 = prefixLen + (cs - captureStart) + suffLen;
                            if (!best || totalLen2 > best.compareLen || (totalLen2 === best.compareLen && totalLen2 > best.len)) {
                                var capTranslated2 = trieTranslateRun(text, captureStart, cs);
                                best = {
                                    len: totalLen2,
                                    compareLen: totalLen2,
                                    value: pat.template.replace('{0}', capTranslated2)
                                };
                            }
                            break;
                        }
                    }
                }
            }
        }
        return best;
    }

    // Try suffix-only pattern after a Trie-matched segment
    function trySuffixPattern(text, pos) {
        if (!patSuffixRoot) return null;
        var node = patSuffixRoot;
        var best = null;
        for (var s = pos; s < text.length; s++) {
            if (!node.c[text[s]]) break;
            node = node.c[text[s]];
            if (node.templates) {
                var suffLen = s - pos + 1;
                if (!best || suffLen > best.len) {
                    best = { len: suffLen, template: node.templates[0] };
                }
            }
        }
        return best;
    }

    function segmentAndTranslate(text) {
        if (!root) return text;
        text = convertToSimplified(text);
        var result = [];
        var i = 0;
        var allowPatterns = hasPatterns && thuatToanNhan !== 0;
        while (i < text.length) {
            if (!isCJK(text[i])) {
                var s = i;
                while (i < text.length && !isCJK(text[i])) i++;
                result.push(text.substring(s, i));
                continue;
            }
            // Try prefix pattern match first
            var patMatch = allowPatterns ? tryPrefixPattern(text, i) : null;

            // Regular Trie longest match (with priority tracking)
            var node = root, lastMatch = -1, lastValue = null, lastPri = 0, j = i;
            while (j < text.length && node.c[text[j]]) {
                node = node.c[text[j]]; j++;
                if (node.v !== null) { lastMatch = j; lastValue = node.v; lastPri = node.p; }
            }

            // Choose longer match: pattern vs Trie (Trie wins on tie)
            // Fix: use lastMatch <= i instead of !lastValue (lastValue='' is valid suppression)
            if (patMatch && (lastMatch <= i || patMatch.compareLen > (lastMatch - i))) {
                result.push(patMatch.value);
                i += patMatch.len;
            } else if (lastMatch > i) {
                // After Trie match, try suffix-only patterns (min 2-char suffix)
                var suffPat = allowPatterns ? trySuffixPattern(text, lastMatch) : null;
                if (suffPat && suffPat.len >= 2 && isCaptureAllowed(text.substring(i, lastMatch), lastPri)) {
                    result.push(suffPat.template.replace('{0}', lastValue));
                    i = lastMatch + suffPat.len;
                } else {
                    result.push(lastValue);
                    i = lastMatch;
                }
            } else {
                // No match — try suffix-only pattern with single char (min 2-char suffix)
                var suffPat2 = allowPatterns ? trySuffixPattern(text, i + 1) : null;
                if (suffPat2 && suffPat2.len >= 2 && isCaptureAllowed(text[i], 0)) {
                    var charVal = (phienamMap.get(text[i]) || text[i]);
                    result.push(suffPat2.template.replace('{0}', charVal));
                    i = i + 1 + suffPat2.len;
                } else {
                    result.push(phienamMap.get(text[i]) || text[i]);
                    i++;
                }
            }
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
        // Re-key custom entries with simplified keys (in case loaded with traditional keys)
        var normalized = new Map();
        for (var entry of customEntries) {
            var zh = convertToSimplified(entry[0]);
            normalized.set(zh, entry[1]);
        }
        customEntries = normalized;
        for (var entry2 of customEntries) {
            var zh2 = entry2[0], vi = entry2[1], node = root;
            for (var j = 0; j < zh2.length; j++) {
                if (!node.c[zh2[j]]) node.c[zh2[j]] = createNode();
                node = node.c[zh2[j]];
            }
            node.v = vi; node.p = 999;
        }
    }

    // Common CJK chars with empty values in base dict — patch with correct Hán Việt
    var HANVIET_PATCH = { '\u7684': 'đích', '\u4E86': 'liễu', '\u65F3': 'đích' };

    function buildFromTSV(tsv) {
        cachedTSV = tsv;
        var all = parseTSV(tsv);
        if (all.length === 0) return false;
        // Normalize dict keys: Traditional → Simplified
        for (var k = 0; k < all.length; k++) {
            all[k][0] = convertToSimplified(all[k][0]);
        }
        var entries = [], patEntries = [];
        for (var i = 0; i < all.length; i++) {
            var zh = all[i][0];
            if (zh.indexOf('{0}') !== -1) {
                var idx = zh.indexOf('{0}');
                patEntries.push({
                    prefix: zh.substring(0, idx),
                    suffix: zh.substring(idx + 3),
                    template: all[i][1]
                });
            } else {
                entries.push(all[i]);
            }
        }
        root = buildTrie(entries);
        entryCount = entries.length;
        phienamMap.clear();
        for (var k = 0; k < entries.length; k++) {
            if (entries[k][0].length === 1 && (entries[k][2] | 0) <= 1 && entries[k][1])
                phienamMap.set(entries[k][0], entries[k][1]);
        }
        // Patch known missing Hán Việt readings
        for (var ch in HANVIET_PATCH) {
            if (!phienamMap.has(ch)) phienamMap.set(ch, HANVIET_PATCH[ch]);
        }
        applyCustomEntries();
        buildPatterns(patEntries);
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

        // Load trad→simp mapping in parallel with dict fetch
        var tradSimpReady = tradSimpMap ? Promise.resolve() : loadTradSimp();

        var dictReady = fetch(dictUrl).then(function (resp) {
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
            return loadAllImports().then(function (imports) {
                var fullTSV = baseTSV;
                for (var i = 0; i < imports.length; i++) {
                    fullTSV += imports[i].tsv;
                }
                return fullTSV;
            }).catch(function () {
                return baseTSV;
            });
        });

        // Wait for both trad-simp map and dict data before building Trie
        return Promise.all([tradSimpReady, dictReady]).then(function (results) {
            return buildFromTSV(results[1]);
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
        text = convertToSimplified(text);
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
            } else { segments.push({ zh: text[i], vi: phienamMap.get(text[i]) || '' }); i++; }
        }
        return segments;
    }

    function hanviet(text) {
        text = convertToSimplified(text);
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
        zh = convertToSimplified(zh);
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
        zh = convertToSimplified(zh);
        if (!customEntries.has(zh)) return;
        customEntries.delete(zh);
        if (cachedTSV) buildFromTSV(cachedTSV);
        try { localStorage.setItem('customDict', JSON.stringify(Object.fromEntries(customEntries))); } catch (e) {}
    }

    function isCustom(zh) {
        return customEntries.has(convertToSimplified(zh));
    }

    function getCustomEntries() { return Object.fromEntries(customEntries); }

    function clearCustom() {
        customEntries.clear();
        if (cachedTSV) buildFromTSV(cachedTSV);
        try { localStorage.setItem('customDict', '{}'); } catch (e) {}
    }

    function setCustomEntries(obj) {
        // Normalize keys to simplified before storing
        var normalized = {};
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) normalized[convertToSimplified(key)] = obj[key];
        }
        customEntries = new Map(Object.entries(normalized));
        if (cachedTSV) buildFromTSV(cachedTSV);
        try { localStorage.setItem('customDict', JSON.stringify(normalized)); } catch (e) {}
    }

    function reload() {
        root = null; ready = false; entryCount = 0;
        patPrefixRoot = null; patSuffixRoot = null; hasPatterns = false;
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

    function setChuyenGianThe(val) {
        chuyenGianThe = !!val;
        localStorage.setItem('vp_chuyen_gian_the', chuyenGianThe ? '1' : '0');
        if (cachedTSV) buildFromTSV(cachedTSV);
    }

    function setThuatToanNhan(val) {
        thuatToanNhan = Math.max(0, Math.min(3, parseInt(val, 10) || 0));
        localStorage.setItem('vp_thuat_toan_nhan', String(thuatToanNhan));
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
        isCustom: isCustom,
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
        get chuyenGianThe() { return chuyenGianThe; },
        get thuatToanNhan() { return thuatToanNhan; },
        setChuyenGianThe: setChuyenGianThe,
        setThuatToanNhan: setThuatToanNhan,
        convertToSimplified: convertToSimplified,
        reload: reload
    };
})();
