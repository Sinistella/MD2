// ==UserScript==
// @name         BO5 RAR
// @namespace    bo5.rumble.rar
// @version      1.0.0
// @description  BO5 Rumble Auto Runner。1-5戦目はソルバ（最悪ケース保証）、6-15戦目はanswer.csvプリセットで自動出撃。btst=8を毎戦書き換えて使用。対戦はfetch送信で画面遷移なし。
// @author       Sinister (Eno 1038)
// @match        https://wdrb.work/bo5/battle_lobby.php*
// @match        https://wdrb.work/bo5/setup.php*
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

/* ============================================================
   検証済み（実機HTML×Python照合済み）：
     - 型相性10ペア / VB / ダメージ式 / 敵整合補完の全列挙
     - 18武器×全合法手順の最悪ケース保証選択
     - スラッグ統一（setup w_id = lobby data-wp = xlsx武器ID, 93件一致）
     - setup.php武器切替がクライアント完結（weapon_card[data-weapon-card]読込）
     - 連勝数スクレイプ：span.yellow「N連勝中！」（/^(\d+)連勝中/ で抽出）
     - 敵武器名：.next_ch .select_wp .weapon_desc b.large ／ 敵プール：ul.enemy_weapon ／ 型+回数：ul.enemy_btset
     - [v1.0.0で実機照合] rumble対戦フォーム form#btlb_form_battle action="battle.php"（素のPOST、
       BATTLE STARTにJSインターセプタ無し＝fetch(form.action)+FormDataで等価）。
       hidden: page_eno / type=battle / btst_ally。FIELD SETTING 実在（bt_start を disabled 化するため待機要）。
   実機でのみ確認が必要（コメント [LIVE-TODO] 箇所）：
     - 「設定を保存」押下後のリダイレクト先URL（handleSetupがsetup再表示/ロビーのどちらでも拾う設計）
   ============================================================ */
(() => {
  'use strict';

  // ===== CONFIG ====================================================
  const CFG = {
    KEY: 'bo5_rar_v0:',
    SCRATCH_BTST: 8,                 // 書き換え対象の作業用btst番号（ラベルは「全て」想定）
    LOBBY_URL: 'https://wdrb.work/bo5/battle_lobby.php?mode=rumble',
    SETUP_URL: 'https://wdrb.work/bo5/setup.php?btst=8',
    SHORT_DELAY_MS: 1000,
    // FIELD SETTING / BATTLE START 周りの待機（対DDoS）。[値ms, 出現回数, ...]
    POST_SAVE_DELAYS_MS: [1000, 2000, 3000],   // 例: [1000,2000,3000]（空配列は不可、最低1要素）
    UI_ID: 'bo5-rar-panel',
  };

  // 探索対象の武器（日本語名）。見えている箇所が1か所でもあればこの集合で対応する。
  // ※ リストは必ず半角カンマ "," で区切る。全角読点「、」はNG（["双剣、サイス"] は1要素扱いになり壊れる）。
  //   空にする場合の例: const SHORTLIST_JP = [];           // ← 全滅、解は出ない
  //   指定する場合の例: const SHORTLIST_JP = ["双剣", "ギロッチン", "輪刀"];
  const SHORTLIST_JP = [
    "エクセキューター", "ギロッチン", "ゴルフクラブ", "サイス", "シザーズブレイド",
    "スパイクシールド", "トンファー", "メイス", "ラウンドシールド", "レイピア",
    "手甲鉤", "酒瓶", "双剣", "多節棍", "大錫杖", "包丁", "網", "輪刀",
  ];
  // ================================================================

  // グループメンバーテーブル（16戦目以降の武器特定に使用）
  // GRP-X のメンバー武器名リスト。answer.csv の GRP-X 行と対応。
  // 例: GRP_MEMBERS["GRP-A"] → ["ギガントアーム", "サイス", ...]
  const GRP_MEMBERS = {
    "GRP-A": ["ギガントアーム", "サイス", "トリガーブレイド", "バルディッシュ", "大太刀", "棒"],
    "GRP-B": ["トライデント", "ランス", "ロングソード", "棍棒"],
    "GRP-C": ["シザーズブレイド", "スピア", "薙刀", "金剛杵"],
    "GRP-D": ["ケペシュ", "バール", "十文字槍"],
    "GRP-E": ["コイルソード", "ブロードソード", "レイピア"],
    "GRP-F": ["ソーブレイド", "偃月刀"],
    "GRP-G": ["エクセキューター", "ビームサーベル"],
    "GRP-H": ["アンブレラ", "打刀"],
    "GRP-I": ["ウォーピック", "バット"],
    "GRP-J": ["シャムシール", "ジャマダハル"],
    "GRP-K": ["ウィップ", "鋼糸"],
  };
  // ================================================================

  // ===== 武器データ（GitHub CSVから1フェッチ、ページ内キャッシュ）=====
  const WEAPON_CSV_URL = 'https://raw.githubusercontent.com/Sinistella/MD2/main/l30S/weapon.csv';
  let BO5_WEAPONS = null;

  // ===== answerテーブル（6-15戦目プリセット、GitHub CSVから1フェッチ、ページ内キャッシュ）=====
  // スキーマ: 相手武器,自分武器,1R,2R,3R,4R,5R
  // 例: アンブレラ,ゴルフクラブ,パター,アイアン,アプローチ,ドライバー,アイアン
  const ANSWER_CSV_URL = 'https://raw.githubusercontent.com/Sinistella/MD2/main/l30S/answer.csv';
  let BO5_ANSWER = null;  // { [相手武器名]: { myWeapon: string, seq: string[5] } }

  function parseAnswerCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').split('\n');
    const A = {};
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].trim(); if (!row) continue;
      const cols = row.split(',');
      if (cols.length < 7) continue;
      const [oppWeapon, myWeapon, r1, r2, r3, r4, r5] = cols;
      if (!oppWeapon) continue;
      A[oppWeapon] = { myWeapon, seq: [r1, r2, r3, r4, r5] };
    }
    return A;
  }

  function fetchAnswer() {
    if (BO5_ANSWER) return Promise.resolve(BO5_ANSWER);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: ANSWER_CSV_URL,
        onload: (res) => { try { BO5_ANSWER = parseAnswerCSV(res.responseText); resolve(BO5_ANSWER); } catch (e) { reject(e); } },
        onerror: () => reject(new Error('answerCSVフェッチ失敗: ' + ANSWER_CSV_URL)),
      });
    });
  }

  function parseWeaponCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').split('\n');  // BOM除去
    const W = {};
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].trim(); if (!row) continue;
      const [wid, wname, idx, sname, stype, atk, df, uses] = row.split(',');
      if (!wid) continue;
      if (!W[wid]) W[wid] = { name: wname, skills: [] };
      W[wid].skills.push({ i: parseInt(idx), t: stype, n: sname, a: parseInt(atk), d: parseInt(df), u: parseInt(uses) });
    }
    // skills を技順昇順に整列
    for (const w of Object.values(W)) w.skills.sort((a, b) => a.i - b.i);
    return W;
  }

  function fetchWeapons() {
    if (BO5_WEAPONS) return Promise.resolve(BO5_WEAPONS);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: WEAPON_CSV_URL,
        onload: (res) => { try { BO5_WEAPONS = parseWeaponCSV(res.responseText); resolve(BO5_WEAPONS); } catch (e) { reject(e); } },
        onerror: (e) => reject(new Error('CSVフェッチ失敗: ' + WEAPON_CSV_URL)),
      });
    });
  }
