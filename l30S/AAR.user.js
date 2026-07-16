// ==UserScript==
// @name         BO5 AAR
// @namespace    bo5.aracade.aa
// @version      5.9.0
// @description  BO5 Season 2 Arcade Auto Runner。NPC別最善手を自動適用し、対戦は画面遷移せず fetch 送信。勝敗は battle_lobby の div.bet（BATTLE @）差分で判定。
// @author       ネオたかしMk-II
// @match        https://wdrb.work/bo5/battle_lobby.php*
// @match        https://wdrb.work/bo5/setup.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

// ===== 設計概要（改修者向け。読めば誤解しない） =====
// ■ 対戦フロー（v5.8.0〜：常時 fetch・battle_view.php を一切踏まない）
//   1. lobby でターゲットNPCと最善手 style を選び、FIELD SETTING 終了＋DDoS待機後、
//      arcade フォームを fetch で POST（btn.click() による battle_view.php 遷移はしない）。
//      送信直前に div.bet の「BATTLE N」を prev_battle_no へ保存し、phase='await_result' にして
//      battle_lobby.php を再読込する。対戦武器(和名)は CHALLENGE START 時に run_weapon へ保存済み。
//   2. 再読込後、phase==='await_result' なら resolveFetchedBattle() が div.bet 差分で勝敗確定：
//        ラン継続 & BATTLE@ 増   → 勝（run_weapon を +1）
//        ラン継続 & BATTLE@ 不変 → 引分（仕様確定。加算なし）
//        ラン消滅（div.bet/NPC 無し）→ 敗北 or 100連勝完走（どちらもラン終了）。
//          fetch 経路では両者を div.bet で区別できないが区別不要：
//            ・UNMELCTO 武器の完走は次 CHALLENGE START の data-cleared-hundred で判定する
//            ・通常武器の勝利数は次 setup の extractAndStoreWins で再同期される
// ■ WIN_UNMELCTO（武器・和名リスト）
//   記載武器は累計勝利上限(WIN_LIMIT/WIN_LIMIT_OVERRIDE)を無視し、100連勝(HUNDRED COMPLETE)
//   するまで挑戦を続ける。完走判定は CHALLENGE START 画面の li[data-cleared-hundred="1"]
//   （キーは和名＝data-tippy-content）。新ラン開始時、未完走(=0)の UNMELCTO 武器をリスト順に
//   優先選択。全完走なら通常の500グラインドへフォールバック。
// ■ リタイア
//   通常(非UNMELCTO)武器が累計上限に到達したら、進行中ランをリタイアして停止する（旧挙動踏襲）。
// ■ SEASONAL_02（ARCADE MODE「SEASONAL -2-」対応。v5.9.0〜）
//   SEASONAL_02_ENABLED=true のとき、SEASONAL_02_WEAPONS（空なら画面上の全武器）を
//   リスト順に、CHALLENGE START画面(=ARCADE MODE武器選択リスト)の
//   li[data-cleared-seasonal_02="1"] になるまで挑戦し続ける（クリア条件自体はゲーム側判定に
//   従うため未知。フラグが立つまで再挑戦を繰り返す設計はWIN_UNMELCTOと同じ）。
//   1武器クリアしたら次の武器へ進み、リスト内が全てクリア済みになったら通常のWIN_UNMELCTO／
//   累計勝利グラインド(HUNDREDモード)へフォールスルーする。
//   優先度は fixed_weapon（手動ピン）の次・WIN_UNMELCTOより前。
//   累計勝利上限(WIN_LIMIT)によるリタイア判定はSEASONAL_02ラン中は適用しない
//   （seasonal_02は勝利数ではなくクリアフラグで完了を判定するため）。
// ====================================================

