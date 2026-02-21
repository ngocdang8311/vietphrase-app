// ===== BackupManager — Export/Import All App State =====
// Works on both index.html (with DictEngine) and reader.html (without DictEngine)
(function () {
    var BACKUP_VERSION = 2;

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

            var backup = {
                version: BACKUP_VERSION,
                exportedAt: new Date().toISOString(),
                app: 'vietphrase-pwa',
                data: data
            };
            return JSON.stringify(backup);
        });
    }

    function importBackup(jsonText) {
        var backup;
        try {
            backup = JSON.parse(jsonText);
        } catch (e) {
            return Promise.reject(new Error('Invalid JSON file'));
        }

        if (!backup.data) {
            return Promise.reject(new Error('Invalid backup format'));
        }

        var d = backup.data;
        var summary = { settings: false, phrases: 0, dicts: 0, books: 0 };

        // Restore settings
        if (d.settings) {
            if (d.settings.theme) localStorage.setItem('theme', d.settings.theme);
            if (d.settings.readerSettings) localStorage.setItem('readerSettings', d.settings.readerSettings);
            if (d.settings.lastReadBook) localStorage.setItem('lastReadBook', d.settings.lastReadBook);
            summary.settings = true;
        }

        // Restore custom phrases (only if DictEngine available)
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

        var promises = [];

        // Restore imported dicts (only if DictEngine available)
        if (d.importedDicts && d.importedDicts.length && window.DictEngine) {
            promises.push(
                DictEngine.restoreImports(d.importedDicts).then(function (count) {
                    summary.dicts = count;
                }).catch(function () { summary.dicts = 0; })
            );
        }

        // Restore books
        if (d.books && d.books.length) {
            promises.push(
                ReaderLib.restoreBooks(d.books).then(function (count) {
                    summary.books = count;
                }).catch(function () { summary.books = 0; })
            );
        }

        // Restore progress
        if (d.progress && d.progress.length) {
            promises.push(
                ReaderLib.restoreProgress(d.progress).catch(function () {})
            );
        }

        return Promise.all(promises).then(function () {
            return summary;
        });
    }

    window.BackupManager = {
        exportBackup: exportBackup,
        importBackup: importBackup
    };
})();
