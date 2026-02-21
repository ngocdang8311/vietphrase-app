// ===== Webapp UI Logic =====
(function () {
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
    });

    // Elements
    const tabText = document.getElementById('tabText');
    const tabFile = document.getElementById('tabFile');
    const panelText = document.getElementById('panelText');
    const panelFile = document.getElementById('panelFile');
    const inputText = document.getElementById('inputText');
    const outputText = document.getElementById('outputText');
    const btnTranslate = document.getElementById('btnTranslate');
    const btnCopy = document.getElementById('btnCopy');
    const btnClear = document.getElementById('btnClear');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const btnDownloadAll = document.getElementById('btnDownloadAll');
    const dictToggle = document.getElementById('dictToggle');
    const dictBody = document.getElementById('dictBody');
    const dictStats = document.getElementById('dictStats');
    const dictFileInput = document.getElementById('dictFileInput');
    const btnImportDict = document.getElementById('btnImportDict');
    const btnInstall = document.getElementById('btnInstall');
    const fileDrop = document.getElementById('fileDrop');
    const dictToggle2 = document.getElementById('dictToggle2');
    const dictBody2 = document.getElementById('dictBody2');
    const dictStats2 = document.getElementById('dictStats2');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Dict manager elements
    var tabDict = document.getElementById('tabDict');
    var panelDict = document.getElementById('panelDict');
    var dmStatTotal = document.getElementById('dmStatTotal');
    var dmStatPhienam = document.getElementById('dmStatPhienam');
    var dmStatCustom = document.getElementById('dmStatCustom');
    var dmImportTxt = document.getElementById('dmImportTxt');
    var dmClearAllImported = document.getElementById('dmClearAllImported');
    var dmTxtFileInput = document.getElementById('dmTxtFileInput');
    var dmSourcesList = document.getElementById('dmSourcesList');
    var dmImportProgress = document.getElementById('dmImportProgress');
    var dmSearch = document.getElementById('dmSearch');
    var dmExportJson = document.getElementById('dmExportJson');
    var dmImportJson = document.getElementById('dmImportJson');
    var dmJsonFileInput = document.getElementById('dmJsonFileInput');
    var dmClearAll = document.getElementById('dmClearAll');
    var dmPhraseTable = document.getElementById('dmPhraseTable');
    var dmEmpty = document.getElementById('dmEmpty');
    var dmAddZh = document.getElementById('dmAddZh');
    var dmAddVi = document.getElementById('dmAddVi');
    var dmAddBtn = document.getElementById('dmAddBtn');

    // Backup elements
    var btnBackup = document.getElementById('btnBackup');
    var backupModal = document.getElementById('backupModal');
    var btnExportBackup = document.getElementById('btnExportBackup');
    var btnImportBackup = document.getElementById('btnImportBackup');
    var backupFileInput = document.getElementById('backupFileInput');
    var backupStatus = document.getElementById('backupStatus');
    var btnCloseBackup = document.getElementById('btnCloseBackup');

    // Continue reading
    var continueReading = document.getElementById('continueReading');

    // State
    let activeTab = 'text';
    let translatedFiles = [];
    let deferredPrompt = null;
    var outputMode = 'vietphrase'; // 'vietphrase' or 'hanviet'
    var dmSearchFilter = '';

    // --- Tab switching (3 tabs) ---
    var allTabs = [tabText, tabFile, tabDict];
    var allPanels = [panelText, panelFile, panelDict];

    function switchTab(tabName) {
        activeTab = tabName;
        var idx = tabName === 'text' ? 0 : tabName === 'file' ? 1 : 2;
        for (var i = 0; i < allTabs.length; i++) {
            if (i === idx) {
                allTabs[i].classList.add('active');
                allPanels[i].classList.remove('hidden');
            } else {
                allTabs[i].classList.remove('active');
                allPanels[i].classList.add('hidden');
            }
        }
        if (tabName === 'dict') {
            refreshDmStats();
            renderPhraseTable();
            updateSampleButtons();
        }
    }

    tabText.addEventListener('click', function () { switchTab('text'); });
    tabFile.addEventListener('click', function () { switchTab('file'); });
    tabDict.addEventListener('click', function () { switchTab('dict'); });

    // --- Output mode toggle (Viet Phrase / Han Viet) ---
    var outputToggleBtns = document.querySelectorAll('.output-toggle-btn');
    function doTranslate() {
        if (!DictEngine.isReady) {
            outputText.value = 'Dictionary not loaded yet...';
            return;
        }
        var text = inputText.value.trim();
        if (!text) { outputText.value = ''; return; }
        var start = performance.now();
        outputText.value = outputMode === 'hanviet'
            ? DictEngine.hanviet(text)
            : DictEngine.translate(text);
        var ms = (performance.now() - start).toFixed(0);
        btnTranslate.textContent = 'Translate (' + ms + 'ms)';
        setTimeout(function () { btnTranslate.textContent = 'Translate'; }, 2000);
    }

    for (var i = 0; i < outputToggleBtns.length; i++) {
        outputToggleBtns[i].addEventListener('click', function () {
            for (var j = 0; j < outputToggleBtns.length; j++) outputToggleBtns[j].classList.remove('active');
            this.classList.add('active');
            outputMode = this.dataset.mode;
            // Re-translate if there's input text
            if (inputText.value.trim() && DictEngine.isReady) doTranslate();
        });
    }

    // --- Text translation ---
    btnTranslate.addEventListener('click', doTranslate);

    btnCopy.addEventListener('click', function () {
        if (!outputText.value) return;
        navigator.clipboard.writeText(outputText.value).then(function () {
            btnCopy.textContent = 'Copied!';
            setTimeout(function () { btnCopy.textContent = 'Copy'; }, 1500);
        }).catch(function () {
            outputText.select();
            document.execCommand('copy');
            btnCopy.textContent = 'Copied!';
            setTimeout(function () { btnCopy.textContent = 'Copy'; }, 1500);
        });
    });

    btnClear.addEventListener('click', function () {
        inputText.value = '';
        outputText.value = '';
        btnTranslate.textContent = 'Translate';
    });

    // Ctrl+Enter to translate
    inputText.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            btnTranslate.click();
        }
    });

    // --- File drop area ---
    fileDrop.addEventListener('click', function () { fileInput.click(); });
    fileDrop.addEventListener('dragover', function (e) {
        e.preventDefault();
        fileDrop.classList.add('dragover');
    });
    fileDrop.addEventListener('dragleave', function () {
        fileDrop.classList.remove('dragover');
    });
    fileDrop.addEventListener('drop', function (e) {
        e.preventDefault();
        fileDrop.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
        }
    });

    // --- File translation ---
    fileInput.addEventListener('change', function () {
        if (!DictEngine.isReady) {
            alert('Dictionary not loaded yet');
            return;
        }
        translatedFiles = [];
        fileList.innerHTML = '';
        btnDownloadAll.classList.add('hidden');
        const files = fileInput.files;
        if (!files.length) return;

        for (let i = 0; i < files.length; i++) {
            processFile(files[i], i);
        }
    });

    function processFile(file, index) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = '<span class="file-name">' + VP.escapeHtml(file.name) + '</span>' +
            ' <span class="file-size">(' + VP.formatSize(file.size) + ')</span>' +
            ' <span class="file-status" id="fstatus' + index + '">...</span>';
        fileList.appendChild(item);

        const reader = new FileReader();
        reader.onload = function (e) {
            var text = VP.decodeBuffer(e.target.result);
            var start = performance.now();
            var lines = text.split('\n');
            var translated = [];
            for (var j = 0; j < lines.length; j++) {
                translated.push(lines[j].trim() ? DictEngine.translate(lines[j]) : '');
            }
            var ms = (performance.now() - start).toFixed(0);
            var result = translated.join('\n');
            translatedFiles.push({ name: 'vi_' + file.name, content: result });

            var status = document.getElementById('fstatus' + index);
            if (status) {
                status.textContent = 'Done (' + ms + 'ms)';
                status.className = 'file-status done';
                var dlBtn = document.createElement('button');
                dlBtn.className = 'btn-file-dl';
                dlBtn.textContent = 'Download';
                dlBtn.addEventListener('click', function () {
                    VP.downloadFile('vi_' + file.name, result);
                });
                status.parentNode.appendChild(dlBtn);
            }

            if (translatedFiles.length > 1) {
                btnDownloadAll.classList.remove('hidden');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    btnDownloadAll.addEventListener('click', function () {
        for (let i = 0; i < translatedFiles.length; i++) {
            VP.downloadFile(translatedFiles[i].name, translatedFiles[i].content);
        }
    });

    // --- Dictionary panel ---
    dictToggle.addEventListener('click', function () {
        const isOpen = !dictBody.classList.contains('hidden');
        dictBody.classList.toggle('hidden');
        dictToggle.querySelector('.arrow').textContent = isOpen ? '\u25B8' : '\u25BE';
    });

    btnImportDict.addEventListener('click', function () {
        dictFileInput.click();
    });

    var importPriority = document.getElementById('importPriority');

    dictFileInput.addEventListener('change', function () {
        const files = dictFileInput.files;
        if (!files.length) return;
        var pri = parseInt(importPriority.value, 10) || 10;
        let totalImported = 0;
        let pending = files.length;
        for (let i = 0; i < files.length; i++) {
            (function (file) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    var text = VP.decodeBuffer(e.target.result);
                    DictEngine.importDictText(text, pri, file.name).then(function (count) {
                        totalImported += count;
                        pending--;
                        if (pending === 0) {
                            updateDictStats();
                            dictStats.textContent += ' (+' + totalImported + ' imported)';
                        }
                    });
                };
                reader.readAsArrayBuffer(file);
            })(files[i]);
        }
        dictFileInput.value = '';
    });

    // Dict toggle in File tab
    dictToggle2.addEventListener('click', function () {
        const isOpen = !dictBody2.classList.contains('hidden');
        dictBody2.classList.toggle('hidden');
        dictToggle2.querySelector('.arrow').textContent = isOpen ? '\u25B8' : '\u25BE';
    });

    function updateDictStats() {
        var text;
        if (DictEngine.isReady) {
            text = 'Loaded: ' + DictEngine.entryCount.toLocaleString() + ' entries' +
                (DictEngine.customCount > 0 ? ' + ' + DictEngine.customCount + ' custom' : '');
        } else {
            text = 'Not loaded';
        }
        dictStats.textContent = text;
        dictStats2.textContent = text;
    }

    // --- PWA install ---
    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        btnInstall.classList.remove('hidden');
    });

    btnInstall.addEventListener('click', function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
            deferredPrompt = null;
            btnInstall.classList.add('hidden');
        });
    });

    window.addEventListener('appinstalled', function () {
        btnInstall.classList.add('hidden');
        deferredPrompt = null;
    });

    // --- Init ---
    function init() {
        loadingOverlay.classList.remove('hidden');
        DictEngine.loadDictionary('dict-default.json').then(function (ok) {
            loadingOverlay.classList.add('hidden');
            if (ok) {
                updateDictStats();
            } else {
                dictStats.textContent = dictStats2.textContent = 'Failed to load dictionary';
            }
        }).catch(function (err) {
            loadingOverlay.classList.add('hidden');
            dictStats.textContent = dictStats2.textContent = 'Error: ' + err.message;
            console.error('Dict load error:', err);
        });

        // Show "continue reading" shortcut
        updateContinueReading();
    }

    // --- Continue reading shortcut ---
    function updateContinueReading() {
        if (!continueReading) return;
        try {
            var last = JSON.parse(localStorage.getItem('lastReadBook'));
            if (last && last.id && last.title) {
                var label = last.title;
                if (last.chapterIndex != null) label += ' - Ch\u01B0\u01A1ng ' + (last.chapterIndex + 1);
                continueReading.innerHTML = '<a href="reader.html?book=' + encodeURIComponent(last.id) + '" style="color:var(--accent-2);text-decoration:none;font-size:13px;font-weight:600">' +
                    'Ti\u1EBFp t\u1EE5c \u0111\u1ECDc: ' + VP.escapeHtml(label) + ' &rarr;</a>';
                continueReading.classList.remove('hidden');
                return;
            }
        } catch (e) {}
        continueReading.classList.add('hidden');
    }

    // ===== Dictionary Manager =====

    function refreshDmStats() {
        if (!DictEngine.isReady) return;
        dmStatTotal.textContent = DictEngine.entryCount.toLocaleString();
        dmStatPhienam.textContent = DictEngine.phienamCount.toLocaleString();
        dmStatCustom.textContent = DictEngine.customCount.toLocaleString();
        // Render imported sources list
        DictEngine.getImportedSources().then(function (sources) {
            if (sources.length > 0) {
                dmClearAllImported.classList.remove('hidden');
            } else {
                dmClearAllImported.classList.add('hidden');
            }
            var html = '';
            for (var i = 0; i < sources.length; i++) {
                var s = sources[i];
                var dateStr = new Date(s.date).toLocaleDateString();
                html += '<div class="dm-source-item">' +
                    '<span class="dm-source-name">' + VP.escapeHtml(s.name) + '</span>' +
                    '<span class="dm-source-count">' + s.count.toLocaleString() + ' entries</span>' +
                    '<span class="dm-source-date">' + dateStr + '</span>' +
                    '<button class="dm-btn dm-btn-red dm-btn-sm dm-remove-source" data-name="' + VP.escapeHtml(s.name) + '">Remove</button>' +
                    '</div>';
            }
            dmSourcesList.innerHTML = html;
        });
    }

    function renderPhraseTable() {
        var entries = DictEngine.isReady ? Object.entries(DictEngine.getCustomEntries()) : [];
        var filtered = dmSearchFilter
            ? entries.filter(function (e) {
                return e[0].indexOf(dmSearchFilter) !== -1 ||
                    e[1].toLowerCase().indexOf(dmSearchFilter.toLowerCase()) !== -1;
            })
            : entries;

        if (entries.length === 0) {
            dmEmpty.classList.remove('hidden');
            dmPhraseTable.innerHTML = '';
            return;
        }
        dmEmpty.classList.add('hidden');

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var zh = VP.escapeHtml(filtered[i][0]);
            var vi = VP.escapeHtml(filtered[i][1]);
            html += '<tr data-zh="' + zh + '">' +
                '<td class="col-zh"><span class="dm-cell" data-field="zh">' + zh + '</span></td>' +
                '<td class="col-vi"><span class="dm-cell" data-field="vi">' + vi + '</span></td>' +
                '<td class="col-act">' +
                '<button class="dm-btn dm-btn-accent dm-btn-sm dm-edit-btn">Edit</button> ' +
                '<button class="dm-btn dm-btn-red dm-btn-sm dm-del-btn">Delete</button>' +
                '</td></tr>';
        }
        dmPhraseTable.innerHTML = html;
    }

    // Table click delegation (edit/delete)
    dmPhraseTable.addEventListener('click', function (e) {
        var row = e.target.closest('tr');
        if (!row) return;
        var zh = row.dataset.zh;

        if (e.target.classList.contains('dm-del-btn')) {
            DictEngine.removeCustom(zh);
            renderPhraseTable();
            refreshDmStats();
            updateDictStats();
            return;
        }

        if (e.target.classList.contains('dm-edit-btn')) {
            startEdit(row, zh);
            return;
        }

        // Save/cancel buttons from inline editing
        if (e.target.classList.contains('dm-save-btn')) {
            var zhInput = row.querySelector('input[data-field="zh"]');
            var viInput = row.querySelector('input[data-field="vi"]');
            if (zhInput && viInput) {
                var newZh = zhInput.value.trim();
                var newVi = viInput.value.trim();
                if (newZh && newVi) {
                    if (newZh !== zh) DictEngine.removeCustom(zh);
                    DictEngine.addCustom(newZh, newVi);
                    renderPhraseTable();
                    refreshDmStats();
                    updateDictStats();
                }
            }
            return;
        }
        if (e.target.classList.contains('dm-cancel-btn')) {
            renderPhraseTable();
            return;
        }
    });

    function startEdit(row, zh) {
        if (row.querySelector('.dm-cell-edit')) return;
        var entries = DictEngine.getCustomEntries();
        var vi = entries[zh] || '';
        row.cells[0].innerHTML = '<input class="dm-cell-edit" data-field="zh" value="' + VP.escapeHtml(zh) + '">';
        row.cells[1].innerHTML = '<input class="dm-cell-edit" data-field="vi" value="' + VP.escapeHtml(vi) + '">';
        row.cells[2].innerHTML = '<button class="dm-btn dm-btn-green dm-btn-sm dm-save-btn">Save</button> ' +
            '<button class="dm-btn dm-btn-default dm-btn-sm dm-cancel-btn">Cancel</button>';
        var viInput = row.cells[1].querySelector('input');
        if (viInput) { viInput.focus(); viInput.select(); }

        // Enter/Escape keys
        var inputs = row.querySelectorAll('.dm-cell-edit');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') row.querySelector('.dm-save-btn').click();
                if (ev.key === 'Escape') row.querySelector('.dm-cancel-btn').click();
            });
        }
    }

    // Add entry
    function addPhraseEntry() {
        var zh = dmAddZh.value.trim();
        var vi = dmAddVi.value.trim();
        if (!zh || !vi) return;
        DictEngine.addCustom(zh, vi);
        dmAddZh.value = '';
        dmAddVi.value = '';
        dmAddZh.focus();
        renderPhraseTable();
        refreshDmStats();
        updateDictStats();
    }
    dmAddBtn.addEventListener('click', addPhraseEntry);
    dmAddVi.addEventListener('keydown', function (e) { if (e.key === 'Enter') addPhraseEntry(); });
    dmAddZh.addEventListener('keydown', function (e) { if (e.key === 'Enter') dmAddVi.focus(); });

    // Search
    dmSearch.addEventListener('input', function () {
        dmSearchFilter = dmSearch.value.trim();
        renderPhraseTable();
    });

    // Clear all
    dmClearAll.addEventListener('click', function () {
        if (!DictEngine.customCount) return;
        if (!confirm('Delete all custom phrases?')) return;
        DictEngine.clearCustom();
        renderPhraseTable();
        refreshDmStats();
        updateDictStats();
    });

    // Export custom phrases as .txt (CN=VN format, one per line)
    dmExportJson.addEventListener('click', function () {
        var entries = DictEngine.getCustomEntries();
        var lines = [];
        for (var zh in entries) {
            if (entries.hasOwnProperty(zh)) {
                lines.push(zh + '=' + entries[zh]);
            }
        }
        if (!lines.length) return;
        VP.downloadFile('custom-phrases.txt', lines.join('\n') + '\n');
    });

    // Import custom phrases from .txt (CN=VN format)
    dmImportJson.addEventListener('click', function () { dmJsonFileInput.click(); });
    dmJsonFileInput.addEventListener('change', function () {
        var file = dmJsonFileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            var text = VP.decodeBuffer(e.target.result);
            var lines = text.split('\n');
            var count = 0;
            var current = DictEngine.getCustomEntries();
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line || line[0] === '#' || (line[0] === '/' && line[1] === '/')) continue;
                var eq = line.indexOf('=');
                if (eq < 1) continue;
                var zh = line.substring(0, eq).trim();
                var vi = line.substring(eq + 1).trim();
                if (zh && vi) {
                    current[zh] = vi;
                    count++;
                }
            }
            if (count > 0) {
                DictEngine.setCustomEntries(current);
                renderPhraseTable();
                refreshDmStats();
                updateDictStats();
            }
            dmImportJson.textContent = 'Imported ' + count;
            setTimeout(function () { dmImportJson.textContent = 'Import .txt'; }, 2000);
        };
        reader.readAsArrayBuffer(file);
        dmJsonFileInput.value = '';
    });

    // Import .txt dict (with encoding detection, persisted to IDB per file)
    dmImportTxt.addEventListener('click', function () { dmTxtFileInput.click(); });
    dmTxtFileInput.addEventListener('change', function () {
        var files = dmTxtFileInput.files;
        if (!files.length) return;
        dmImportTxt.disabled = true;
        dmImportProgress.classList.remove('hidden');
        var totalImported = 0;
        var pending = files.length;

        for (var i = 0; i < files.length; i++) {
            (function (file) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    var text = VP.decodeBuffer(e.target.result);
                    dmImportProgress.textContent = 'Importing ' + file.name + '...';
                    DictEngine.importDictText(text, 10, file.name).then(function (count) {
                        totalImported += count;
                        pending--;
                        if (pending === 0) {
                            dmImportTxt.disabled = false;
                            dmImportProgress.textContent = 'Imported ' + totalImported.toLocaleString() + ' entries';
                            setTimeout(function () { dmImportProgress.classList.add('hidden'); }, 3000);
                            refreshDmStats();
                            updateDictStats();
                        }
                    });
                };
                reader.readAsArrayBuffer(file);
            })(files[i]);
        }
        dmTxtFileInput.value = '';
    });

    // Clear ALL imported dictionaries
    dmClearAllImported.addEventListener('click', function () {
        if (!confirm('Clear all imported dictionaries? (Custom phrases will be kept)')) return;
        DictEngine.clearAllImported().then(function () {
            refreshDmStats();
            updateDictStats();
            updateSampleButtons();
        });
    });

    // Remove individual imported source (click delegation on sources list)
    dmSourcesList.addEventListener('click', function (e) {
        if (!e.target.classList.contains('dm-remove-source')) return;
        var name = e.target.dataset.name;
        if (!name) return;
        DictEngine.removeImportedSource(name).then(function () {
            refreshDmStats();
            updateDictStats();
            updateSampleButtons();
        });
    });

    // ===== Sample Dictionaries =====
    var dmSampleList = document.getElementById('dmSampleList');

    // Check which samples are already imported and update buttons
    function updateSampleButtons() {
        DictEngine.getImportedSources().then(function (sources) {
            var imported = {};
            for (var i = 0; i < sources.length; i++) imported[sources[i].name] = true;
            var items = dmSampleList.querySelectorAll('.dm-sample-item');
            for (var j = 0; j < items.length; j++) {
                var btn = items[j].querySelector('.dm-sample-btn');
                var files = items[j].dataset.file.split(',');
                var allDone = files.every(function (f) { return imported[f]; });
                if (allDone) {
                    btn.textContent = 'Imported';
                    btn.classList.add('done');
                    btn.classList.remove('loading');
                } else if (!btn.classList.contains('loading')) {
                    btn.textContent = 'Import';
                    btn.classList.remove('done');
                }
            }
        });
    }

    // Fetch + import a single dict file with given priority, return promise with count
    function fetchAndImport(file, priority) {
        return fetch('dicts/' + file).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + file);
            return resp.arrayBuffer();
        }).then(function (buf) {
            var text = VP.decodeBuffer(buf);
            return DictEngine.importDictText(text, priority || 10, file);
        });
    }

    // Click delegation for sample import buttons
    dmSampleList.addEventListener('click', function (e) {
        var btn = e.target.closest('.dm-sample-btn');
        if (!btn || btn.classList.contains('loading') || btn.classList.contains('done')) return;
        var item = btn.closest('.dm-sample-item');
        var fileAttr = item.dataset.file;
        if (!fileAttr) return;
        var files = fileAttr.split(',');
        var priority = parseInt(item.dataset.priority, 10) || 10;

        btn.classList.add('loading');
        btn.textContent = 'Downloading...';

        var totalCount = 0;
        var idx = 0;
        function next() {
            if (idx >= files.length) {
                btn.classList.remove('loading');
                btn.classList.add('done');
                btn.textContent = 'Imported';
                refreshDmStats();
                updateDictStats();
                return;
            }
            var file = files[idx];
            btn.textContent = files.length > 1
                ? 'Importing ' + (idx + 1) + '/' + files.length + '...'
                : 'Importing...';
            fetchAndImport(file, priority).then(function (count) {
                totalCount += count;
                idx++;
                next();
            }).catch(function (err) {
                btn.classList.remove('loading');
                btn.textContent = 'Failed';
                console.error('Sample import error:', err);
                setTimeout(function () { btn.textContent = 'Import'; }, 3000);
            });
        }
        next();
    });

    // ===== Backup / Restore =====
    if (btnBackup) {
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
                // Reload dict if dicts were restored
                if (summary.dicts) {
                    DictEngine.reload().then(function () {
                        updateDictStats();
                    });
                }
                updateContinueReading();
            }).catch(function (err) {
                backupStatus.textContent = 'L\u1ED7i: ' + err.message;
            });
            backupFileInput.value = '';
        });
    }

    // ===== Cloud Sync =====
    var btnSyncIdx = document.getElementById('btnSync');
    var syncModalIdx = document.getElementById('syncModal');
    var syncStatusMsgIdx = document.getElementById('syncStatusMsg');
    var syncConnectedIdx = document.getElementById('syncConnected');
    var syncDisconnectedIdx = document.getElementById('syncDisconnected');
    var syncProviderBadgeIdx = document.getElementById('syncProviderBadge');
    var btnDoSyncIdx = document.getElementById('btnDoSync');
    var btnConnectGoogleIdx = document.getElementById('btnConnectGoogle');
    var btnConnectGithubIdx = document.getElementById('btnConnectGithub');
    var btnDisconnectIdx = document.getElementById('btnDisconnect');
    var btnCloseSyncIdx = document.getElementById('btnCloseSync');
    var deviceFlowUIIdx = document.getElementById('deviceFlowUI');
    var deviceFlowCodeIdx = document.getElementById('deviceFlowCode');
    var btnCancelDeviceIdx = document.getElementById('btnCancelDevice');

    function updateSyncBtnIdx() {
        if (!window.CloudSync || !btnSyncIdx) return;
        btnSyncIdx.style.color = CloudSync.isSignedIn() ? 'var(--green)' : 'var(--text)';
    }

    function updateSyncModalIdx() {
        if (!window.CloudSync) return;
        if (CloudSync.isSignedIn()) {
            syncConnectedIdx.classList.remove('hidden');
            syncDisconnectedIdx.classList.add('hidden');
            if (deviceFlowUIIdx) deviceFlowUIIdx.classList.add('hidden');
            var providerName = CloudSync.getActiveProviderName();
            var label = providerName === 'github' ? 'GitHub Gist' : 'Google Drive';
            if (syncProviderBadgeIdx) syncProviderBadgeIdx.textContent = 'Connected via ' + label;
            var ls = CloudSync.getLastSyncTime();
            syncStatusMsgIdx.textContent = ls ? 'Last sync: ' + new Date(ls).toLocaleString() : 'Connected.';
        } else {
            syncConnectedIdx.classList.add('hidden');
            syncDisconnectedIdx.classList.remove('hidden');
            syncStatusMsgIdx.textContent = '';
        }
    }

    if (btnSyncIdx) {
        btnSyncIdx.addEventListener('click', function () {
            syncModalIdx.classList.remove('hidden');
            updateSyncModalIdx();
        });
    }
    if (btnCloseSyncIdx) {
        btnCloseSyncIdx.addEventListener('click', function () {
            syncModalIdx.classList.add('hidden');
        });
        syncModalIdx.addEventListener('click', function (e) {
            if (e.target === syncModalIdx) syncModalIdx.classList.add('hidden');
        });
    }
    if (btnConnectGoogleIdx) {
        btnConnectGoogleIdx.addEventListener('click', function () {
            CloudSync.setProvider('google');
            btnConnectGoogleIdx.disabled = true;
            btnConnectGoogleIdx.textContent = 'Connecting...';
            CloudSync.signIn().then(function () {
                btnConnectGoogleIdx.disabled = false;
                btnConnectGoogleIdx.textContent = 'Google Drive';
                updateSyncBtnIdx();
                updateSyncModalIdx();
            }).catch(function (err) {
                btnConnectGoogleIdx.disabled = false;
                btnConnectGoogleIdx.textContent = 'Google Drive';
                syncStatusMsgIdx.textContent = 'Error: ' + err.message;
            });
        });
    }
    if (btnConnectGithubIdx) {
        btnConnectGithubIdx.addEventListener('click', function () {
            CloudSync.setProvider('github');
            btnConnectGithubIdx.disabled = true;
            btnConnectGithubIdx.textContent = 'Connecting...';
            if (deviceFlowUIIdx) deviceFlowUIIdx.classList.add('hidden');
            CloudSync.signIn({
                onDeviceCode: function (info) {
                    if (deviceFlowUIIdx) deviceFlowUIIdx.classList.remove('hidden');
                    if (deviceFlowCodeIdx) deviceFlowCodeIdx.textContent = info.userCode;
                    btnConnectGithubIdx.textContent = 'Waiting...';
                }
            }).then(function () {
                btnConnectGithubIdx.disabled = false;
                btnConnectGithubIdx.textContent = 'GitHub Gist';
                if (deviceFlowUIIdx) deviceFlowUIIdx.classList.add('hidden');
                updateSyncBtnIdx();
                updateSyncModalIdx();
            }).catch(function (err) {
                btnConnectGithubIdx.disabled = false;
                btnConnectGithubIdx.textContent = 'GitHub Gist';
                if (deviceFlowUIIdx) deviceFlowUIIdx.classList.add('hidden');
                syncStatusMsgIdx.textContent = 'Error: ' + err.message;
            });
        });
    }
    if (btnCancelDeviceIdx) {
        btnCancelDeviceIdx.addEventListener('click', function () {
            if (window.GitHubGistProvider) GitHubGistProvider.cancelSignIn();
            if (deviceFlowUIIdx) deviceFlowUIIdx.classList.add('hidden');
            if (btnConnectGithubIdx) {
                btnConnectGithubIdx.disabled = false;
                btnConnectGithubIdx.textContent = 'GitHub Gist';
            }
        });
    }
    if (btnDisconnectIdx) {
        btnDisconnectIdx.addEventListener('click', function () {
            CloudSync.signOut();
            updateSyncBtnIdx();
            updateSyncModalIdx();
        });
    }
    if (btnDoSyncIdx) {
        btnDoSyncIdx.addEventListener('click', function () {
            btnDoSyncIdx.disabled = true;
            syncStatusMsgIdx.textContent = 'Syncing...';
            CloudSync.sync(function (msg) {
                syncStatusMsgIdx.textContent = msg;
            }).then(function (summary) {
                btnDoSyncIdx.disabled = false;
                syncStatusMsgIdx.textContent = 'Sync done!';
                updateSyncBtnIdx();
                // Reload custom phrases if DictEngine available
                if (window.DictEngine && DictEngine.isReady) {
                    try {
                        var entries = DictEngine.getCustomEntries();
                        if (entries) {
                            renderPhraseTable();
                            refreshDmStats();
                            updateDictStats();
                        }
                    } catch (e) {}
                }
                updateContinueReading();
            }).catch(function (err) {
                btnDoSyncIdx.disabled = false;
                if (err.message === 'TOKEN_EXPIRED') {
                    syncStatusMsgIdx.textContent = 'Session expired. Please reconnect.';
                    CloudSync.signOut();
                    updateSyncBtnIdx();
                    updateSyncModalIdx();
                } else {
                    syncStatusMsgIdx.textContent = 'Sync error: ' + err.message;
                }
            });
        });
    }

    // Init cloud sync
    if (window.CloudSync) {
        CloudSync.init();
        updateSyncBtnIdx();
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
            console.warn('SW registration failed:', err);
        });
    }

    init();
})();