(() => {
  'use strict';

  function expandDelays(pairs) {
    const out = [];
    for (let i = 0; i < pairs.length; i += 2) {
      for (let j = 0; j < pairs[i + 1]; j++) out.push(pairs[i]);
    }
    return out;
  }

  const CFG = {
    KEY: 'bo5_arcade_auto_best_move_s2_layout2:',
    LOBBY_URL: 'https://wdrb.work/bo5/battle_lobby.php?mode=arcade',
    SETUP_URL: 'https://wdrb.work/bo5/setup.php?btst=8',
    SHORT_DELAY_MS: 1000,
    // fetch 送信失敗時の再試行（旧 BATTLE START 遷移リトライから転用）
    BATTLE_START_RECHECK_MS: 3000,
    BATTLE_START_MAX_RETRIES: 3,
    // FIELD SETTING ポーリング設定
    FIELD_SETTING_POLL_MS: 500,
    FIELD_SETTING_MAX_WAIT_MS: 20000,
    // FIELD SETTING 終了後、fetch 送信までの追加待機（ここで対DDoS間隔を設定）
    // [値, 出現回数, 値, 出現回数, ...] の交互配列。同じ値を多く書くほど出やすい。
    POST_FIELD_SETTING_DELAYS_MS: expandDelays([0,3, 1000,3, 2000,3, 3000,3, 4000,3, 5000,3, 6000,3, 7000,1, 8000,1, 9000,1, 13000,1, 17000,1]), //, 7000,3, 8000,1, 9000,1, 13000,1, 17000,1, 19000,1, 23000,1
    UI_ID: 'bo5-auto-bestmove-panel',
  };

  // lobby の武器アイコン(w_*.svg)スラッグ → 和名。
  // ※ CHALLENGE START 画面(ul.battle_weapon)の data-weapon とは表記系統が異なるので注意。
  //    武器の照合は基本 data-tippy-content（和名）で行うこと。
  const SLUG_TO_NAME = {
    "bamboo": "竹槍", "bar": "バール", "bat": "バット", "batteringram": "バッティングラム",
    "battleaxe": "バトルアックス", "bayonet": "銃剣", "beamsaber": "ビームサーベル",
    "bible": "バイブル", "bladeshoes": "ブレイドシューズ", "bokusowa": "卜ソワァ―",
    "bottle": "酒瓶", "briefcase": "ブリーフケース", "broadsword": "ブロードソード",
    "chainsaw": "チェーンソー", "clawfang": "クローファング", "club": "棍棒",
    "coilsword": "コイルソード", "crossspear": "十文字槍", "cutlass": "カットラス",
    "dagger": "ダガー", "deathhoop": "輪刀", "drillspear": "ドリルスピア",
    "dualsword": "長短対剣", "estoc": "エストック", "exesword": "エクセキューター",
    "fist": "徒手空拳", "flagspear": "旗槍", "flail": "フレイル", "flamberge": "蛇行剣",
    "flypan": "フライパン", "gigantarm": "ギガントアーム", "girocchin": "ギロッチン",
    "golfclub": "ゴルフクラブ", "gradius": "グラディウス", "greatsword": "グレートソード",
    "guandao": "偃月刀", "halberd": "ハルバード", "hammer": "ウォーハンマー",
    "ironfan": "鉄扇", "jamadahar": "ジャマダハル", "jitte": "十手",
    "karambit": "カランビット", "katana2": "打刀", "katzbalger": "カッツバルゲル",
    "khopesh": "ケペシュ", "kitchenknife": "包丁", "knuckleduster": "ナックルダスター",
    "kusarigama": "鎖鎌", "lance": "ランス", "mace": "メイス", "machete": "マチェット",
    "magicwand": "マジックワンド", "megaphone": "メガホン", "miaodao": "苗刀",
    "naginata": "薙刀", "net": "網", "oodachi": "大太刀", "pipe": "鉄パイプ",
    "pocketknife": "ポケットナイフ", "rapier": "レイピア", "roundshield": "ラウンドシールド",
    "sai": "サイ", "sawblade": "ソーブレイド", "scissorblade": "シザーズブレイド",
    "scythe": "サイス", "shakujo": "大錫杖", "shamshir": "シャムシール", "shotel": "ショーテル",
    "shovel": "シャベル", "snakesword": "連接剣", "spear": "スピア",
    "spikeshield": "スパイクシールド", "staff": "棒", "steelwire": "鋼糸", "stick": "ステッキ",
    "stiletto": "スティレット", "stunrod": "スタンロッド", "sword": "ロングソード",
    "taichisword": "太極剣", "tekkokagi": "手甲鉤", "threesetsukon": "多節棍",
    "tonfa": "トンファー", "trident": "トライデント", "triggerblade": "トリガーブレイド",
    "twinhatchet": "ツインハチェット", "twinsword": "双剣", "twobladed": "ツーブレイデッド",
    "umbrella": "アンブレラ", "vajra": "金剛杵", "whip": "ウィップ", "yoyo": "バトルヨーヨー",
    "zaghnal": "ウォーピック",
  };

  // === WIN_UNMELCTO：100連勝(HUNDRED COMPLETE)するまで挑戦を続ける武器（和名） ===
  // ・記載武器は累計勝利上限(WIN_LIMIT/WIN_LIMIT_OVERRIDE)を無視し、完走するまで回し続ける。
  // ・完走済み(CHALLENGE START 画面で li[data-cleared-hundred="1"])になった武器は自動スキップ。
  // ・キーは CHALLENGE START 画面の data-tippy-content（和名）と完全一致させること。
  //   ※ data-weapon(スラッグ)は画面間で表記が異なるため、必ず和名で書く。
  // ・区切りは半角カンマ＋半角クォート。全角カンマ「、」やクォート無しは無効。
  //   例（空）       : const WIN_UNMELCTO = [];
  //   例（指定あり） : const WIN_UNMELCTO = ["網", "手甲鉤", "旗槍"];
  const WIN_UNMELCTO = ["手甲鉤"];

  // === SEASONAL_02：ARCADE MODE「SEASONAL -2-」を消化する設定 ===
  // ・true にすると、SEASONAL_02_WEAPONS に挙げた武器を上から順に、data-cleared-seasonal_02="1"
  //   になるまで（＝クリアフラグが立つまで）挑戦し続ける。1つクリアしたら次の武器へ自動で進む。
  // ・false にすると本機能は無効化され、従来どおりWIN_UNMELCTO／HUNDREDグラインドのみで動く。
  //   例: const SEASONAL_02_ENABLED = false;
  const SEASONAL_02_ENABLED = true;

  // ・空配列 [] を指定した場合は「ARCADE MODEの武器選択リストに表示されている全武器」を
  //   画面表示順（DOM順）で対象にする（＝依頼どおり「このモードの全武器」を回す既定動作）。
  // ・武器名を指定した場合は、その武器・その順番だけを対象にする（全武器を回したくない場合用）。
  // ・キーは CHALLENGE START 画面の data-tippy-content（和名）と完全一致させること。
  //   ※ data-weapon(スラッグ)は画面間で表記が異なるため、必ず和名で書く。
  // ・区切りは半角カンマ＋半角クォート。全角カンマ「、」やクォート無しは無効。
  //   例（全武器が対象・既定）: const SEASONAL_02_WEAPONS = [];
  //   例（一部武器のみ指定）  : const SEASONAL_02_WEAPONS = ["網", "手甲鉤", "旗槍"];
  const SEASONAL_02_WEAPONS = ["ポケットナイフ","旗槍","手甲鉤","ソーブレイド"];

  const WIN_STORAGE_KEY   = 'bo5_weapon_wins';
  const WIN_LIMIT_DEFAULT = 500;
  const WIN_LIMIT_OVERRIDE = {
    'bokusowa':  1001,
    '卜ソワァ―': 1001,
  };

  function getWeaponWins() {
    try {
      const raw = localStorage.getItem(WIN_STORAGE_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
      console.warn('[BO5 AAR] 勝利数データの読み込みに失敗:', e);
      return {};
    }
  }

  function extractAndStoreWins() {
    try {
      const cards = qa(document, 'div.weapon_card[data-weapon-card]');
      if (cards.length === 0) return false;

      const map = {};
      let n = 0;
      for (const card of cards) {
        const id   = String(card.dataset.weaponCard || '').trim();
        const desc = q(card, '.weapon_desc');
        if (!desc) continue;

        let wins = null;
        for (const s of qa(desc, 'small.gray')) {
          const m = s.textContent.match(/勝利数[：:]\s*(-?\d+)/);
          if (m) { wins = parseInt(m[1], 10); break; }
        }
        if (wins == null) continue;

        const name = text(q(desc, 'b.large')) || text(q(card, 'b.large'));
        if (id)   map[id]   = wins;
        if (name) map[name] = wins;
        n++;
      }

      if (n === 0) return false;
      localStorage.setItem(WIN_STORAGE_KEY, JSON.stringify(map));
      console.log(`[BO5 AAR] 勝利数 ${n} 件を localStorage["${WIN_STORAGE_KEY}"] に更新`);
      return true;
    } catch (e) {
      console.warn('[BO5 AAR] 勝利数の抽出に失敗:', e);
      return false;
    }
  }

  function weaponKeysFromLi(li, japaneseName) {
    const keys = [];
    const radio = li && li.querySelector('input[type="radio"]');
    if (radio && radio.value) keys.push(String(radio.value));
    if (li && li.dataset && li.dataset.weapon) keys.push(String(li.dataset.weapon));
    if (japaneseName) keys.push(String(japaneseName));
    return keys;
  }

  function winLimitForKeys(keys) {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(WIN_LIMIT_OVERRIDE, k)) return WIN_LIMIT_OVERRIDE[k];
    }
    return WIN_LIMIT_DEFAULT;
  }

  function winsForKeys(winData, keys) {
    for (const k of keys) {
      if (winData[k] != null) return Number(winData[k]);
    }
    return null;
  }

  function gmGet(name, fallback) { return GM_getValue(CFG.KEY + name, fallback); }
  function gmSet(name, value)    { GM_setValue(CFG.KEY + name, value); }
  function gmDel(name)           { GM_deleteValue(CFG.KEY + name); }

  function isReversed()   { return !!gmGet('sort_reversed', false); }
  function setReversed(v) { gmSet('sort_reversed', !!v); }
  function isEnabled()      { return !!gmGet('enabled', false); }
  function setEnabled(v)    { gmSet('enabled', !!v); }
  function getPhase()       { return gmGet('phase', 'idle'); }
  function setPhase(v)      { gmSet('phase', v || 'idle'); }
  function getTarget()      { return gmGet('target', null); }
  function setTarget(v)     { gmSet('target', v); }
  function clearTarget()    { gmDel('target'); }
  function getFixedWeapon() { return gmGet('fixed_weapon', null) || null; }
  function setFixedWeapon(v){ v ? gmSet('fixed_weapon', v) : gmDel('fixed_weapon'); }

  function q(root, selector)  { return (root || document).querySelector(selector); }
  function qa(root, selector) { return Array.from((root || document).querySelectorAll(selector)); }
  function text(el)           { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }
  function clickElement(el)   { if (!el || typeof el.click !== 'function') return false; el.click(); return true; }

  let scheduled = false;

  function installPanel() {
    if (document.getElementById(CFG.UI_ID)) return;
    const panel = document.createElement('div');
    panel.id = CFG.UI_ID;
    panel.innerHTML = `
      <button type="button" data-role="toggle"></button>
      <button type="button" data-role="reverse"></button>
      <div data-role="status"></div>
      <div data-role="detail"></div>
    `;
    Object.assign(panel.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
      width: '280px', padding: '10px 12px', borderRadius: '10px',
      background: 'rgba(20,20,24,0.92)', color: '#f4f4f4',
      fontSize: '12px', lineHeight: '1.5', boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    });
    const btn = q(panel, '[data-role="toggle"]');
    Object.assign(btn.style, {
      width: '100%', padding: '7px 8px', marginBottom: '4px', border: '0', borderRadius: '8px',
      cursor: 'pointer', fontWeight: '700', color: '#111',
    });
    const revBtn = q(panel, '[data-role="reverse"]');
    Object.assign(revBtn.style, {
      width: '100%', padding: '5px 8px', marginBottom: '7px', border: '0', borderRadius: '8px',
      cursor: 'pointer', fontWeight: '600', color: '#111', fontSize: '11px',
    });
    revBtn.addEventListener('click', () => { setReversed(!isReversed()); refreshReverseBtn(); });
    btn.addEventListener('click', () => {
      const next = !isEnabled();
      setEnabled(next);
      if (next) {
        if (currentPage() === 'lobby') setPhase('choose_pending');
        updatePanel('ON', '起動しました。', '現在ページの状態を確認します。');
        scheduled = false;
        main();
      } else {
        setPhase('idle');
        clearTarget();
        updatePanel('OFF', '停止しました。', '自動操作は行いません。');
      }
    });
    document.body.appendChild(panel);
    refreshToggle();
    refreshReverseBtn();
  }

  function refreshReverseBtn() {
    const panel = document.getElementById(CFG.UI_ID);
    if (!panel) return;
    const btn = q(panel, '[data-role="reverse"]');
    const rev = isReversed();
    btn.textContent      = rev ? '対戦順：敗北率 昇順（低い順）' : '対戦順：敗北率 降順（高い順）';
    btn.style.background = rev ? '#FFD580' : '#b0d4ff';
  }

  function refreshToggle() {
    const panel = document.getElementById(CFG.UI_ID);
    if (!panel) return;
    const btn = q(panel, '[data-role="toggle"]');
    const on  = isEnabled();
    btn.textContent      = on ? 'BO5 AAR：ON' : 'BO5 AAR：OFF';
    btn.style.background = on ? '#9DFF9D' : '#ddd';
  }

  function updatePanel(mode, status, detail) {
    refreshToggle();
    const panel = document.getElementById(CFG.UI_ID);
    if (!panel) return;
    q(panel, '[data-role="status"]').textContent = status || '';
    q(panel, '[data-role="detail"]').innerHTML   = detail || '';
    if (mode) q(panel, '[data-role="toggle"]').textContent = `BO5 AAR：${mode}`;
  }

  function stop(reason) {
    setPhase('idle');
    clearTarget();
    updatePanel('ON', reason || '停止（継続モード）', '処理は停止しましたが機能はONのまま維持されます');
  }

  function schedule(label, ms, fn) {
    if (scheduled) return;
    scheduled = true;
    const sec = Math.round(ms / 1000);
    updatePanel('ON', `${label}：${sec}秒待機`, 'DDoS対策のため、待機を挟みます。');
    window.setTimeout(() => {
      scheduled = false;
      if (!isEnabled()) return;
      try { fn(); } catch (e) {
        console.error(e);
        updatePanel('ON', '例外発生（継続）', String(e?.message || e));
      }
    }, ms);
  }

  function currentPage() {
    const path = location.pathname;
    if (path.endsWith('/battle_lobby.php')) return 'lobby';
    if (path.endsWith('/setup.php'))        return 'setup';
    return 'other';
  }

  function getArcadeForm() {
    return q(document, 'form#btlb_form_arcade');
  }

  function isFieldSettingActive(form) {
    const btn = getStartButton(form);
    if (!btn) return false;
    const val = String(btn.value || '').trim();
    if (btn.disabled) return true;
    if (/FIELD\s*SETTING/i.test(val) || /sec\s*LEFT/i.test(val)) return true;
    return false;
  }

  function getStartButton(form) {
    return q(form || document, 'input[name="bt_start"], input.bt_start, input[type="submit"][name="bt_start"]')
        || q(form || document, 'input.bt_start')
        || q(form || document, 'input[type="submit"]');
  }

  function getWeaponNameFromSlug(li) {
    const img = li && li.querySelector('img');
    if (!img) return '';
    const m = (img.src || img.getAttribute('src') || '').match(/\/w_([^./]+)\.svg/);
    if (!m) return '';
    return SLUG_TO_NAME[m[1]] || '';
  }

  function getWeaponNameFromLobby(form, styleId) {
    const card = qa(form || document, 'div.weapon_card[data-style]')
      .find(c => String(c.dataset.style) === String(styleId));
    if (card) {
      const name = text(q(card, '.weapon_desc b.large')) || text(q(card, 'b.large')) || text(q(card, 'b'));
      if (name) return name;
    }
    const li = qa(form || document, 'ul.battle_style li[data-style]')
      .find(l => String(l.dataset.style) === String(styleId));
    return getWeaponNameFromSlug(li);
  }

  function getNpcInfoFromLobby(form, stage) {
    const card = qa(form || document, '.next_ch[data-npc]')
      .find(el => String(el.dataset.npc).toLowerCase() === String(stage).toLowerCase());
    if (!card) return { npcName: stage, npcWeapon: '' };
    const h6 = q(card, '.ch_title h6') || q(card, 'h6');
    const npcName   = (h6 && h6.dataset && h6.dataset.name) ? h6.dataset.name.trim() : text(h6);
    const npcWeapon = text(q(card, '.weapon_desc b.large')) || text(q(card, 'b.large'));
    return { npcName: npcName || stage, npcWeapon };
  }

  function pickTargetFromStyles(form, availableStages) {
    const candidates = qa(form, 'ul.battle_style li[data-style]')
      .flatMap(li => {
        const tippy = String(li.dataset.tippyContent || '').trim();
        const i2 = tippy.lastIndexOf('_');
        const i1 = tippy.lastIndexOf('_', i2 - 1);
        if (i1 < 0 || i2 < 0 || i1 === i2) return [];
        const stage       = tippy.slice(0, i1).toLowerCase();
        const lossesStr   = tippy.slice(i1 + 1, i2);
        const patternsStr = tippy.slice(i2 + 1);
        if (!availableStages.has(stage)) return [];
        const losses   = Number(lossesStr);
        const patterns = Number(patternsStr);
        if (isNaN(losses) || isNaN(patterns) || patterns <= 0) return [];
        const styleId    = String(li.dataset.style || '');
        const weaponName = getWeaponNameFromLobby(form, styleId);
        const npcInfo    = getNpcInfoFromLobby(form, stage);
        return [{ styleLi: li, styleId, stage, losses, patterns,
                  lossRate: losses / patterns, weaponName: weaponName || '',
                  npcName: npcInfo.npcName, npcWeapon: npcInfo.npcWeapon }];
      });

    if (candidates.length === 0) return null;
    const rev = isReversed();
    candidates.sort((a, b) =>
      rev ? (a.lossRate - b.lossRate) || (b.losses - a.losses)
          : (b.lossRate - a.lossRate) || (a.losses - b.losses)
    );
    return candidates[0];
  }

  function targetDetail(t) {
    if (!t) return '';
    return `武器：${escapeHtml(t.weaponName)}<br>対象：${escapeHtml(t.npcName)} / ${escapeHtml(t.npcWeapon)}<br>敗北率：${t.losses}/${t.patterns}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function isUnmelcto(name) {
    return !!name && WIN_UNMELCTO.indexOf(name) !== -1;
  }

  // SEASONAL_02の対象武器名リストを確定する。
  // CONFIG指定があればその順序、空なら画面表示中の全武器をDOM順で返す。
  function seasonal02TargetNames(weaponLis) {
    if (SEASONAL_02_WEAPONS.length > 0) return SEASONAL_02_WEAPONS.slice();
    return weaponLis
      .map(li => (li.dataset.tippyContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function isSeasonal02Cleared(li) {
    return String(li.dataset.clearedSeasonal_02) === '1';
  }

  // ARCADE MODEのモードラジオ(short/hundred/seasonal_02)を指定値に切り替える。
  function selectArcadeMode(modeValue) {
    const radio = document.querySelector(`input[name="arcade_mode"][value="${modeValue}"]`);
    if (radio && !radio.checked) radio.click();
    return !!radio;
  }

  function incrementWin(weaponName) {
    if (!weaponName) return null;
    const winData = getWeaponWins();
    const prev = Number(winData[weaponName] ?? 0);
    const next = prev + 1;
    winData[weaponName] = next;
    try {
      localStorage.setItem(WIN_STORAGE_KEY, JSON.stringify(winData));
      console.log(`[BO5 AAR] ${weaponName} 勝利数: ${prev} → ${next}`);
    } catch (e) {
      console.warn('[BO5 AAR] 勝利数の保存に失敗:', e);
    }
    return next;
  }

  // div.bet の「BATTLE N」を整数で返す（HUNDREDモードの現在戦数）。無ければ null。
  function readBattleNo(root) {
    const el = q(root || document, 'div.bet b.large');
    if (!el) return null;
    const m = el.textContent.match(/BATTLE\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // 現在ランの武器(和名)。CHALLENGE START 時に保存した run_weapon を優先。
  // 無ければ battle_style の武器アイコン(ラン中は全 li 同一武器)から和名を引くフォールバック。
  function currentRunWeapon(form) {
    const stored = gmGet('run_weapon', null);
    if (stored) return stored;
    const li = q(form || document, 'ul.battle_style li[data-style]');
    return li ? (getWeaponNameFromSlug(li) || null) : null;
  }

  function fallbackArcadeStart() {
    if (getPhase() !== 'wins_fresh') {
      updatePanel('ON', '勝利数を取得中...', 'セットアップページへ移動します。');
      return schedule('setup.phpへ', CFG.SHORT_DELAY_MS, () => {
        setPhase('refreshing_wins');
        location.assign(CFG.SETUP_URL);
      });
    }

    const weaponLis = Array.from(document.querySelectorAll('ul.battle_weapon li'));

    // 優先度1：fixed_weapon（明示ピン。設定されていれば最優先。従来通りHUNDREDモード固定）
    const fixedWeapon = getFixedWeapon();
    if (fixedWeapon) {
      selectArcadeMode('hundred');
      const li = weaponLis.find(el => (el.dataset.tippyContent || '').trim() === fixedWeapon);
      if (!li) { stop(`指定武器が武器リストに見つかりません：${fixedWeapon}`); return; }
      const radio = li.querySelector('input[type="radio"]');
      if (!radio) { stop(`指定武器のラジオボタンを取得できません：${fixedWeapon}`); return; }
      radio.click();
      gmSet('run_weapon', fixedWeapon);
      gmSet('run_mode', 'hundred');
      updatePanel('ON', `武器選択(固定)：${fixedWeapon}`, '');
      challengeStartSoon();
      return;
    }

    // 優先度2：SEASONAL_02（ARCADE MODE「SEASONAL -2-」。未クリア武器をリスト順に選ぶ）
    if (SEASONAL_02_ENABLED) {
      const seasonalTargets = seasonal02TargetNames(weaponLis);
      for (const name of seasonalTargets) {
        const li = weaponLis.find(el => (el.dataset.tippyContent || '').replace(/\s+/g, ' ').trim() === name);
        if (!li) continue;                    // 画面に無い名前（誤記等）はスキップ
        if (isSeasonal02Cleared(li)) continue; // クリア済み → 次の武器へ
        const radio = li.querySelector('input[type="radio"]');
        if (!radio) continue;
        selectArcadeMode('seasonal_02');
        radio.click();
        gmSet('run_weapon', name);
        gmSet('run_mode', 'seasonal_02');
        updatePanel('ON', `SEASONAL -2- 選択：${name}`, 'data-cleared-seasonal_02="1" になるまで挑戦します。');
        challengeStartSoon();
        return;
      }
      // seasonalTargets が空、または全クリア済み → 以降のHUNDRED系フローへフォールスルー
    }

    selectArcadeMode('hundred');

    // 優先度3：WIN_UNMELCTO（100連勝未達成の武器をリスト順に選ぶ）
    for (const name of WIN_UNMELCTO) {
      const li = weaponLis.find(el => (el.dataset.tippyContent || '').replace(/\s+/g, ' ').trim() === name);
      if (!li) continue;                                        // 画面に無い名前（誤記等）はスキップ
      if (String(li.dataset.clearedHundred) === '1') continue;  // 完走済み → 次の UNMELCTO へ
      const radio = li.querySelector('input[type="radio"]');
      if (!radio) continue;
      radio.click();
      gmSet('run_weapon', name);
      gmSet('run_mode', 'hundred');
      updatePanel('ON', `UNMELCTO選択：${name}`, '100連勝(HUNDRED COMPLETE)まで挑戦します。');
      challengeStartSoon();
      return;
    }

    // 優先度4：累計勝利上限(網のみ2500、他500)未達成の武器を DOM 順で
    const winData = getWeaponWins();
    for (const li of weaponLis) {
      const weaponName = (li.dataset.tippyContent || '').replace(/\s+/g, ' ').trim();
      if (!weaponName) continue;
      const keys     = weaponKeysFromLi(li, weaponName);
      const winLimit = winLimitForKeys(keys);
      const winCount = winsForKeys(winData, keys);
      if (winCount != null && winCount >= winLimit) continue;
      const radio = li.querySelector('input[type="radio"]');
      if (!radio) continue;
      radio.click();
      gmSet('run_weapon', weaponName);
      gmSet('run_mode', 'hundred');
      updatePanel('ON', `武器選択：${weaponName}`, `勝利数：${winCount == null ? '不明' : winCount} / 上限 ${winLimit}`);
      challengeStartSoon();
      return;
    }

    stop('挑戦対象の武器が見つかりません（SEASONAL -2- は全クリア、UNMELCTO は全完走、通常は全上限達成済み）。');
  }

  // 武器ラジオ選択後、CHALLENGE START を押す（共通処理）
  function challengeStartSoon() {
    setTimeout(() => {
      if (!isEnabled()) return;
      const startBtn = document.querySelector('input.start[value="CHALLENGE START"]');
      if (startBtn) startBtn.click();
    }, 500);
  }

  function setSelectValue(select, option) {
    if (!select || !option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('input',  { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function selectNpcInForm(form, stage) {
    const select = q(form, 'select[name="btst_npc"]');
    const option = qa(select, 'option').find(opt => String(opt.value).toLowerCase() === String(stage).toLowerCase());
    return setSelectValue(select, option);
  }

  function selectAllyStyleInForm(form, styleId) {
    const select = q(form, 'select[name="btst_ally"]');
    const option = qa(select, 'option').find(opt => {
      const byData  = String(opt.dataset ? opt.dataset.btst || '' : '');
      const byValue = String(opt.value || '').split(',')[0];
      return byData === String(styleId) || byValue === String(styleId);
    });
    return setSelectValue(select, option);
  }

  function handleLobby() {
    // リタイア送信フェーズ
    if (getPhase() === 'retire_pending') return submitRetire();

    // 直前に fetch 送信した試合の結果を、再読込後のロビーで確定
    if (getPhase() === 'await_result') {
      // false: リタイア送信を発火済み → ここで終了。true: phase='choose_pending' 済み → 通常処理へ。
      if (!resolveFetchedBattle()) return;
    }

    const form = getArcadeForm();
    if (!form) return stop('ARCADE MODEフォームがありません。');

    const npcLis = qa(form, 'ul.battle_npc li[data-stage]');
    if (npcLis.length === 0) {
      // アクティブなランが無い（=新規挑戦が必要 or 直前敗北/完走でラン終了）→ 次武器を選んで CHALLENGE START
      fallbackArcadeStart();
      return;
    }

    const availableStages = new Set(
      npcLis
        .filter(li => !li.classList.contains('notwin'))
        .map(li => String(li.dataset.stage).toLowerCase())
    );
    if (availableStages.size === 0) return stop('未クリアNPCがありません。');

    const phase        = getPhase();
    const storedTarget = getTarget();
    if (phase === 'battle_pending' && storedTarget && availableStages.has(storedTarget.stage)) {
      updatePanel('ON', '戦闘開始準備中。', targetDetail(storedTarget));
      return schedule('対戦送信前', CFG.SHORT_DELAY_MS, () => startBattle(form, storedTarget));
    }

    const target = pickTargetFromStyles(form, availableStages);
    if (!target) return stop('対象NPCの戦闘設定が見つかりません。対象武器のJSONをインポートしてください。');

    clickElement(target.styleLi);
    selectAllyStyleInForm(form, target.styleId);
    setTarget(target);
    setPhase('battle_pending');
    updatePanel('ON', '対象NPCを決定しました。', targetDetail(target));
    return schedule('対戦送信前', CFG.SHORT_DELAY_MS, () => startBattle(form, target));
  }

  // 進行中ランをリタイア（通常武器の上限到達時）。旧挙動踏襲でリタイア後はスクリプト停止。
  function submitRetire() {
    const retireForm = document.querySelector('form#arcade_retire');
    if (!retireForm) return stop('リタイアフォームが見つかりません。');
    const retireBtn = retireForm.querySelector('input[type="submit"]');
    if (!retireBtn) return stop('RETIREボタンが見つかりません。');
    updatePanel('ON', 'リタイア実行中。', '');
    return schedule('RETIRE送信', CFG.SHORT_DELAY_MS, () => {
      setPhase('idle');
      setEnabled(false);
      retireBtn.click();
    });
  }

  // fetch 送信後に再読込したロビーで、div.bet 差分から勝敗を確定する。
  // 戻り値 true: 次戦へ継続(phase='choose_pending' 済み) / false: リタイア送信済み(終了)
  function resolveFetchedBattle() {
    clearTarget();
    const form     = getArcadeForm();
    const prevRaw  = gmGet('prev_battle_no', '');
    const prev     = (prevRaw === '' || prevRaw == null) ? null : Number(prevRaw);
    gmDel('prev_battle_no');
    const runWeapon = currentRunWeapon(form);
    const runMode   = gmGet('run_mode', null);
    const curBattle = readBattleNo(form);
    const npcLis    = form ? qa(form, 'ul.battle_npc li[data-stage]') : [];

    // ラン消滅（div.bet 無し or NPC 0件）= 敗北 or ラン完走（どちらもラン終了）。
    // fetch 経路では両者を div.bet で区別できないが区別不要：
    //   UNMELCTO の完走は次 CHALLENGE START の data-cleared-hundred で判定、
    //   SEASONAL_02 の完走は同画面の data-cleared-seasonal_02 で判定、
    //   通常武器の勝利数は次 setup の extractAndStoreWins で再同期される。
    if (curBattle == null || npcLis.length === 0) {
      setPhase('choose_pending');
      updatePanel('ON', 'ラン終了（敗北 or 完走）。次の挑戦へ。', '');
      return true;  // npcLis===0 → fallbackArcadeStart が次武器/再挑戦を選ぶ
    }

    // ラン継続：BATTLE @ 差分で勝敗（増=勝 / 不変=引分）
    if (prev != null && curBattle > prev) {
      const next = incrementWin(runWeapon);
      updatePanel('ON', `勝利（${runWeapon || '?'}：${next == null ? '?' : next}勝目）。`, `BATTLE ${prev}→${curBattle}`);
      // 通常(非UNMELCTO・非SEASONAL_02)武器のみ、累計上限到達でリタイア。
      // UNMELCTOは上限非依存で走り続け、SEASONAL_02はクリアフラグでのみ完了判定するため
      // 累計勝利数での強制リタイアはしない。
      if (runWeapon && runMode !== 'seasonal_02' && !isUnmelcto(runWeapon)
          && next != null && next >= winLimitForKeys([runWeapon])) {
        updatePanel('ON', `${runWeapon} 上限到達。リタイアします。`, '');
        submitRetire();
        return false;
      }
    } else {
      updatePanel('ON', '引分。次戦へ。', `BATTLE ${prev == null ? '?' : prev}（変化なし）`);
    }

    setPhase('choose_pending');
    return true;
  }

  function startBattle(form, target, retryCount) {
    if (!isEnabled()) return;
    retryCount = retryCount || 0;

    const styleLi = qa(form, 'ul.battle_style li[data-style]').find(li => String(li.dataset.style) === String(target.styleId));
    if (styleLi) clickElement(styleLi);
    selectAllyStyleInForm(form, target.styleId);

    const npcLi = qa(form, 'ul.battle_npc li[data-stage]').find(li => String(li.dataset.stage).toLowerCase() === String(target.stage));
    if (!npcLi) {
      setPhase('choose_pending');
      clearTarget();
      return stop(`対象NPCがロビーから消えました：stage=${target.stage}`);
    }
    clickElement(npcLi);
    selectNpcInForm(form, target.stage);

    // FIELD SETTING終了を待ってから追加待機→fetch送信
    waitForFieldSettingThenStart(form, target, retryCount, 0);
  }

  function waitForFieldSettingThenStart(form, target, retryCount, waitedMs) {
    if (!isEnabled()) return;

    if (isFieldSettingActive(form)) {
      if (waitedMs >= CFG.FIELD_SETTING_MAX_WAIT_MS) {
        return stop('FIELD SETTING待機がタイムアウトしました。ページをリロードしてください。');
      }
      const btn   = getStartButton(form);
      const label = btn ? String(btn.value || '').trim() : 'FIELD SETTING';
      updatePanel('ON', `FIELD SETTING中…開始待機 (${label})`, targetDetail(target));
      return window.setTimeout(
        () => waitForFieldSettingThenStart(form, target, retryCount, waitedMs + CFG.FIELD_SETTING_POLL_MS),
        CFG.FIELD_SETTING_POLL_MS
      );
    }

    // FIELD SETTING 終了 → POST_FIELD_SETTING_DELAYS_MS から抽選した時間待機後に fetch 送信
    const _d = CFG.POST_FIELD_SETTING_DELAYS_MS;
    const postDelay = _d[Math.floor(Math.random() * _d.length)];
    const delaySec = Math.round(postDelay / 1000);
    updatePanel('ON', `FIELD SETTING完了。${delaySec}秒後に対戦をfetch送信します。`, targetDetail(target));

    window.setTimeout(() => {
      if (!isEnabled()) return;
      const btn = getStartButton(form);
      if (!btn) return stop('BATTLE STARTボタンが見つかりません。');
      submitBattleViaFetch(form, target, 0);
    }, postDelay);
  }

  // arcade フォームを fetch で POST（画面遷移なし）→ 成功後にロビーを再読込し、await_result で勝敗確定。
  async function submitBattleViaFetch(form, target, retryCount) {
    if (!isEnabled()) return;
    retryCount = retryCount || 0;

    // 結果判定用に、送信前の BATTLE @（div.bet）を保存。run_weapon は CHALLENGE START 時に保存済み。
    const prevNo = readBattleNo(form);
    gmSet('prev_battle_no', prevNo == null ? '' : String(prevNo));
    setPhase('await_result');
    updatePanel('ON', '対戦をfetch送信中…（画面遷移なし）', targetDetail(target));

    let ok = false;
    try {
      const body = new URLSearchParams(new FormData(form));
      const btn  = getStartButton(form);
      // submit ボタンの値は FormData に含まれないので明示付与（サーバが bt_start を見る場合に備える）
      if (btn && btn.name) body.set(btn.name, btn.value || 'BATTLE START');
      const res = await fetch(form.action, {
        method: (form.method || 'POST').toUpperCase(),
        body,
        credentials: 'include',
        redirect: 'follow',
      });
      ok = res.ok;
    } catch (e) {
      console.warn('[BO5 AAR] 対戦のfetch送信に失敗:', e);
      ok = false;
    }
    if (!isEnabled()) return;

    if (!ok) {
      if (retryCount >= CFG.BATTLE_START_MAX_RETRIES) {
        gmDel('prev_battle_no');
        setPhase('choose_pending');
        return stop(`対戦のfetch送信を${CFG.BATTLE_START_MAX_RETRIES}回失敗しました。`);
      }
      updatePanel('ON', `送信失敗。再試行します（${retryCount + 1}/${CFG.BATTLE_START_MAX_RETRIES}）。`, '');
      return window.setTimeout(() => submitBattleViaFetch(form, target, retryCount + 1), CFG.BATTLE_START_RECHECK_MS);
    }

    // 送信成功 → ロビー再読込。再読込後 handleLobby が await_result を resolveFetchedBattle で確定する。
    schedule('結果確認のためロビー再読込', CFG.SHORT_DELAY_MS, () => location.assign(CFG.LOBBY_URL));
  }

  function main() {
    installPanel();
    refreshToggle();
    refreshReverseBtn();
    if (!isEnabled()) return updatePanel('OFF', '待機中。', 'ONにすると自動進行を開始します。');
    const page = currentPage();
    if (page === 'lobby') return handleLobby();
    return updatePanel('ON', '対象外ページです。', 'BO5のロビー画面のみで動作します。');
  }

  function bootstrap() {
    installPanel();
    refreshToggle();
    refreshReverseBtn();

    if (currentPage() === 'setup') {
      extractAndStoreWins();
      if (isEnabled() && getPhase() === 'refreshing_wins') {
        setPhase('wins_fresh');
        updatePanel('ON', '勝利数更新完了。ロビーへ戻ります。', '');
        return schedule('ロビーへ戻る', CFG.SHORT_DELAY_MS, () => location.assign(CFG.LOBBY_URL));
      }
      updatePanel(isEnabled() ? 'ON' : 'OFF', '装備画面です。', '自動操作は行いません。');
      return;
    }

    main();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.setTimeout(() => bootstrap(), 500), { once: true });
  } else {
    window.setTimeout(() => bootstrap(), 500);
  }
})();