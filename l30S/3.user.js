// ==UserScript==
// @name         BO5 Weapon Scanner
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  敵構成のリストから武器名を特定します（マスク対応 + クリップボード + 16連勝以上限定発動 + 自己診断ログ）
// @author       Gemini / improved
// @match        https://wdrb.work/bo5/battle_lobby.php?mode=rumble*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ===== 設定 =====
    const STREAK_THRESHOLD = 15;   // この連勝数以上で発動（未満は何もしない）
    const DEBUG = true;            // 切り分け用ログ。落ち着いたら false に。
    function log(...a) { if (DEBUG) console.log('[BO5-Scanner]', ...a); }

    const weaponDB = {"上段,1|中段,2|下段,2|奥義,1|無形,1":["アンブレラ","打刀"],"上段,2|中段,3|下段,1|奥義,1|無形,3":["ウィップ","鋼糸"],"中段,2|下段,1|奥義,1|無形,1|無形,1":["ウォーハンマー"],"上段,1|中段,3|下段,1|奥義,1|無形,3":["ウォーピック","バット"],"上段,1|中段,1|奥義,1|無形,1|無形,1":["エクセキューター","ビームサーベル"],"上段,2|中段,2|下段,2|奥義,2|無形,1":["エストック"],"上段,1|中段,3|下段,2|奥義,2|無形,2":["カッツバルゲル"],"上段,1|上段,2|下段,1|奥義,2|無形,2":["カットラス"],"上段,2|中段,2|中段,1|奥義,2|無形,1":["カランビット"],"上段,1|中段,1|下段,1|奥義,1|無形,2":["ギガントアーム","サイス","トリガーブレイド","バルディッシュ","大太刀","棒"],"上段,1|中段,1|無形,1|無形,1|無形,1":["ギロッチン"],"上段,2|中段,3|奥義,1|無形,2|無形,2":["クローファング"],"上段,2|中段,3|下段,1|奥義,1|無形,1":["グラディウス"],"上段,2|中段,2|下段,1|無形,1|無形,1":["グレートソード"],"上段,1|中段,2|下段,1|奥義,1|無形,2":["ケペシュ","バール","十文字槍"],"上段,2|中段,2|下段,2|奥義,1|無形,2":["コイルソード","ブロードソード","レイピア"],"下段,2|下段,1|下段,1|奥義,1|無形,2":["ゴルフクラブ"],"上段,2|中段,1|下段,1|奥義,1|無形,1":["サイ"],"上段,2|中段,2|下段,1|奥義,1|無形,1":["シザーズブレイド","スピア","薙刀","金剛杵"],"中段,2|下段,2|下段,1|奥義,1|無形,2":["シャベル"],"上段,2|中段,2|下段,2|奥義,1|無形,1":["シャムシール","ジャマダハル"],"上段,2|中段,1|中段,1|下段,1|奥義,1":["ショーテル"],"中段,1|下段,1|奥義,1|無形,1|無形,1":["スタンロッド"],"上段,2|中段,2|中段,1|下段,2|無形,1":["スティレット"],"上段,2|中段,3|下段,2|下段,3|奥義,2":["ステッキ"],"上段,2|中段,1|中段,2|下段,1|奥義,1":["スパイクシールド"],"上段,1|中段,1|下段,1|奥義,1|奥義,1":["ソーブレイド","偃月刀"],"上段,2|中段,1|下段,2|奥義,3|無形,1":["ダガー"],"中段,2|中段,2|下段,2|奥義,3|無形,2":["チェーンソー"],"上段,2|中段,2|下段,1|下段,1|無形,2":["ツインハチェット"],"中段,2|中段,2|下段,1|奥義,1|奥義,1":["ツーブレイデッド"],"上段,1|中段,1|下段,1|奥義,1|無形,1":["トライデント","ランス","ロングソード","棍棒"],"中段,2|中段,1|下段,2|下段,1|無形,2":["トンファー"],"中段,2|中段,2|下段,2|奥義,1|無形,1":["ドリルスピア"],"中段,5|中段,3|中段,1|奥義,1|無形,2":["ナックルダスター"],"上段,1|中段,1|下段,2|奥義,1|無形,2":["ハルバード"],"上段,2|上段,1|下段,2|奥義,1|無形,2":["バイブル"],"上段,3|中段,1|下段,2|奥義,1|無形,2":["バッティングラム"],"上段,1|中段,1|下段,1|奥義,1|無形,3":["バトルアックス"],"上段,3|中段,2|下段,2|奥義,1|無形,3":["バトルヨーヨー"],"上段,2|中段,2|下段,1|奥義,1|無形,3":["フライパン"],"上段,3|中段,2|下段,1|奥義,1|無形,1":["フレイル"],"上段,2|下段,2|奥義,2|無形,1|無形,1":["ブリーフケース"],"上段,2|下段,2|下段,1|奥義,1|無形,2":["ブレイドシューズ"],"上段,2|中段,1|下段,3|奥義,1|無形,3":["ポケットナイフ"],"上段,1|中段,2|下段,1|奥義,1|無形,1":["マジックワンド"],"上段,1|上段,2|中段,1|中段,2|下段,2":["マチェット"],"上段,2|中段,2|下段,1|奥義,1|奥義,1":["メイス"],"上段,1|中段,2|中段,1|下段,2|無形,2":["メガホン"],"上段,2|中段,2|下段,1|下段,1|無形,1":["ラウンドシールド"],"中段,1|中段,2|中段,1|奥義,1|無形,3":["包丁"],"上段,2|上段,1|下段,2|下段,1|無形,1":["十手"],"中段,2|下段,3|奥義,1|奥義,1|無形,1":["卜ソワァ―"],"上段,2|中段,2|中段,1|下段,2|下段,1":["双剣"],"上段,1|上段,2|中段,2|下段,2|奥義,1":["多節棍"],"上段,1|上段,1|下段,1|下段,1|奥義,1":["大錫杖"],"上段,2|中段,1|中段,1|下段,2|無形,1":["太極剣"],"上段,4|中段,4|下段,4|奥義,1|無形,1":["徒手空拳"],"上段,2|上段,2|上段,2|下段,1|奥義,2":["手甲鉤"],"上段,1|中段,1|下段,1|無形,1|無形,1":["旗槍"],"上段,2|中段,3|下段,2|下段,2|無形,1":["竹槍"],"上段,1|中段,2|下段,1|奥義,2|奥義,1":["網"],"上段,2|中段,2|下段,3|奥義,1|無形,2":["苗刀"],"上段,1|中段,1|下段,1|無形,2|無形,2":["蛇行剣"],"上段,2|中段,3|奥義,1|奥義,1|無形,2":["輪刀"],"上段,2|下段,2|奥義,1|無形,1|無形,1":["連接剣"],"上段,3|中段,2|中段,2|奥義,3|無形,1":["酒瓶"],"上段,3|中段,1|下段,1|奥義,1|無形,3":["鉄パイプ"],"上段,2|中段,1|下段,1|奥義,1|無形,2":["鉄扇"],"上段,1|上段,2|演奏,2|下段,2|無形,2":["銃剣"],"中段,2|下段,2|奥義,1|無形,2|無形,3":["鎖鎌"],"上段,2|中段,1|中段,1|下段,2|奥義,2":["長短対剣"]};

    const VALID_TYPES = new Set(["上段", "中段", "下段", "奥義", "無形", "演奏"]);

    // ------- スタイル注入（1回だけ） -------
    function injectStyles() {
        if (document.getElementById('bo5-scan-styles')) return;
        const style = document.createElement('style');
        style.id = 'bo5-scan-styles';
        style.textContent = `
            .bo5-scan-card {
                margin-top: 12px;
                padding: 0;
                background: linear-gradient(135deg, rgba(18, 20, 28, 0.96), rgba(32, 22, 26, 0.96));
                border: 1px solid rgba(255, 255, 255, 0.07);
                border-radius: 10px;
                color: #e8e8e8;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35),
                            inset 0 1px 0 rgba(255, 255, 255, 0.04);
                position: relative;
                overflow: hidden;
                text-align: left;
            }
            .bo5-scan-card::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 2px;
                background: linear-gradient(90deg, #ff5b5b 0%, #ff9a3c 50%, #ffd166 100%);
                opacity: 0.85;
            }
            .bo5-scan-inner {
                padding: 13px 15px 12px;
            }
            .bo5-scan-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 10px;
                letter-spacing: 0.12em;
                color: #8a8a92;
                text-transform: uppercase;
                font-weight: 700;
                margin-bottom: 9px;
            }
            .bo5-scan-header .label {
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .bo5-scan-header .label::before {
                content: '';
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #ff5b5b;
                box-shadow: 0 0 8px rgba(255, 91, 91, 0.7);
                animation: bo5-pulse 1.6s ease-in-out infinite;
            }
            @keyframes bo5-pulse {
                0%, 100% { opacity: 0.5; }
                50% { opacity: 1; }
            }
            .bo5-scan-count {
                color: #ffb86b;
                font-weight: 800;
                font-size: 11px;
                font-feature-settings: "tnum";
            }
            .bo5-scan-mask {
                color: #6a6a72;
                font-size: 10px;
                font-feature-settings: "tnum";
                letter-spacing: 0.08em;
            }
            .bo5-scan-body {
                font-size: 14px;
                line-height: 1.7;
                color: #ffe5cc;
                font-weight: 600;
                margin: 4px 0 11px;
                word-break: break-word;
            }
            .bo5-scan-body .name {
                display: inline-block;
            }
            .bo5-scan-body .sep {
                color: #4a4a52;
                margin: 0 7px;
                font-weight: 400;
            }
            .bo5-scan-confirmed .bo5-scan-body {
                font-size: 18px;
                color: #ffd57a;
                text-align: center;
                margin: 8px 0 12px;
                text-shadow: 0 0 12px rgba(255, 180, 80, 0.25);
            }
            .bo5-scan-copy {
                width: 100%;
                padding: 9px 10px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 7px;
                color: #d8d8d8;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.1em;
                text-transform: uppercase;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.08s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                font-family: inherit;
            }
            .bo5-scan-copy:hover {
                background: rgba(255, 91, 91, 0.12);
                border-color: rgba(255, 91, 91, 0.35);
                color: #ffffff;
            }
            .bo5-scan-copy:active {
                transform: scale(0.985);
            }
            .bo5-scan-copy.copied {
                background: rgba(91, 200, 130, 0.18);
                border-color: rgba(91, 200, 130, 0.45);
                color: #b4ffc8;
            }
            .bo5-scan-copy svg {
                width: 12px;
                height: 12px;
                flex-shrink: 0;
            }
            .bo5-scan-empty {
                font-size: 12px;
                color: #7a7a82;
                text-align: center;
                letter-spacing: 0.08em;
                padding: 2px 0;
            }
            .bo5-scan-card.bo5-state-none::before {
                background: linear-gradient(90deg, #6a6a72, #4a4a52);
            }
            .bo5-scan-card.bo5-state-confirmed::before {
                background: linear-gradient(90deg, #ffd166 0%, #ff9a3c 50%, #ffd166 100%);
            }
        `;
        document.head.appendChild(style);
    }

    // ------- スロット解析 -------
    function parseSlot(li) {
        if (!li) return { type: '?', count: '?' };
        const img = li.querySelector('img.cap');
        const typeFull = img ? (img.getAttribute('data-tippy-content') || '') : '';
        const typeCandidate = typeFull.substring(0, 2);
        const type = VALID_TYPES.has(typeCandidate) ? typeCandidate : '?';
        const countTag = li.querySelector('b.gray.large');
        const rawCount = countTag ? countTag.innerText.trim() : '';
        const count = (rawCount && rawCount !== '?' && rawCount !== '?') ? rawCount : '?';
        return { type, count };
    }

    // ------- マッチング -------
    function matchWeapons(pattern) {
        const results = [];
        for (const [key, weapons] of Object.entries(weaponDB)) {
            const dbSlots = key.split('|');
            if (dbSlots.length !== 5) continue;
            let matched = true;
            for (let i = 0; i < 5; i++) {
                const [dbType, dbCount] = dbSlots[i].split(',');
                const { type, count } = pattern[i];
                if (type !== '?' && type !== dbType) { matched = false; break; }
                if (count !== '?' && count !== dbCount) { matched = false; break; }
            }
            if (matched) results.push(...weapons);
        }
        return results;
    }

    // ------- 表示部品 -------
    const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function renderEmpty(card, message) {
        card.className = 'bo5-scan-card bo5-state-none';
        card.innerHTML = `<div class="bo5-scan-inner"><div class="bo5-scan-empty">${escapeHtml(message)}</div></div>`;
    }

    function renderResult(card, candidates, maskedSlots) {
        const isConfirmed = candidates.length === 1;
        card.className = 'bo5-scan-card' + (isConfirmed ? ' bo5-state-confirmed bo5-scan-confirmed' : '');

        const maskLabel = maskedSlots > 0 ? `${maskedSlots} / 5 MASKED` : 'ALL VISIBLE';

        const header = isConfirmed
            ? `<div class="bo5-scan-header">
                 <span class="label">WEAPON IDENTIFIED</span>
                 <span class="bo5-scan-mask">${maskLabel}</span>
               </div>`
            : `<div class="bo5-scan-header">
                 <span class="label"><span class="bo5-scan-count">${candidates.length}</span> CANDIDATES</span>
                 <span class="bo5-scan-mask">${maskLabel}</span>
               </div>`;

        const bodyInner = candidates
            .map(w => `<span class="name">${escapeHtml(w)}</span>`)
            .join('<span class="sep">/</span>');
        const body = `<div class="bo5-scan-body">${bodyInner}</div>`;

        const copyPayload = candidates.join('|');
        const button = `
            <button type="button" class="bo5-scan-copy" data-copy="${escapeHtml(copyPayload)}">
                ${ICON_COPY}<span>COPY (regex / ${candidates.length})</span>
            </button>`;

        card.innerHTML = `<div class="bo5-scan-inner">${header}${body}${button}</div>`;
    }

    // ------- クリップボード -------
    function attachClipboard(card) {
        if (card.dataset.clipBound) return;
        card.dataset.clipBound = '1';
        card.addEventListener('click', (e) => {
            const btn = e.target.closest('.bo5-scan-copy');
            if (!btn) return;
            const text = btn.getAttribute('data-copy') || '';
            const done = () => {
                btn.classList.add('copied');
                const original = btn.innerHTML;
                btn.innerHTML = `${ICON_CHECK}<span>COPIED</span>`;
                // 再描画抑制中フラグを立てて表示を1.4秒保つ
                card.dataset.copyLock = String(Date.now() + 1400);
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = original;
                }, 1400);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => {
                    // フォールバック
                    fallbackCopy(text);
                    done();
                });
            } else {
                fallbackCopy(text);
                done();
            }
        });
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
    }

    // ------- 連勝数取得（多重防御） -------
    function getCurrentStreak() {
        // 戦略1: ラベル「現在の連勝数：N連勝中」に紐付けてページ全文から抽出（最も堅牢）
        const bodyText = document.body ? document.body.textContent : '';
        let m = bodyText.match(/現在の連勝数[：:]\s*(\d+)\s*連勝中/);
        if (m) return parseInt(m[1], 10);

        // 戦略2: span.yellow を走査し「N連勝中」を含むもの（アンカーなし＝文言ゆらぎに強い）
        const spans = document.querySelectorAll('span.yellow');
        for (const span of spans) {
            const mm = span.textContent.match(/(\d+)\s*連勝中/);
            if (mm) return parseInt(mm[1], 10);
        }
        return -1; // 取得失敗（0連勝とは区別する）
    }

    // ------- メイン -------
    function scanWeapon() {
        const streak = getCurrentStreak();

        // 連勝数が読めなかった場合：DOM未構築 or 文言変更の可能性。発動せず警告のみ。
        if (streak < 0) {
            log('連勝数を取得できませんでした（DOM未構築 or 文言変更の可能性）');
            return;
        }

        // 閾値未満は発動しない。既存カードがあれば除去。
        if (streak < STREAK_THRESHOLD) {
            log(`連勝数 ${streak} < ${STREAK_THRESHOLD} のため非発動`);
            const staleCard = document.querySelector('#weapon-scanner-result');
            if (staleCard) staleCard.remove();
            return;
        }
        log(`連勝数 ${streak} >= ${STREAK_THRESHOLD} → スキャン実行`);

        injectStyles();

        const activeEnemy = document.querySelector('.next_ch:not([style*="display: none"])');
        if (!activeEnemy) { log('next_ch（表示中）が見つかりません'); return; }

        const btset = activeEnemy.querySelector('ul.enemy_btset');
        const weaponCard = activeEnemy.querySelector('.weapon_card');
        if (!btset || !weaponCard) { log('enemy_btset または weapon_card が見つかりません', {btset:!!btset, weaponCard:!!weaponCard}); return; }

        let card = activeEnemy.querySelector('#weapon-scanner-result');
        if (!card) {
            card = document.createElement('div');
            card.id = 'weapon-scanner-result';
            card.className = 'bo5-scan-card';
            weaponCard.appendChild(card);
        }
        attachClipboard(card);

        // コピー直後の表示ロック中はスキップ
        const lock = parseInt(card.dataset.copyLock || '0', 10);
        if (lock && Date.now() < lock) return;

        // パターン収集
        const pattern = [];
        let knownSlots = 0;
        for (let i = 1; i <= 5; i++) {
            const li = btset.querySelector(`.skill_confirm${i}`);
            const slot = parseSlot(li);
            pattern.push(slot);
            if (slot.type !== '?' || slot.count !== '?') knownSlots++;
        }

        if (pattern.length < 5 || knownSlots === 0) {
            const renderKey = 'loading';
            if (card.dataset.renderKey === renderKey) return;
            card.dataset.renderKey = renderKey;
            renderEmpty(card, 'スキャン中...');
            return;
        }

        const candidates = matchWeapons(pattern);
        const maskedSlots = 5 - knownSlots;

        // 再描画スキップ用キー（候補とマスク数で識別）
        const renderKey = `${candidates.join('|')}#${maskedSlots}`;
        if (card.dataset.renderKey === renderKey) return;
        card.dataset.renderKey = renderKey;

        if (candidates.length === 0) {
            renderEmpty(card, 'NO MATCH / データベース外');
        } else {
            renderResult(card, candidates, maskedSlots);
        }
    }

    setInterval(scanWeapon, 1500);
})();