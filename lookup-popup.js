// ===== Lookup Popup — Shared by Reader & Crawler =====
// IIFE exposing window.LookupPopup
(function () {
    'use strict';

    var popup = null;
    var open = false;

    function containsChinese(text) {
        return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text);
    }

    function hide() {
        if (popup) {
            popup.remove();
            popup = null;
        }
        open = false;
    }

    function isOpen() {
        return open;
    }

    // CSS helper: use CSS variables with dark-theme fallbacks
    var C = {
        bg: 'var(--bg, #0a0a12)',
        bgSub: 'var(--bg-subtle, #10101c)',
        surface: 'var(--surface, rgba(255,255,255,0.04))',
        surfaceHover: 'var(--surface-hover, rgba(255,255,255,0.07))',
        border: 'var(--border, rgba(255,255,255,0.08))',
        text: 'var(--text, #e8e6f0)',
        textSec: 'var(--text-secondary, rgba(232,230,240,0.55))',
        accent: 'var(--accent, #7c6cf0)',
        accent2: 'var(--accent-2, #c084fc)',
        green: 'var(--green, #4ade80)'
    };

    var BTN_CSS = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:13px;line-height:1;';

    function show(zhText, anchorEl, options) {
        hide();
        options = options || {};

        if (typeof DictEngine === 'undefined' || !DictEngine.isReady) return;
        if (!zhText || !containsChinese(zhText)) return;

        var segments = DictEngine.segment(zhText);
        if (segments.length === 0) return;

        var el = document.createElement('div');
        el.className = 'vp-lookup-popup';
        el.style.cssText =
            'position:fixed;z-index:100000;' +
            'background:' + C.bg + ';color:' + C.text + ';' +
            'border:1px solid ' + C.border + ';border-radius:8px;' +
            'box-shadow:0 4px 20px rgba(0,0,0,.5);' +
            'font-size:13px;line-height:1.5;' +
            'max-height:50vh;overflow-y:auto;' +
            'min-width:320px;max-width:460px;';

        // Prevent clicks inside popup from propagating (no immersive toggle)
        el.addEventListener('click', function (e) { e.stopPropagation(); });

        // --- Header ---
        var header = document.createElement('div');
        header.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;' +
            'padding:8px 12px;border-bottom:1px solid ' + C.border + ';' +
            'position:sticky;top:0;background:' + C.bg + ';z-index:1;';
        var headerText = document.createElement('span');
        headerText.style.cssText = 'font-weight:600;color:' + C.accent2 + ';max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        headerText.textContent = zhText;
        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.style.cssText =
            'background:' + C.surface + ';color:' + C.textSec + ';border:1px solid ' + C.border + ';' +
            'border-radius:4px;padding:2px 8px;cursor:pointer;' +
            'font-size:11px;margin-left:8px;flex-shrink:0;';
        copyBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            navigator.clipboard.writeText(zhText);
            copyBtn.textContent = 'OK!';
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1000);
        });
        header.appendChild(headerText);
        header.appendChild(copyBtn);
        el.appendChild(header);

        // --- Table ---
        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;';
        var thead = document.createElement('thead');
        var headTr = document.createElement('tr');
        headTr.style.cssText = 'background:' + C.bgSub + ';color:' + C.textSec + ';font-size:11px;text-transform:uppercase;';
        var cols = ['H\u00e1n', 'H\u00e1n-Vi\u1ec7t', 'Ngh\u0129a', ''];
        var widths = [null, null, null, '28px'];
        for (var ci = 0; ci < cols.length; ci++) {
            var th = document.createElement('th');
            th.style.cssText = 'padding:4px 10px;text-align:left;border-bottom:1px solid ' + C.border + ';' + (widths[ci] ? 'width:' + widths[ci] + ';' : '');
            th.textContent = cols[ci];
            headTr.appendChild(th);
        }
        thead.appendChild(headTr);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        for (var si = 0; si < segments.length; si++) {
            (function (seg) {
                var isCustom = DictEngine.isCustom(seg.zh);
                var tr = document.createElement('tr');
                tr.style.cssText = 'border-bottom:1px solid ' + C.border + ';' + (isCustom ? 'border-left:2px solid ' + C.accent2 + ';' : '');
                tr.addEventListener('mouseenter', function () { tr.style.background = C.surfaceHover; });
                tr.addEventListener('mouseleave', function () { tr.style.background = ''; });

                var tdZh = document.createElement('td');
                tdZh.style.cssText = 'padding:5px 10px;color:' + C.text + ';font-size:15px;';
                tdZh.textContent = seg.zh;

                var tdHv = document.createElement('td');
                tdHv.style.cssText = 'padding:5px 10px;color:' + C.accent2 + ';';
                tdHv.textContent = DictEngine.hanviet(seg.zh);

                var tdVi = document.createElement('td');
                tdVi.style.cssText = 'padding:5px 10px;color:' + C.green + ';';
                tdVi.textContent = seg.vi || '\u2014';

                // Edit button
                var tdAct = document.createElement('td');
                tdAct.style.cssText = 'padding:3px 6px;text-align:center;';
                var editBtn = document.createElement('button');
                editBtn.textContent = '\u270e';
                editBtn.title = 'S\u1eeda ngh\u0129a';
                editBtn.style.cssText = BTN_CSS + 'color:' + C.textSec + ';';
                var editing = false;
                editBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (editing) return;
                    editing = true;
                    var input = document.createElement('input');
                    input.type = 'text';
                    input.value = seg.vi || '';
                    input.style.cssText = 'background:' + C.surface + ';color:' + C.green + ';border:1px solid ' + C.border + ';border-radius:3px;padding:2px 6px;width:100%;font-size:13px;box-sizing:border-box;';
                    tdVi.textContent = '';
                    tdVi.appendChild(input);
                    input.focus();
                    input.select();
                    editBtn.textContent = '\u2714';
                    editBtn.style.color = C.green;
                    var save = function () {
                        if (!editing) return;
                        editing = false;
                        var val = input.value.trim();
                        if (val && val !== seg.vi) {
                            DictEngine.addCustom(seg.zh, val);
                            seg.vi = val;
                            tdVi.textContent = val;
                            tr.style.borderLeft = '2px solid ' + C.accent2;
                            if (options.onPhraseChanged) options.onPhraseChanged();
                        } else {
                            tdVi.textContent = seg.vi || '\u2014';
                        }
                        editBtn.textContent = '\u270e';
                        editBtn.style.color = C.textSec;
                    };
                    input.addEventListener('keydown', function (ev) {
                        ev.stopPropagation();
                        if (ev.key === 'Enter') save();
                        if (ev.key === 'Escape') { editing = false; tdVi.textContent = seg.vi || '\u2014'; editBtn.textContent = '\u270e'; editBtn.style.color = C.textSec; }
                    });
                    input.addEventListener('blur', function () { setTimeout(save, 100); });
                });
                tdAct.appendChild(editBtn);

                tr.appendChild(tdZh);
                tr.appendChild(tdHv);
                tr.appendChild(tdVi);
                tr.appendChild(tdAct);
                tbody.appendChild(tr);
            })(segments[si]);
        }
        table.appendChild(tbody);
        el.appendChild(table);

        // --- Add new phrase row ---
        var addRow = document.createElement('div');
        addRow.style.cssText = 'padding:6px 10px;border-top:1px solid ' + C.border + ';display:flex;gap:6px;align-items:center;position:sticky;bottom:0;background:' + C.bg + ';';
        var addZh = document.createElement('input');
        addZh.placeholder = 'H\u00e1n t\u1ef1...';
        addZh.style.cssText = 'background:' + C.surface + ';color:' + C.text + ';border:1px solid ' + C.border + ';border-radius:3px;padding:3px 6px;width:80px;font-size:13px;';
        var addVi = document.createElement('input');
        addVi.placeholder = 'Ngh\u0129a...';
        addVi.style.cssText = 'background:' + C.surface + ';color:' + C.green + ';border:1px solid ' + C.border + ';border-radius:3px;padding:3px 6px;flex:1;font-size:13px;';
        var addBtn = document.createElement('button');
        addBtn.textContent = '+';
        addBtn.title = 'Th\u00eam t\u1eeb m\u1edbi';
        addBtn.style.cssText = 'background:' + C.surface + ';color:' + C.green + ';border:1px solid ' + C.border + ';border-radius:4px;padding:3px 10px;cursor:pointer;font-size:14px;font-weight:bold;';
        var doAdd = function () {
            var zh = addZh.value.trim();
            var vi = addVi.value.trim();
            if (!zh || !vi || !containsChinese(zh)) return;
            DictEngine.addCustom(zh, vi);
            // Add row to table
            var tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid ' + C.border + ';border-left:2px solid ' + C.accent2 + ';';
            tr.addEventListener('mouseenter', function () { tr.style.background = C.surfaceHover; });
            tr.addEventListener('mouseleave', function () { tr.style.background = ''; });
            var td0 = document.createElement('td');
            td0.style.cssText = 'padding:5px 10px;color:' + C.text + ';font-size:15px;';
            td0.textContent = zh;
            var td1 = document.createElement('td');
            td1.style.cssText = 'padding:5px 10px;color:' + C.accent2 + ';';
            td1.textContent = DictEngine.hanviet(zh);
            var td2 = document.createElement('td');
            td2.style.cssText = 'padding:5px 10px;color:' + C.green + ';';
            td2.textContent = vi;
            var td3 = document.createElement('td');
            td3.style.cssText = 'padding:3px 6px;color:' + C.green + ';text-align:center;';
            td3.textContent = '+';
            tr.appendChild(td0);
            tr.appendChild(td1);
            tr.appendChild(td2);
            tr.appendChild(td3);
            tbody.appendChild(tr);
            addZh.value = '';
            addVi.value = '';
            addZh.focus();
            if (options.onPhraseChanged) options.onPhraseChanged();
        };
        addBtn.addEventListener('click', function (e) { e.stopPropagation(); doAdd(); });
        addVi.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') doAdd(); });
        addZh.addEventListener('keydown', function (e) { e.stopPropagation(); });
        addRow.appendChild(addZh);
        addRow.appendChild(addVi);
        addRow.appendChild(addBtn);
        el.appendChild(addRow);

        // --- Mount & position ---
        document.body.appendChild(el);
        popup = el;
        open = true;

        var rect = anchorEl.getBoundingClientRect();
        var popRect = el.getBoundingClientRect();

        var top = rect.bottom + 4;
        var left = rect.left;

        if (top + popRect.height > window.innerHeight - 8) {
            top = rect.top - popRect.height - 4;
        }
        if (top < 8) top = 8;
        if (left + popRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popRect.width - 8;
        }
        if (left < 8) left = 8;

        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }

    // Global dismiss listeners
    document.addEventListener('click', function (e) {
        if (!open) return;
        if (popup && popup.contains(e.target)) return;
        hide();
    }, true);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && open) {
            hide();
            e.stopPropagation();
        }
    }, true);

    window.LookupPopup = {
        show: show,
        hide: hide,
        isOpen: isOpen
    };
})();