/* BO5 RAR ソルバ JS版 v0.1
   損失最小化＝最悪ケース保証（敵の全整合補完に対し score>=0 を最優先、
   その集合内で確定勝ち最大化、保証手順が無い時のみ敗北率最小に落とす）。
   node でも userscript でも動くよう純関数で構成。BO5_WEAPONS を外から与える。 */
(function (root) {
  'use strict';
  const BEATS = {
    '上段': new Set(['中段', '無形']),
    '中段': new Set(['下段', '無形']),
    '下段': new Set(['上段', '無形']),
    '奥義': new Set(['上段', '中段', '下段']),
    '無形': new Set(['奥義']),
  };
  const VB_TYPES = new Set(['奥義', '無形']);
  const VB_TABLE = { 0: 1.0, 1: 1.1, 2: 1.25, 3: 1.5, 4: 2.0 };

  // ---- 高速化用: 型index・ADV行列・整数VB ----
  const TORDER = ['上段', '中段', '下段', '奥義', '無形'];
  const TIDX = { '上段': 0, '中段': 1, '下段': 2, '奥義': 3, '無形': 4 };
  const ADV = (() => { const A = []; for (let p = 0; p < 5; p++) { A[p] = []; for (let o = 0; o < 5; o++) { const pt = TORDER[p], ot = TORDER[o]; A[p][o] = (pt === ot) ? 0 : (BEATS[pt].has(ot) ? 1 : -1); } } return A; })();
  const VB_NUM = [1, 11, 5, 3, 2], VB_DEN = [1, 10, 4, 2, 1];   // VB倍率 1.0/1.1/1.25/1.5/2.0 の整数表現
  const VB_T = new Set([3, 4]);                                  // 奥義(3)・無形(4) のみVB
  function effAtkInt(atk, k) { k = k < 4 ? k : 4; return Math.floor(atk * VB_NUM[k] / VB_DEN[k]); }
  // 手順(skill配列)を {t:Int8[5], a:Int32[5](VB後攻撃力), d:Int32[5]} に事前計算（VBは1回だけ）
  function precompute(seq) {
    const t = new Int8Array(5), a = new Int32Array(5), d = new Int32Array(5); const prior = [];
    for (let r = 0; r < 5; r++) {
      const sk = seq[r]; const ti = TIDX[sk.t];
      if (ti === undefined) throw new Error('型不正: ' + JSON.stringify(sk.t) + ' skill:' + sk.n);
      t[r] = ti; d[r] = sk.d;
      let atk = sk.a;
      if (VB_T.has(ti)) { const set = new Set(prior); set.delete(ti); atk = effAtkInt(sk.a, set.size); }
      a[r] = atk; prior.push(ti);
    }
    return { t, a, d };
  }
  // 事前計算済み P(自) vs E(敵) のスコア（VB・Set参照なし、ADV参照のみ）
  function scoreFast(P, E) {
    let tp = 0, to = 0;
    for (let r = 0; r < 5; r++) {
      const rel = ADV[P.t[r]][E.t[r]];
      if (rel === 1) { const x = P.a[r] - E.d[r]; if (x > 0) tp += x; }
      else if (rel === -1) { const x = E.a[r] - P.d[r]; if (x > 0) to += x; }
      else { const xp = Math.floor(P.a[r] / 2) - E.d[r]; if (xp > 0) tp += xp; const xo = Math.floor(E.a[r] / 2) - P.d[r]; if (xo > 0) to += xo; }
    }
    return tp - to;
  }

  function vbMult(prevTypes, curType) {
    const s = new Set(prevTypes); s.delete(curType);
    return VB_TABLE[Math.min(s.size, 4)];
  }
  function effAtk(skill, prev) {
    let a = skill.a;
    if (VB_TYPES.has(skill.t)) a = Math.floor(a * vbMult(prev, skill.t) + 1e-9);
    return a;
  }
  // 攻撃側 my の与ダメ, 敵 op の与ダメ を返す
  function roundDamage(my, op, myPrev, opPrev) {
    const mt = my.t, ot = op.t;
    if (!BEATS[mt]) throw new Error('型不正(自): ' + JSON.stringify(mt) + ' skill:' + my.n);
    if (!BEATS[ot]) throw new Error('型不正(敵): ' + JSON.stringify(ot) + ' skill:' + op.n);
    const ma = effAtk(my, myPrev), oa = effAtk(op, opPrev);
    if (mt === ot) {
      return [Math.max(0, Math.floor(ma / 2) - op.d), Math.max(0, Math.floor(oa / 2) - my.d)];
    }
    if (BEATS[mt].has(ot)) return [Math.max(0, ma - op.d), 0];
    if (BEATS[ot].has(mt)) return [0, Math.max(0, oa - my.d)];
    throw new Error('未決着型: ' + mt + ' vs ' + ot);
  }
  function battleScore(mySeq, opSeq) {
    let mt = 0, ot = 0; const mp = [], op = [];
    for (let i = 0; i < 5; i++) {
      const [md, od] = roundDamage(mySeq[i], opSeq[i], mp, op);
      mt += md; ot += od; mp.push(mySeq[i].t); op.push(opSeq[i].t);
    }
    return mt - ot;
  }
  // 合法手順全列挙（長さ5・各技 使用回数以内）。skills:[{i,t,n,a,d,u}]
  function legalSequences(skills) {
    const out = [];
    const remain = {}; skills.forEach(s => remain[s.i] = s.u);
    const byI = {}; skills.forEach(s => byI[s.i] = s);
    const ids = skills.map(s => s.i);
    (function rec(seq) {
      if (seq.length === 5) { out.push(seq.map(i => byI[i])); return; }
      for (const id of ids) if (remain[id] > 0) { remain[id]--; seq.push(id); rec(seq); seq.pop(); remain[id]++; }
    })([]);
    return out;
  }
  // 敵の整合補完を全列挙。revealed:{pos:skillName}, enemy skills:[...]
  function enemyScenarios(enemySkills, revealed) {
    const byName = {}; enemySkills.forEach(s => byName[s.n] = s);
    const uses = {}; enemySkills.forEach(s => uses[s.n] = s.u);
    const remain = Object.assign({}, uses);
    for (const p in revealed) {
      const nm = revealed[p];
      if (!(nm in remain)) return [];      // 開示技が敵プールに無い＝不整合
      remain[nm]--; if (remain[nm] < 0) return [];
    }
    const freePos = []; for (let p = 0; p < 5; p++) if (!(p in revealed)) freePos.push(p);
    const names = enemySkills.map(s => s.n);
    const out = [];
    (function rec(k, assign) {
      if (k === freePos.length) {
        const seq = new Array(5);
        for (const p in revealed) seq[p] = byName[revealed[p]];
        freePos.forEach((p, j) => seq[p] = byName[assign[j]]);
        out.push(seq); return;
      }
      for (const nm of names) if (remain[nm] > 0) { remain[nm]--; assign.push(nm); rec(k + 1, assign); assign.pop(); remain[nm]++; }
    })(0, []);
    return out;
  }
  function evalSeq(mySeq, scenarios) {
    const n = scenarios.length; let loss = 0, draw = 0, win = 0, worst = Infinity, best = -Infinity, sum = 0;
    for (const e of scenarios) {
      const s = battleScore(mySeq, e);
      if (s < 0) loss++; else if (s === 0) draw++; else win++;
      if (s < worst) worst = s; if (s > best) best = s; sum += s;
    }
    return { n, pLoss: loss / n, pDraw: draw / n, pWin: win / n, worst, best, mean: sum / n };
  }
  // 最悪ケース保証の辞書式キー（小さいほど良い）
  function lexKey(ev) {
    return [ev.worst >= 0 ? 0 : 1, ev.pLoss, -ev.pWin, -ev.worst, -ev.mean];
  }
  function lexLess(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; }

  // 指定18武器×全合法手順を、敵整合補完に対し評価して最良を返す
  function solve(WEAPONS, enemySkills, revealed, shortlistIds) {
    if (!enemySkills || !enemySkills.length) return { error: '敵武器スキルが空' };
    const scenarios = enemyScenarios(enemySkills, revealed);
    if (scenarios.length === 0) return { error: '敵整合補完が0（開示が使用回数と矛盾）' };
    // 敵の全整合補完を1回だけ事前計算（VB込み）→ 内側ループで再計算しない
    const Epre = scenarios.map(precompute);
    const N = Epre.length;
    let best = null;
    const ranked = [];
    for (const wid of shortlistIds) {
      const w = WEAPONS[wid]; if (!w) continue;
      let wbest = null;
      for (const seq of legalSequences(w.skills)) {
        const P = precompute(seq);
        let loss = 0, draw = 0, win = 0, worst = Infinity, best2 = -Infinity, sum = 0;
        for (let j = 0; j < N; j++) {
          const sc = scoreFast(P, Epre[j]);
          if (sc < 0) loss++; else if (sc === 0) draw++; else win++;
          if (sc < worst) worst = sc; if (sc > best2) best2 = sc; sum += sc;
        }
        const ev = { n: N, pLoss: loss / N, pDraw: draw / N, pWin: win / N, worst, best: best2, mean: sum / N,
                     weaponId: wid, weaponName: w.name, seqIdx: seq.map(s => s.i), seqNames: seq.map(s => s.n) };
        const k = lexKey(ev);
        if (wbest === null || lexLess(k, lexKey(wbest))) wbest = ev;
      }
      if (wbest) { ranked.push(wbest); if (best === null || lexLess(lexKey(wbest), lexKey(best))) best = wbest; }
    }
    ranked.sort((a, b) => (lexLess(lexKey(a), lexKey(b)) ? -1 : 1));
    return { best, ranked, scenarioCount: scenarios.length };
  }

  const api = { BEATS, vbMult, roundDamage, battleScore, legalSequences, enemyScenarios, evalSeq, lexKey, solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BO5_RAR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

  // ===== shortlist 解決（日本語名→武器ID） =====
  function shortlistIds() {
    // BO5_WEAPONS はCSVフェッチ後に入るため、表は呼び出し時に毎回構築（遅延生成）
    const name2id = {};
    if (BO5_WEAPONS) for (const id in BO5_WEAPONS) name2id[BO5_WEAPONS[id].name] = id;
    const ids = [], miss = [];
    for (const nm of SHORTLIST_JP) { if (name2id[nm]) ids.push(name2id[nm]); else miss.push(nm); }
    return { ids, miss };
  }

  // ===== GM / util =====
  const g = (k, d) => GM_getValue(CFG.KEY + k, d);
  const s = (k, v) => GM_setValue(CFG.KEY + k, v);
  const del = (k) => GM_deleteValue(CFG.KEY + k);
  const isEnabled = () => !!g('enabled', false);
  const setEnabled = (v) => s('enabled', !!v);
  const getPhase = () => g('phase', 'scan');
  const setPhase = (v) => s('phase', v || 'scan');
  const getDecision = () => { const r = g('decision', null); return r ? JSON.parse(r) : null; };
  const setDecision = (o) => o ? s('decision', JSON.stringify(o)) : del('decision');

  const q = (r, sel) => (r || document).querySelector(sel);
  const qa = (r, sel) => Array.from((r || document).querySelectorAll(sel));
  const text = (el) => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const click = (el) => { if (el && el.click) { el.click(); return true; } return false; };
  function setRadioChecked(radio) { if (!radio) return false; radio.click(); return true; }
  function setSelectValue(sel, val) { if (!sel) return false; sel.value = val; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }

  let scheduled = false;
  function schedule(label, ms, fn) {
    if (scheduled) return; scheduled = true; updatePanel(label + `（${Math.round(ms/1000)}秒待機）`);
    setTimeout(() => { scheduled = false; if (!isEnabled()) return; try { fn(); } catch (e) { console.error(e); updatePanel('例外: ' + (e && e.message)); } }, ms);
  }
  function pickDelay() { const a = CFG.POST_SAVE_DELAYS_MS; return a[Math.floor(Math.random() * a.length)] || 1000; }

  // ===== panel =====
  function installPanel() {
    if (document.getElementById(CFG.UI_ID)) return;
    const p = document.createElement('div'); p.id = CFG.UI_ID;
    p.innerHTML = `<button data-role="toggle"></button><div data-role="status" style="margin-top:6px;white-space:pre-wrap;"></div>`;
    Object.assign(p.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: 2147483647, width: '300px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(20,20,24,0.92)', color: '#f4f4f4', font: '12px/1.5 system-ui,sans-serif', boxShadow: '0 4px 18px rgba(0,0,0,.35)' });
    const b = q(p, '[data-role="toggle"]'); Object.assign(b.style, { width: '100%', padding: '7px 8px', border: 0, borderRadius: '8px', cursor: 'pointer', fontWeight: 700, color: '#111' });
    b.addEventListener('click', () => { const n = !isEnabled(); setEnabled(n); if (n) { setPhase('scan'); setDecision(null); boot(); } else { setPhase('scan'); updatePanel('停止中'); } refreshToggle(); });
    document.body.appendChild(p); refreshToggle();
  }
  function refreshToggle() { const b = q(document.getElementById(CFG.UI_ID), '[data-role="toggle"]'); if (!b) return; const on = isEnabled(); b.textContent = on ? 'BO5 RAR：ON' : 'BO5 RAR：OFF'; b.style.background = on ? '#9DFF9D' : '#ddd'; }
  function updatePanel(msg) { const el = q(document.getElementById(CFG.UI_ID), '[data-role="status"]'); if (el) el.textContent = msg || ''; refreshToggle(); }

  // ===== page detection =====
  function page() {
    const pth = location.pathname;
    if (pth.endsWith('/battle_lobby.php')) return 'lobby';
    if (pth.endsWith('/setup.php')) return 'setup';
    return 'other';
  }

  // ===== 連勝数スクレイプ =====
  // 「現在の連勝数：<span class="yellow">5連勝中！</span>」→ 5 を返す。取得できなければ null。
  function scrapeStreak() {
    const spans = qa(document, 'span.yellow');
    for (const sp of spans) {
      const m = sp.textContent.match(/^(\d+)連勝中/);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  // ===== answer.csv ルックアップ（6-15戦目用）=====
  // 敵武器名を受け取り { myWeapon, seq:[技名×5] } を返す。未登録なら null。
  function lookupAnswer(enemyName) {
    if (!BO5_ANSWER) return null;
    return BO5_ANSWER[enemyName] || null;
  }

  // answer の技名列から seqIdx（weapon.csv の技順index）を解決する。
  // 解決できない技名があれば null を返す。
  function resolveAnswerSeqIdx(myWeaponId, seqNames) {
    const w = BO5_WEAPONS && BO5_WEAPONS[myWeaponId];
    if (!w) return null;
    const byName = {};
    w.skills.forEach(sk => byName[sk.n] = sk.i);
    const idxs = [];
    for (const nm of seqNames) {
      if (!(nm in byName)) return null;
      idxs.push(byName[nm]);
    }
    return idxs;
  }


  // ===== 16戦目以降：型+使用回数シグネチャによる武器特定 =====

  // BO5_WEAPONSから「正規化シグネチャ→武器IDリスト」テーブルを構築（呼び出し時生成）
  // シグネチャ: 型ごとに使用回数をソートして連結。例: "下段,1,2,2|奥義,1|無形,1"
  // ※同型複数技は使用回数をソートして曖昧性を排除
  function buildSigTable() {
    const table = {};
    for (const wid in BO5_WEAPONS) {
      const skills = BO5_WEAPONS[wid].skills;
      const byType = {};
      for (const sk of skills) {
        if (!byType[sk.t]) byType[sk.t] = [];
        byType[sk.t].push(sk.u);
      }
      // 型名でソート、各型内の使用回数もソート
      const sig = Object.keys(byType).sort().map(t => t + ',' + byType[t].sort((a,b)=>a-b).join(',')).join('|');
      if (!table[sig]) table[sig] = [];
      table[sig].push(wid);
    }
    return table;
  }

  // 敵のenemy_weapon（enemySkills）からシグネチャを生成
  function enemySignature(enemySkills) {
    const byType = {};
    for (const sk of enemySkills) {
      if (!byType[sk.t]) byType[sk.t] = [];
      byType[sk.t].push(sk.u);
    }
    return Object.keys(byType).sort().map(t => t + ',' + byType[t].sort((a,b)=>a-b).join(',')).join('|');
  }

  // 敵候補武器IDリストからGRP-Xキーを逆引き（answer.csvのキー名を返す）
  // 候補が1件→武器名キー、複数件→GRP-Xキー、登録なし→null
  function resolveAnswerKey(candidateIds) {
    if (!BO5_WEAPONS || !BO5_ANSWER) return null;
    if (candidateIds.length === 1) {
      // 単体確定：武器名で引く（answer.csvに登録があれば優先）
      const name = BO5_WEAPONS[candidateIds[0]].name;
      return (name in BO5_ANSWER) ? name : null;
    }
    // 複数：候補の武器名セットとGRP_MEMBERSを照合
    const candidateNames = new Set(candidateIds.map(id => BO5_WEAPONS[id].name));
    for (const grpKey in GRP_MEMBERS) {
      const members = GRP_MEMBERS[grpKey];
      if (members.length !== candidateNames.size) continue;
      if (members.every(m => candidateNames.has(m))) return grpKey;
    }
    return null;
  }

  // ===== lobby: 敵開示のスクレイプ =====
  const ICON2T = { ic_ov: '上段', ic_md: '中段', ic_un: '下段', ic_sp: '奥義', ic_ex: '無形' };
  function scrapeEnemy() {
    // 敵武器名
    const wpEl = q(document, '.next_ch .select_wp, .next_ch .weapon_card .select_wp');
    const enemyName = text(q(wpEl || document, '.weapon_desc b.large')) || '不明';
    // 敵武器プール: ul.enemy_weapon（武器性能タブ）からDOMで直接取得
    const uwEl = q(document, 'ul.enemy_weapon');
    if (!uwEl) return null;
    const enemySkills = [];
    qa(uwEl, 'li[class^="skill_confirm"]').slice(0, 5).forEach((li, idx) => {
      const iconEl = q(li, '.skill_name img');
      const src = iconEl ? (iconEl.getAttribute('src') || '') : '';
      const iconKey = (src.match(/imgs\/(ic_[a-z]+)\.svg/) || [])[1] || '';
      const t = ICON2T[iconKey] || '';
      if (!t) return;                          // 型が読めない技はスキップ
      const nm = text(q(li, '.skill_name b'));
      const nums = qa(li, '.skill_stuts b').map(b => parseInt(b.textContent, 10) || 0);
      enemySkills.push({ i: idx + 1, t, n: nm, a: nums[0] || 0, d: nums[1] || 0, u: nums[2] || 1 });
    });
    if (!enemySkills.length) return null;
    // 開示ラウンド: ul.enemy_btset から取得
    const ul = q(document, 'ul.enemy_btset');
    if (!ul) return null;
    const revealed = {}; let revealedCount = 0;
    qa(ul, 'li[class^="skill_confirm"]').slice(0, 5).forEach((li, i) => {
      const img = q(li, '.skill_name img');
      const nm = text(q(li, '.skill_name b'));
      const src = img ? (img.getAttribute('src') || '') : '';
      if (/bo5_mark/.test(src) || nm === '？？？' || nm === '???') return;
      revealed[i] = nm; revealedCount++;
    });
    return { enemyName, enemySkills, revealed, revealedCount };
  }

  // ===== lobby: enemy_btset から型+使用回数を取得（16-30戦目用）=====
  // enemy_weaponは全マスクだが、enemy_btsetには型アイコンと使用回数が残る。
  // 戻り値: [{t:型名, u:使用回数}, ...] (5要素)。取得失敗時は null。
  function scrapeEnemyBtset() {
    const ul = q(document, 'ul.enemy_btset');
    if (!ul) return null;
    const skills = [];
    qa(ul, 'li[class^="skill_confirm"]').slice(0, 5).forEach((li) => {
      const img = q(li, '.skill_name img');
      const src = img ? (img.getAttribute('src') || '') : '';
      const iconKey = (src.match(/imgs\/(ic_[a-z]+)\.svg/) || [])[1] || '';
      const t = ICON2T[iconKey] || '';
      if (!t) return;  // bo5_mark（不明）はスキップ
      const uEl = q(li, '.skill_stuts b.gray');
      const u = uEl ? (parseInt(uEl.textContent, 10) || 1) : 1;
      skills.push({ t, u });
    });
    if (!skills.length) return null;
    return skills;
  }

  // ===== setup: btst=SCRATCH に 武器＋技順を流し込んで保存 =====
  function setupForm() { return qa(document, 'form.setting_box').find(f => String((q(f, 'input[name="battlestyle"]') || {}).value) === String(CFG.SCRATCH_BTST)) || q(document, 'form.setting_box'); }
  function applyAndSave(decision) {
    const form = setupForm();
    if (!form) return updatePanel('setupフォーム未検出（btst=' + CFG.SCRATCH_BTST + '）');
    // 1) 武器li をクリック → ページJSが skill_r1..5 のラジオ値を当該武器に再構築（同期）
    const wli = qa(form, 'li[data-weapon]').find(li => li.dataset.weapon === decision.weaponId);
    if (!wli) return updatePanel('武器li未検出: ' + decision.weaponId);
    click(wli);
    const wradio = q(wli, 'input[name="w_id"]'); if (wradio) wradio.checked = true;
    // 2) 各ラウンドの技順indexを位置で選択（li:nth-of-type(技順) のラジオ）
    for (let r = 1; r <= 5; r++) {
      const idx = decision.seqIdx[r - 1];
      const radio = q(form, `.skillset_${r} ul.battle_skill li:nth-of-type(${idx}) input[name="skill_r${r}"]`);
      if (!setRadioChecked(radio)) return updatePanel(`技順設定失敗 R${r} idx${idx}`);
    }
    // 3) 保存
    setPhase('saved');
    const save = qa(form, 'input[type="submit"][name="submit"]').find(b => /設定を保存/.test(b.value));
    if (!save) return updatePanel('保存ボタン未検出');
    updatePanel(`保存: ${BO5_WEAPONS && BO5_WEAPONS[decision.weaponId] ? BO5_WEAPONS[decision.weaponId].name : decision.weaponId} / ${decision.seqIdx.join('-')}`);
    schedule('設定を保存', CFG.SHORT_DELAY_MS, () => save.click());
    // [LIVE-TODO] 保存後のリダイレクト先を実機で確認。setup再表示なら下のhandleSetupが拾ってロビーへ戻す。
  }

  // ===== lobby: scratch btst を選択して BATTLE START =====
  function selectAndStart() {
    const form = q(document, 'form#btlb_form_battle');
    if (!form) return updatePanel('rumble対戦フォーム(form#btlb_form_battle)未検出。手動で確認してください');
    const sel = q(form, 'select[name="btst_ally"]');
    if (sel) { const opt = qa(sel, 'option').find(o => String((o.dataset && o.dataset.btst) || (o.value || '').split(',')[0]) === String(CFG.SCRATCH_BTST)); if (opt) setSelectValue(sel, opt.value); }
    const styleLi = qa(form, 'ul.battle_style li[data-style]').find(li => String(li.dataset.style) === String(CFG.SCRATCH_BTST));
    if (styleLi) click(styleLi);
    const start = q(form, 'input[name="bt_start"], input.bt_start, input[type="submit"]');
    if (!start) return updatePanel('BATTLE START未検出');
    // [LIVE-TODO] rumbleでFIELD SETTINGカウントダウンが出るか実機確認。出るならdisabled/値監視で待機を挟む。
    if (start.disabled) return schedule('開始待機', 1000, selectAndStart);
    setPhase('battling');
    // 旧: start.click() で battle_view.php へ遷移していた。
    // 新(v0.9.0): フォームをfetchでPOSTし、画面遷移せずロビーへ戻る（AARと同方式）。
    schedule('BATTLE START（fetch送信・遷移なし）', pickDelay(), () => submitBattleViaFetch(form, start, 0));
  }

  // rumble対戦フォームをfetchでPOST（画面遷移なし）→ 結果ページ(battle_view.php)は踏まず、次戦のためロビーへ。
  // RARは結果ページから何も読まない（旧handleResultはscan復帰のみ）。進行は次ロビーの
  // scrapeStreak（連勝数）再読込で判定するため、ここで勝敗を取得する必要はない。
  async function submitBattleViaFetch(form, start, retryCount) {
    if (!isEnabled()) return;
    retryCount = retryCount || 0;
    let ok = false;
    try {
      const body = new URLSearchParams(new FormData(form));
      // submitボタンの値はFormDataに含まれないので明示付与
      if (start && start.name) body.set(start.name, start.value || 'BATTLE START');
      const res = await fetch(form.action, {
        method: (form.method || 'POST').toUpperCase(),
        body, credentials: 'include', redirect: 'follow',
      });
      ok = res.ok;
    } catch (e) {
      console.warn('[BO5 RAR] 対戦のfetch送信に失敗:', e);
      ok = false;
    }
    if (!isEnabled()) return;
    if (!ok) {
      if (retryCount >= 3) { setPhase('scan'); setDecision(null); return updatePanel('対戦のfetch送信に3回失敗。停止（手動で確認してください）'); }
      updatePanel(`送信失敗。再試行します（${retryCount + 1}/3）`);
      return setTimeout(() => { if (isEnabled()) submitBattleViaFetch(form, start, retryCount + 1); }, 3000);
    }
    // 送信成功 → 次戦のためロビーへ。phaseをscanに戻し decision をクリア（旧handleResult相当）。
    setPhase('scan'); setDecision(null);
    schedule('次戦へ（ロビー再読込）', CFG.SHORT_DELAY_MS, () => location.assign(CFG.LOBBY_URL));
  }

  // ===== handlers =====
  function handleLobby() {
    const phase = getPhase();
    if (phase === 'saved') { updatePanel('btst選択→出撃'); return selectAndStart(); }

    // 連勝数判定（N連勝中＝これからN+1戦目。0連勝時はspanが存在しない→null→0扱いで1戦目として処理）
    const streak = scrapeStreak() ?? 0;
    const battleNum = streak + 1;
    if (battleNum >= 31) return updatePanel(`${streak}連勝中＝${battleNum}戦目。31戦目以降は未対応のため自動停止。手動で対応してください`);

    if (battleNum >= 16) {
      // ===== 16-30戦目：enemy_btsetの型+使用回数シグネチャで武器特定→answerルックアップ =====
      const btsetSkills = scrapeEnemyBtset();
      if (!btsetSkills || !btsetSkills.length) return updatePanel('敵情報を取得できません（enemy_btset未取得）');
      const sigTable = buildSigTable();
      const sig = enemySignature(btsetSkills);
      const candidateIds = sigTable[sig] || [];
      if (!candidateIds.length) return updatePanel(`シグネチャ未一致: ${sig}\n（自動停止）`);
      const ansKey = resolveAnswerKey(candidateIds);
      if (!ansKey) {
        const candidateNames = candidateIds.map(id => BO5_WEAPONS[id].name).join(', ');
        return updatePanel(`GRP未登録の候補: ${candidateNames}\n（自動停止）`);
      }
      const ans16 = lookupAnswer(ansKey);
      if (!ans16) return updatePanel(`answer未登録キー: ${ansKey}（自動停止）`);
      const name2id16 = {};
      for (const id in BO5_WEAPONS) name2id16[BO5_WEAPONS[id].name] = id;
      const myWeaponId16 = name2id16[ans16.myWeapon];
      if (!myWeaponId16) return updatePanel(`answer自分武器が武器CSVに未登録: ${ans16.myWeapon}（自動停止）`);
      const seqIdx16 = resolveAnswerSeqIdx(myWeaponId16, ans16.seq);
      if (!seqIdx16) return updatePanel(`answer技名の解決失敗: ${ans16.seq.join('→')}（自動停止）`);
      setDecision({ weaponId: myWeaponId16, seqIdx: seqIdx16 });
      setPhase('deploy');
      updatePanel(`[${battleNum}戦目] 敵${ansKey}(${candidateIds.length}候補) → ${ans16.myWeapon}\n${ans16.seq.join('→')}\n(answerプリセット)\nsetupへ`);
      return schedule('setupへ', CFG.SHORT_DELAY_MS, () => location.assign(CFG.SETUP_URL));
    }

    const e = scrapeEnemy();
    if (!e || !e.enemySkills || !e.enemySkills.length) return updatePanel('敵情報を取得できません（enemy_weapon未取得）');

    // ===== 6-15戦目：answer.csv プリセット =====
    if (battleNum >= 6) {
      const ans = lookupAnswer(e.enemyName);
      if (!ans) return updatePanel(`answer未登録: ${e.enemyName}（自動停止）`);
      const name2id = {};
      if (BO5_WEAPONS) for (const id in BO5_WEAPONS) name2id[BO5_WEAPONS[id].name] = id;
      const myWeaponId = name2id[ans.myWeapon];
      if (!myWeaponId) return updatePanel(`answer自分武器が武器CSVに未登録: ${ans.myWeapon}（自動停止）`);
      const seqIdx = resolveAnswerSeqIdx(myWeaponId, ans.seq);
      if (!seqIdx) return updatePanel(`answer技名の解決失敗: ${ans.seq.join('→')}（自動停止）`);
      setDecision({ weaponId: myWeaponId, seqIdx });
      setPhase('deploy');
      updatePanel(`[${battleNum}戦目] 敵${e.enemyName} → ${ans.myWeapon}\n${ans.seq.join('→')}\n(answerプリセット)\nsetupへ`);
      return schedule('setupへ', CFG.SHORT_DELAY_MS, () => location.assign(CFG.SETUP_URL));
    }

    // ===== 1-5戦目：ソルバ =====
    if (e.revealedCount < 1) return updatePanel('開示スロット0＝1-5戦目の範囲外。手動で対応してください（自動停止）');
    const { ids, miss } = shortlistIds();
    if (miss.length) updatePanel('shortlist解決不能: ' + miss.join(','));
    const r = BO5_RAR.solve(BO5_WEAPONS, e.enemySkills, e.revealed, ids);
    if (r.error || !r.best) return updatePanel('解なし: ' + (r.error || ''));
    const b = r.best;
    setDecision({ weaponId: b.weaponId, seqIdx: b.seqIdx });
    setPhase('deploy');
    updatePanel(`[${battleNum}戦目] 敵${e.enemyName}(開示${e.revealedCount}) → ${b.weaponName}\n${b.seqNames.join('→')}\n${b.worst >= 0 ? '無敗保証' : '保証なし'} 勝${(b.pWin*100)|0}% 最悪${b.worst}\nsetupへ`);
    schedule('setupへ', CFG.SHORT_DELAY_MS, () => location.assign(CFG.SETUP_URL));
  }
  function handleSetup() {
    const phase = getPhase();
    if (phase === 'deploy') { const d = getDecision(); if (!d) { setPhase('scan'); return location.assign(CFG.LOBBY_URL); } return applyAndSave(d); }
    if (phase === 'saved') { updatePanel('保存完了。ロビーへ'); return schedule('ロビーへ', CFG.SHORT_DELAY_MS, () => location.assign(CFG.LOBBY_URL)); }
    updatePanel('setup（待機）');
  }
  function main() {
    const p = page();
    if (p === 'lobby') return handleLobby();
    if (p === 'setup') return handleSetup();
    updatePanel('対象外ページ');
  }

  async function boot() {
    installPanel(); refreshToggle();
    if (!isEnabled()) return updatePanel('OFF（ONで自動進行）');
    updatePanel('武器データ読込中...');
    try { await Promise.all([fetchWeapons(), fetchAnswer()]); } catch (e) { return updatePanel('CSVフェッチ失敗\n' + e.message); }
    main();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 500), { once: true });
  else setTimeout(boot, 500);
})();