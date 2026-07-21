// ==UserScript==
// @name         BO5 短縮EQUIP + KeyWord
// @namespace    https://wdrb.work/bo5/
// @version      1.2.2
// @description  BO5のEQUIP画面を5ラウンド確認用に短縮表示し、武器アイコン一覧を武器名・IDで絞り込む。各武器アイコン左上に勝利数バッジを表示。v1.2.2: 画面下部に「入場時」「戦闘開始時」のセリフ編集欄を追加（他のセリフ項目・立ち絵設定は非表示のまま）。
// @author       ChatGPT / 統合・修正: Claude
// @match        https://wdrb.work/bo5/setup.php?btst=*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ===========================================================================
  // 設定
  // ===========================================================================
  const CONFIG = {
    // 短縮表示用CSSのID
    shortStyleId: 'bo5-short-equip-style',
    // フィルタUI
    wrapperId: 'bo5-weapon-filter-panel',
    inputId: 'bo5-weapon-filter-input',
    statusId: 'bo5-weapon-filter-status',
    filterStyleId: 'bo5-weapon-filter-style',
    listSelector: '.weapon_choice ul.battle_weapon',
    itemSelector: 'li[data-weapon]',
    // 各武器アイコン下に名前ラベルを表示するか。
    // 短縮表示では武器アイコンが44pxに固定されるため、既定では無効。
    // true にすると武器liの高さを自動に緩めてラベルを表示する。
    showWeaponNameLabels: false,

    // 各武器アイコンの左上に「勝利数」バッジを表示するか。
    // 勝利数は weapon_card 内の <small class="gray">勝利数：N</small> から取得する。
    // 例: true（表示する） / false（表示しない）
    showWinCount: true,
  };

  // ===========================================================================
  // 1) 短縮EQUIP 用CSS（document-start で即時注入：描画前に効かせて表示のチラつきを防ぐ）
  // ===========================================================================
  const SHORT_CSS = `
/* ページタイトル、戦闘設定一覧、検索欄は5R確認には不要 */
main > h2,
section.equip > h2,
section.equip > .midashi,
section.equip > details.style_list_d {
    display: none !important;
}

/* フォーム全体 */
section.equip form.setting_box {
    width: min(1120px, 94vw) !important;
    margin: 0 auto !important;
    padding-top: 0.25em !important;
    align-items: stretch !important;
}

section.equip form.setting_box > br {
    display: none !important;
}

/* 設定名まわり。現行HTMLは h4、旧版互換で h5 も見る */
section.equip .skillset_title {
    margin: 0 0 0.35em 0 !important;
    padding: 0 !important;
}

section.equip .skillset_title h4,
section.equip .skillset_title h5 {
    margin: 0 0 0.25em 0 !important;
    padding: 0.15em 0.3em !important;
}

section.equip .skillset_title input[type="text"] {
    height: 2.4em !important;
}

/* 武器選択。現行HTMLは h4、旧版互換で h5 も見る */
section.equip .weapon_choice {
    width: 100% !important;
    padding: 0.35em 0 0.25em 0 !important;
}

section.equip .weapon_choice > h4,
section.equip .weapon_choice > h5 {
    margin: 0 0 0.25em 0 !important;
    padding: 0.15em 0.3em !important;
}

section.equip .weapon_choice ul.battle_weapon {
    margin: 0.25em 0 !important;
    justify-content: flex-start !important;
}

section.equip .weapon_choice ul.battle_weapon > li {
    width: 44px !important;
    height: 44px !important;
    margin: 0 0.35em 0.35em 0 !important;
}

/* 名前ラベル表示モード時のみ、武器liの高さ固定を緩めてラベルを収める */
body.bo5wf-show-labels section.equip .weapon_choice ul.battle_weapon > li {
    width: auto !important;
    height: auto !important;
    min-width: 44px !important;
}

/* 巨大な武器詳細カードは、5R表示と重複するので隠す */
section.equip .weapon_choice > .weapon_card {
    display: none !important;
}

section.equip .weapon_choice > span,
section.equip .weapon_choice > label {
    font-size: 0.9em !important;
}

section.equip .weapon_choice input[type="text"] {
    height: 2.4em !important;
}

/* 5R本体 */
section.equip div.skillset {
    width: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 0.35em !important;
}

/* 各ラウンドを1行カード化 */
section.equip div.skillsettab.skillsetting {
    height: auto !important;
    overflow: visible !important;

    margin: 0 !important;
    padding: 0.35em 0.45em !important;
    border-radius: 3px !important;

    display: grid !important;
    grid-template-columns: max-content max-content minmax(0, 1fr) !important;
    grid-template-areas: "handle skills preview" !important;
    column-gap: 0.55em !important;
    align-items: center !important;
}

/* ラウンド見出しと余計な改行は消す */
section.equip div.skillsettab.skillsetting > h4,
section.equip div.skillsettab.skillsetting > h5,
section.equip div.skillsettab.skillsetting > br {
    display: none !important;
}

/* 技名・発動時セリフ。現行HTMLでは .form-field 化されている */
section.equip div.skillsettab.skillsetting > .form-field,
section.equip div.skillsettab.skillsetting > label,
section.equip div.skillsettab.skillsetting > .decoration_area {
    display: none !important;
}

/* 技名・セリフ用の直下spanだけ消す。グリップハンドルは残す */
section.equip div.skillsettab.skillsetting > span:not(.fa-grip-lines-vertical) {
    display: none !important;
}

/* 並び替え用ハンドル */
section.equip div.skillsettab.skillsetting > span.fa-grip-lines-vertical {
    grid-area: handle !important;

    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;

    width: 1.1em !important;
    height: 44px !important;
    margin: 0 !important;
    padding: 0 !important;

    font-size: 1em !important;
    opacity: 0.45 !important;
    cursor: grab !important;
}

section.equip div.skillsettab.skillsetting > span.fa-grip-lines-vertical:hover {
    opacity: 0.9 !important;
}

/* 左側：技アイコン列 */
section.equip div.skillsettab.skillsetting ul.battle_skill {
    grid-area: skills !important;

    margin: 0 !important;
    padding: 0 !important;

    display: flex !important;
    flex-flow: row nowrap !important;
    gap: 0.3em !important;
    align-items: center !important;
    justify-content: flex-start !important;
}

section.equip div.skillsettab.skillsetting ul.battle_skill > li {
    width: 44px !important;
    height: 44px !important;
    margin: 0 !important;
    flex: 0 0 auto !important;
    border-width: 2px !important;
}

/* checked保持用の不可視radioは絶対に表示しない */
section.equip div.skillsettab.skillsetting ul.battle_skill > li[style*="display:none"],
section.equip div.skillsettab.skillsetting ul.battle_skill > li[style*="display: none"] {
    display: none !important;
}

/* 右側：選択中スキル詳細 */
section.equip div.skillsettab.skillsetting div[class*="skill_prev"] {
    grid-area: preview !important;

    width: 100% !important;
    min-width: 0 !important;
    min-height: 44px !important;

    margin: 0 !important;
    padding: 0.42em 0.65em !important;

    display: grid !important;
    grid-template-columns: auto minmax(0, 1fr) auto !important;
    grid-template-areas:
        "num name stats"
        ".   desc stats" !important;

    column-gap: 0.35em !important;
    row-gap: 0.05em !important;
    align-items: center !important;

    background-color: #efefef10 !important;
    border-radius: 3px !important;
}

/* ラウンド番号 */
section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .numb {
    grid-area: num !important;
    width: auto !important;
    margin: 0 !important;
    white-space: nowrap !important;
    font-weight: 700 !important;
}

/* 技名 */
section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_name {
    grid-area: name !important;
    width: auto !important;
    margin: 0 !important;

    display: inline-flex !important;
    align-items: center !important;

    min-width: 0 !important;
    overflow: hidden !important;
}

section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_name img {
    width: 1.2em !important;
    height: 1.2em !important;
    margin: 0 0.2em 0 0 !important;
    flex: 0 0 auto !important;
}

section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_name b {
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;

    font-size: 1.25em !important;
    line-height: 1.15 !important;
}

/* ATK / DEF / 使用回数 */
section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_stuts {
    grid-area: stats !important;
    justify-self: end !important;

    margin: 0 !important;
    display: inline-flex !important;
    align-items: center !important;
    white-space: nowrap !important;
}

section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_stuts img {
    width: 1.1em !important;
    height: 1.1em !important;
    margin: 0 0.15em 0 0.5em !important;
}

section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_stuts b {
    min-width: 1.8em !important;
    width: auto !important;
    display: inline-block !important;
    font-size: 1.15em !important;
}

/* 技説明 */
section.equip div.skillsettab.skillsetting div[class*="skill_prev"] p {
    grid-area: desc !important;

    width: auto !important;
    margin: 0 !important;
    font-size: 0.72em !important;
    line-height: 1.25 !important;
}

/* 戦闘中セリフ設定・立ち絵設定は戦術確認では不要 */
section.equip div.skillsettab.skillset_serif,
section.equip div.skillsettab.skillset_image {
    display: none !important;
}

/* 確認欄の武器カードは上の5R表示と重複するので隠す。保存UIは残す */
section.equip .skillset_confirm {
    margin-top: 0.4em !important;
    padding: 0.35em 0 0 !important;
}

section.equip .skillset_confirm > h4,
section.equip .skillset_confirm > h5,
section.equip .skillset_confirm > br,
section.equip .skillset_confirm > .weapon_card {
    display: none !important;
}

section.equip .skillset_confirm > label {
    display: inline-flex !important;
    align-items: center !important;
    margin: 0.2em 0.8em 0.2em 0 !important;
}

section.equip .skillset_confirm select.select-dark {
    height: 2.2em !important;
    padding: 0.15em 0.4em !important;
}

/* 保存ボタン周り */
section.equip .skillset_submit {
    margin: 0.45em 0 0 0 !important;
    display: flex !important;
    flex-flow: row wrap !important;
    justify-content: flex-start !important;
    gap: 0.5em !important;
}

section.equip .skillset_submit label {
    margin: 0 !important;
}

section.equip .skillset_submit input {
    padding: 0.65em 1.4em !important;
}

/* 戻るリンク */
section.equip .sort_link {
    margin-top: 0.75em !important;
    text-align: center !important;
}

/* 狭い画面では縦積みに戻す */
@media only screen and (max-width: 760px) {
    section.equip form.setting_box {
        width: 96vw !important;
    }

    section.equip div.skillsettab.skillsetting {
        grid-template-columns: max-content minmax(0, 1fr) !important;
        grid-template-areas:
            "handle skills"
            "handle preview" !important;

        row-gap: 0.35em !important;
        column-gap: 0.45em !important;
        padding: 0.45em !important;
    }

    section.equip div.skillsettab.skillsetting > span.fa-grip-lines-vertical {
        height: 100% !important;
        min-height: 44px !important;
    }

    section.equip div.skillsettab.skillsetting ul.battle_skill {
        overflow-x: auto !important;
        padding-bottom: 0.15em !important;
    }

    section.equip div.skillsettab.skillsetting ul.battle_skill > li {
        width: 40px !important;
        height: 40px !important;
    }

    section.equip div.skillsettab.skillsetting div[class*="skill_prev"] {
        grid-template-columns: auto minmax(0, 1fr) !important;
        grid-template-areas:
            "num name"
            "stats stats"
            "desc desc" !important;
    }

    section.equip div.skillsettab.skillsetting div[class*="skill_prev"] .skill_stuts {
        justify-self: start !important;
    }

    section.equip .skillset_confirm > label {
        display: flex !important;
        width: 100% !important;
        margin-right: 0 !important;
    }
}

/* =========================================================================
   追加（v1.2.1ベース）：画面下部に「入場時」「戦闘開始時」のセリフ編集欄を出す。
   上の「セリフ全消し（skillset_serif を display:none）」を、この2項目だけ解除する。
   立ち絵設定（skillset_image）は隠したまま。
   ========================================================================= */

/* セリフ設定パネル自体は表示に戻す */
section.equip div.skillsettab.skillset_serif {
    display: block !important;
    width: min(1120px, 94vw) !important;
    margin: 0.6em auto 0 !important;
    padding: 0.6em 0.8em !important;
    border: 1px solid rgba(255,255,255,0.18) !important;
    border-radius: 8px !important;
    background: rgba(0,0,0,0.12) !important;
}

section.equip div.skillsettab.skillset_serif > h5 {
    display: block !important;
    margin: 0 0 0.6em 0 !important;
    padding: 0 !important;
    font-size: 1.05em !important;
}

/* パネル内の各セリフ項目は既定で隠し、対象2項目だけ表示する */
section.equip div.skillsettab.skillset_serif > .form-field {
    display: none !important;
}

section.equip div.skillsettab.skillset_serif > .form-field:has(textarea[name="serif_entry"]),
section.equip div.skillsettab.skillset_serif > .form-field:has(textarea[name="serif_start"]) {
    display: block !important;
    width: 100% !important;
    margin: 0 0 1em 0 !important;
    padding: 0.6em 0.7em !important;
    border: 1px solid rgba(255,255,255,0.14) !important;
    border-radius: 6px !important;
    background: rgba(255,255,255,0.04) !important;
}

/* 項目ラベル（「入場時」「戦闘開始時」） */
section.equip div.skillsettab.skillset_serif > .form-field > span {
    display: block !important;
    margin: 0 0 0.35em 0 !important;
    font-weight: 700 !important;
    font-size: 0.95em !important;
}

section.equip div.skillsettab.skillset_serif > .form-field > label {
    display: block !important;
    margin: 0 !important;
}

section.equip div.skillsettab.skillset_serif > .form-field textarea {
    width: 100% !important;
    min-height: 5.5em !important;
    padding: 0.5em 0.6em !important;
    line-height: 1.5 !important;
    resize: vertical !important;
}

/* 装飾ツールバー（[ic]・太字など）は対象項目で使えるよう表示 */
section.equip div.skillsettab.skillset_serif > .form-field > .decoration_area {
    display: flex !important;
    flex-wrap: wrap !important;
    margin: 0.4em 0 0 0 !important;
    padding: 0 !important;
}

/* 保存済みプレビュー（.serif）は確認用に表示 */
section.equip div.skillsettab.skillset_serif > .form-field > .serif {
    display: flex !important;
    align-items: center !important;
    gap: 0.4em !important;
    margin: 0.5em 0 0 0 !important;
    padding: 0.35em 0.5em !important;
    border-radius: 4px !important;
    background: rgba(0,0,0,0.18) !important;
    font-size: 0.85em !important;
    opacity: 0.9 !important;
}

section.equip div.skillsettab.skillset_serif > .form-field > .serif img {
    width: 1.6em !important;
    height: 1.6em !important;
    flex: 0 0 auto !important;
    border-radius: 3px !important;
}

section.equip div.skillsettab.skillset_serif > .form-field > .serif p {
    margin: 0 !important;
}
`;

  // ===========================================================================
  // 2) 武器キーワード絞り込み 用CSS
  // ===========================================================================
  const FILTER_CSS = `
    #${CONFIG.wrapperId} {
      margin: 0.5em 0 0.6em;
      padding: 0.6em 0.7em;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      background: rgba(0,0,0,0.16);
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }

    #${CONFIG.wrapperId} .bo5wf-row {
      display: flex;
      gap: 0.5em;
      align-items: center;
      flex-wrap: wrap;
    }

    #${CONFIG.inputId} {
      flex: 1 1 16em;
      min-width: 12em;
      height: 2.7em;
      padding: 0.45em 0.75em;
      border: 1px solid rgba(255,255,255,0.26);
      border-radius: 8px;
      background: rgba(255,255,255,0.92);
      color: #111;
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }

    #${CONFIG.inputId}:focus {
      border-color: #DB99FF;
      box-shadow: 0 0 0 2px rgba(219,153,255,0.28);
    }

    #${CONFIG.wrapperId} button {
      height: 2.7em;
      padding: 0 0.9em;
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 8px;
      background: rgba(255,255,255,0.12);
      color: inherit;
      font-family: inherit;
      cursor: pointer;
    }

    #${CONFIG.wrapperId} button:hover {
      background: rgba(255,255,255,0.22);
    }

    #${CONFIG.statusId} {
      margin-top: 0.45em;
      font-size: 12px;
      opacity: 0.82;
    }

    .bo5wf-name-label {
      display: block;
      margin-top: 0.2em;
      max-width: 5.8em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      line-height: 1.2;
      text-align: center;
      opacity: 0.86;
      pointer-events: none;
    }

    .bo5wf-hidden {
      display: none !important;
    }

    /* 勝利数バッジを乗せるため、武器liを位置基準にする */
    section.equip .weapon_choice ul.battle_weapon > li[data-weapon] {
      position: relative !important;
      overflow: visible !important;
    }

    /* 各武器アイコン左上の勝利数バッジ。
       暗い半透明ピル＋明るい金色で、アイコンの明暗どちらでも読めるようにする */
    .bo5wf-win-badge {
      position: absolute;
      top: 1px;
      left: 1px;
      z-index: 6;
      box-sizing: border-box;
      min-width: 16px;
      height: 15px;
      padding: 0 4px;
      border-radius: 8px;
      background: rgba(15,15,18,0.86);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.45);
      color: #FFD24A;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      font-size: 10px;
      font-weight: 700;
      line-height: 15px;
      letter-spacing: 0.02em;
      text-align: center;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }

    .bo5wf-selected {
      outline: 2px solid #DB99FF;
      outline-offset: 2px;
      border-radius: 8px;
    }
  `;

  // ===========================================================================
  // 共通ユーティリティ
  // ===========================================================================
  const injectStyle = (id, cssText) => {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  };

  const katakanaize = (text) =>
    text.replace(/[\u3041-\u3096]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60)
    );

  const normalize = (value) => {
    return katakanaize(String(value ?? ''))
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‐‑‒–—―ーｰ-]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const compact = (value) =>
    normalize(value).replace(/[\s・･_.:/\\[\]（）()【】「」『』"'`]/g, '');

  // ===========================================================================
  // 武器フィルタ本体
  // ===========================================================================
  const collectItemInfo = (li) => {
    const weaponId = li.dataset.weapon || '';
    const input = li.querySelector('input[name="w_id"]');
    const name = li.getAttribute('data-tippy-content') || input?.value || weaponId;

    // 検索対象は「武器名（data-tippy-content）」と「武器ID」のみ。
    // 技名・説明・タグを含む武器カードのテキストは、ノイズになるため対象外。
    const searchable = [weaponId, input?.value, name].filter(Boolean).join(' ');

    li.dataset.bo5wfName = name;
    li.dataset.bo5wfSearch = normalize(searchable);
    li.dataset.bo5wfCompact = compact(searchable);

    // 名前ラベル（短縮表示と両立しないため既定では生成しない）
    if (CONFIG.showWeaponNameLabels && !li.querySelector('.bo5wf-name-label')) {
      const label = document.createElement('span');
      label.className = 'bo5wf-name-label';
      label.textContent = name;
      li.appendChild(label);
    }

    li.setAttribute('title', `${name} / ${weaponId}`);
    return li;
  };

  const createPanel = () => {
    const panel = document.createElement('div');
    panel.id = CONFIG.wrapperId;
    panel.innerHTML = `
      <div class="bo5wf-row">
        <input id="${CONFIG.inputId}" type="search" autocomplete="off"
          placeholder="武器名・IDで絞り込み　例：レイピア / rapier">
        <button type="button" data-bo5wf-action="clear">クリア</button>
      </div>
      <div id="${CONFIG.statusId}">検索準備中</div>
    `;
    return panel;
  };

  const markSelected = (items) => {
    for (const li of items) {
      const input = li.querySelector('input[name="w_id"]');
      li.classList.toggle('bo5wf-selected', Boolean(input?.checked));
    }
  };

  const selectItem = (li, items) => {
    if (!li) return;

    const input = li.querySelector('input[name="w_id"]');
    if (!input) return;

    input.click();
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    li.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

    markSelected(items);
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ===========================================================================
  // 勝利数バッジ
  // ===========================================================================
  // weapon_card（short CSSで display:none だがDOMには残る）から
  // 「weapon ID → 勝利数」のマップを作る。
  const buildWinCountMap = (scope) => {
    const map = new Map();
    const root = scope || document;
    const cards = root.querySelectorAll('.weapon_card[data-weapon-card]');

    for (const card of cards) {
      const id = card.getAttribute('data-weapon-card');
      if (!id) continue;

      // 「勝利数：590」等。全角数字も拾えるよう NFKC 後に数字抽出する。
      const text = (card.textContent || '').normalize('NFKC');
      const m = text.match(/勝利数\s*[:：]\s*([0-9]+)/);
      if (m) map.set(id, m[1]);
    }
    return map;
  };

  const decorateWinCounts = (items, winMap) => {
    for (const li of items) {
      const id = li.dataset.weapon;
      const win = id ? winMap.get(id) : undefined;
      if (win === undefined) continue;

      let badge = li.querySelector('.bo5wf-win-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bo5wf-win-badge';
        li.appendChild(badge);
      }
      badge.textContent = win;
      badge.setAttribute('title', `勝利数：${win}`);
    }
  };

  const installFilter = () => {
    if (document.getElementById(CONFIG.wrapperId)) return;

    const list = document.querySelector(CONFIG.listSelector);
    if (!list) return;

    const weaponChoice = list.closest('.weapon_choice') || list.parentElement;
    if (!weaponChoice) return;

    const items = Array.from(list.querySelectorAll(CONFIG.itemSelector)).map(collectItemInfo);
    if (items.length === 0) return;

    // 各武器アイコンの左上に勝利数バッジを付与
    if (CONFIG.showWinCount) {
      decorateWinCounts(items, buildWinCountMap(weaponChoice.closest('section.equip') || document));
    }

    // ラベル表示モードのときだけ、武器liの高さ固定を緩めるクラスを付与
    if (CONFIG.showWeaponNameLabels) {
      document.body.classList.add('bo5wf-show-labels');
    }

    injectStyle(CONFIG.filterStyleId, FILTER_CSS);

    const panel = createPanel();
    weaponChoice.insertBefore(panel, list);

    const input = panel.querySelector(`#${CONFIG.inputId}`);
    const status = panel.querySelector(`#${CONFIG.statusId}`);
    const clearButton = panel.querySelector('[data-bo5wf-action="clear"]');

    const getVisibleItems = () => items.filter((li) => !li.classList.contains('bo5wf-hidden'));

    const applyFilter = () => {
      const rawQuery = input.value;
      const tokens = normalize(rawQuery).split(/\s+/).filter(Boolean);
      const compactTokens = tokens.map(compact).filter(Boolean);

      let visible = 0;

      for (const li of items) {
        const haystack = li.dataset.bo5wfSearch || '';
        const compactHaystack = li.dataset.bo5wfCompact || '';
        const matched =
          tokens.length === 0 ||
          tokens.every((token, index) => {
            const compactToken = compactTokens[index] || compact(token);
            return haystack.includes(token) || compactHaystack.includes(compactToken);
          });

        li.classList.toggle('bo5wf-hidden', !matched);
        if (matched) visible += 1;
      }

      const total = items.length;
      const selected = items.find((li) => li.querySelector('input[name="w_id"]')?.checked);
      const selectedName = selected?.dataset.bo5wfName
        ? ` / 選択中：${selected.dataset.bo5wfName}`
        : '';
      status.textContent = `${visible} / ${total} 件表示${selectedName}`;
      markSelected(items);
    };

    input.addEventListener('input', applyFilter);

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();

      const visibleItems = getVisibleItems();
      if (visibleItems.length === 1) {
        selectItem(visibleItems[0], items);
      }
    });

    list.addEventListener('change', (event) => {
      if (event.target?.matches?.('input[name="w_id"]')) {
        markSelected(items);
        applyFilter();
      }
    });

    clearButton.addEventListener('click', () => {
      input.value = '';
      input.focus();
      applyFilter();
    });

    applyFilter();
  };

  // ===========================================================================
  // ブートストラップ
  // ===========================================================================

  // 短縮CSSは描画前に効かせたいので、ここで即時注入する（document-start）。
  injectStyle(CONFIG.shortStyleId, SHORT_CSS);

  // 追加：入場時・戦闘開始時のセリフ欄を下部に表示する。
  // CSSの :has() で対象2項目を出しているが、:has 非対応環境では対象まで隠れるため、
  // JS側でも対象 textarea を持つ form-field を強制表示する保険を入れる。
  const SERIF_TARGET_NAMES = ['serif_entry', 'serif_start'];

  const revealSerifFields = () => {
    const panel = document.querySelector('section.equip div.skillsettab.skillset_serif');
    if (!panel) return;

    const fields = panel.querySelectorAll(':scope > .form-field');
    if (fields.length === 0) return;

    // パネル本体と見出しも明示的に表示に戻す（CSS未適用タイミングの保険）
    panel.style.setProperty('display', 'block', 'important');

    for (const field of fields) {
      const ta = field.querySelector('textarea[name]');
      const name = ta ? ta.getAttribute('name') : '';
      const keep = SERIF_TARGET_NAMES.includes(name);
      field.style.setProperty('display', keep ? 'block' : 'none', 'important');
    }
  };

  // フィルタはDOMが揃ってから組み立てる。
  const bootFilter = () => {
    installFilter();
    revealSerifFields();

    // BO5側の描画タイミングが遅い／後から再描画される場合の保険。
    const root = document.body || document.documentElement;
    const observer = new MutationObserver(() => {
      if (
        !document.getElementById(CONFIG.wrapperId) &&
        document.querySelector(CONFIG.listSelector)
      ) {
        installFilter();
      }
      revealSerifFields();
    });
    observer.observe(root, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootFilter, { once: true });
  } else {
    bootFilter();
  }
})();