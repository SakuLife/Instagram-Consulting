// ═══════════════════════════════════════════════════════════════
// Instagram運用管理スプレッドシート - GAS
// ═══════════════════════════════════════════════════════════════

var CONFIG = {
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',
  SHEET_POST: '① 投稿管理',
  SHEET_INSIGHT: '② 月次インサイト',
  SHEET_CALC: '③ 自動集計',
  SHEET_COMMENT: '④ 考察・コメント',
  SHEET_REPORT: '⑤ レポート出力',
  SHEET_CONCEPT: '⑥ コンセプト設計',
  SHEET_LINE: '⑦ LINE分析',
  SHEET_LINE_REPORT: '⑧ LINEレポート',
  LINE_DATA_START_ROW: 4,
  // 議事録処理用サービスアカウント（新規クライアントフォルダに自動で共有される）
  SERVICE_ACCOUNT_EMAIL: 'speak-ig-tools@instagramanalysis-494222.iam.gserviceaccount.com'
};

var DEFAULT_FOLDERS = {
  project: '1JeOkHpuhiS0V4ykFiUXyHydUG-C44YV4',
  report: '1ol1mRsL-xyYXSbJcIVnvRter9-xKNp-G',
  ssPost: '1S_hiDUja_Aq0FfacpAsmY82G95dXMa2t',
  ssAccount: '1kJ-Go0bwrF_CvHXMV1YTXFMrvQ1J5Dsj',
  lineCsv: '1cqo7FLgi94F9N7Ivv2hIvnr8h6914ywi',
  minutes: '1c8tduVZMFS8UqyPpa8Gc2Yd521zdbP-X'
};

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

function getFolderId_(key) {
  // 優先順: Script Properties → ⑥シート行30〜35のB列 → DEFAULT_FOLDERS
  // （テンプレートコピー直後はPropertiesが空のため、⑥のIDで正しいフォルダを向く）
  var prop = PropertiesService.getScriptProperties().getProperty('FOLDER_' + key.toUpperCase());
  if (prop) return prop;
  var rows = { project: 30, report: 31, ssPost: 32, ssAccount: 33, lineCsv: 34, minutes: 35 };
  if (rows[key]) {
    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CONCEPT);
      if (sheet) {
        var v = String(sheet.getRange(rows[key], 2).getValue() || '').trim();
        if (v.length > 10) return v;
      }
    } catch (e) {}
  }
  return DEFAULT_FOLDERS[key] || '';
}

function getClientName_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CONCEPT);
  if (!sheet) return '';
  var val = String(sheet.getRange('A2').getValue() || '');
  var match = val.match(/クライアント名[：:]\s*(.+)/);
  return match ? match[1].trim() : '';
}

// ═══ メニュー ═══
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📊 IG管理ツール')
    .addItem('🔧 全データ更新', 'refreshAllData')
    .addItem('🤖 AI考察を生成', 'generateAIComment')
    .addItem('📄 レポートをPDF出力', 'exportReportPDF')
    .addSeparator()
    .addItem('📸 投稿スクショ読み取り', 'readPostScreenshots')
    .addItem('📸 アカウントスクショ読み取り', 'readAccountScreenshots')
    .addSeparator()
    .addItem('📋 テンプレートをコピー', 'copyTemplate')
    .addSeparator()
    .addItem('📱 LINE CSVを取り込み', 'importLineCSV')
    .addItem('📱 LINE AI考察を生成', 'generateLineAIComment')
    .addItem('📱 LINEレポートをPDF出力', 'exportLinePDF')
    .addSeparator()
    .addItem('📝 議事録を処理', 'processMinutes')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('⚙️ 設定')
      .addItem('🔑 Gemini APIキーを設定', 'setApiKey')
      .addItem('📁 フォルダ設定を反映', 'configureFolders')
      .addItem('📊 グラフを作成/再作成', 'createAllCharts')
      .addItem('🎨 シートの見た目を整える', 'beautifySheets')
      .addItem('🔍 APIキー動作テスト', 'testApiKey')
      .addItem('🚀 初期セットアップ（初回のみ）', 'initialSetup'))
    .addToUi();
}

// ═══ 設定系 ═══
function initialSetup() {
  var ui = SpreadsheetApp.getUi();
  if (!getApiKey_()) {
    var res = ui.prompt('Gemini APIキーを入力\n（https://aistudio.google.com/apikey で取得）', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() === ui.Button.OK && res.getResponseText().trim()) {
      PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', res.getResponseText().trim());
    }
  }
  refreshAllData();
  createAllCharts();
  setupConditionalFormatting_();
  beautifySheets();
  ui.alert('✅ 初期セットアップ完了！');
}

function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Gemini APIキーを入力', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK && res.getResponseText().trim()) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', res.getResponseText().trim());
    ui.alert('✅ 保存しました。');
  }
}

function testApiKey() {
  var apiKey = getApiKey_();
  if (!apiKey) { SpreadsheetApp.getUi().alert('❌ APIキー未設定'); return; }
  var url = CONFIG.GEMINI_ENDPOINT + CONFIG.GEMINI_MODEL + ':generateContent?key=' + apiKey;
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: 'テスト。「OK」とだけ返して。' }] }], generationConfig: { temperature: 0, maxOutputTokens: 50 } }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() === 200) {
      SpreadsheetApp.getUi().alert('✅ API接続成功！\n\n' + JSON.parse(r.getContentText()).candidates[0].content.parts[0].text);
    } else {
      SpreadsheetApp.getUi().alert('❌ エラー（' + r.getResponseCode() + '）\n\n' + r.getContentText().substring(0, 500));
    }
  } catch (e) { SpreadsheetApp.getUi().alert('❌ 接続エラー\n\n' + e.message); }
}

function configureFolders() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CONCEPT);
  if (!sheet) { ui.alert('❌ ⑥シートが見つかりません'); return; }
  var vals = sheet.getRange('B30:B35').getValues();
  var keys = ['PROJECT', 'REPORT', 'SSPOST', 'SSACCOUNT', 'LINECSV', 'MINUTES'];
  var props = PropertiesService.getScriptProperties();
  var count = 0;
  for (var i = 0; i < keys.length; i++) {
    var v = String(vals[i][0] || '').trim();
    if (v && v.length > 10) { props.setProperty('FOLDER_' + keys[i], v); count++; }
  }
  if (count === 0) {
    ui.alert('⑥シートの行30〜35のB列にフォルダIDが入力されていません。\n\n各DriveフォルダのURLからIDをコピーして貼り付けてください。');
    return;
  }
  ui.alert('✅ フォルダ設定を ' + count + '件反映しました！');
}


// ═══ 全データ更新 ═══
function refreshAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var calc = ss.getSheetByName(CONFIG.SHEET_CALC);
  var post = ss.getSheetByName(CONFIG.SHEET_POST);
  var insight = ss.getSheetByName(CONFIG.SHEET_INSIGHT);
  if (!calc || !post || !insight) { SpreadsheetApp.getUi().alert('❌ シートが見つかりません'); return; }
  ss.toast('全データを更新中...', '🔧');

  // B3から対象月を取得
  var b3raw = calc.getRange('B3').getValue();
  var targetMonth;
  if (b3raw instanceof Date) {
    targetMonth = b3raw.getFullYear() + '年' + (b3raw.getMonth() + 1) + '月';
    var ml = [];
    for (var yr = 2025; yr <= 2027; yr++) { for (var mo = 1; mo <= 12; mo++) { ml.push(yr + '年' + mo + '月'); } }
    calc.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ml, true).build()).setValue(targetMonth);
  } else {
    targetMonth = String(b3raw).trim();
  }

  var match = targetMonth.match(/(\d+)年(\d+)月/);
  if (!match) { SpreadsheetApp.getUi().alert('❌ B3不正: ' + targetMonth); return; }
  var tY = parseInt(match[1]), tM = parseInt(match[2]);
  calc.getRange('C4').setValue(tY);
  calc.getRange('E4').setValue(tM);

  // ①から対象月の投稿を抽出
  var postData = post.getRange('A4:J500').getValues();
  var monthPosts = [];
  for (var i = 0; i < postData.length; i++) {
    var row = postData[i];
    if (!row[0]) continue;
    var d;
    try { d = new Date(row[0]); if (isNaN(d.getTime())) continue; } catch (e) { continue; }
    if (d.getFullYear() === tY && (d.getMonth() + 1) === tM) {
      monthPosts.push({
        date: d, type: String(row[1]).trim(), content: String(row[2]),
        reach: Number(row[4]) || 0, plays: Number(row[5]) || 0, likes: Number(row[6]) || 0,
        saves: Number(row[7]) || 0, comments: Number(row[8]) || 0, follower: Number(row[9]) || 0
      });
    }
  }

  // 集計
  var pc = monthPosts.length, totalReach = 0, totalLikes = 0, totalSaves = 0, totalComments = 0, totalFollower = 0;
  for (var j = 0; j < monthPosts.length; j++) {
    totalReach += monthPosts[j].reach; totalLikes += monthPosts[j].likes;
    totalSaves += monthPosts[j].saves; totalComments += monthPosts[j].comments;
    totalFollower += monthPosts[j].follower;
  }
  var avgReach = pc > 0 ? Math.round(totalReach / pc) : 0;
  calc.getRange('A6').setValue(pc); calc.getRange('B6').setValue(totalReach);
  calc.getRange('C6').setValue(avgReach); calc.getRange('D6').setValue(totalLikes);
  calc.getRange('E6').setValue(totalSaves); calc.getRange('F6').setValue(totalComments);
  calc.getRange('G6').setValue(totalFollower);

  // ②からインサイト取得
  var insData = insight.getRange('A4:L50').getValues();
  var curIns = null, prevIns = null, prevMonth = getPrevMonthStr_(tY, tM);
  for (var k = 0; k < insData.length; k++) {
    var mv = String(insData[k][0]).trim();
    if (mv === targetMonth) curIns = insData[k];
    if (mv === prevMonth) prevIns = insData[k];
  }
  calc.getRange('H6').setValue(curIns ? (curIns[3] || 0) : 0);

  // 投稿種別パフォーマンス
  var typeNames = ['リール', 'フィード', 'ストーリーズ'];
  for (var t = 0; t < typeNames.length; t++) {
    var r = 21 + t;
    var typePosts = monthPosts.filter(function (p) { return p.type === typeNames[t]; });
    var tc2 = typePosts.length, tR = 0, tL = 0, tS = 0;
    for (var tp = 0; tp < typePosts.length; tp++) { tR += typePosts[tp].reach; tL += typePosts[tp].likes; tS += typePosts[tp].saves; }
    calc.getRange(r, 2).setValue(tc2);
    calc.getRange(r, 3).setValue(tc2 > 0 ? Math.round(tR / tc2) : 0).setNumberFormat('#,##0');
    calc.getRange(r, 4).setValue(tc2 > 0 ? Math.round(tL / tc2) : 0);
    calc.getRange(r, 5).setValue(tc2 > 0 ? Math.round(tS / tc2) : 0);
    calc.getRange(r, 6).setValue(pc > 0 ? tc2 / pc : 0).setNumberFormat('0.0%');
  }

  // TOP3
  monthPosts.sort(function (a, b) { return b.reach - a.reach; });
  for (var q = 0; q < 3; q++) {
    var r3 = 27 + q;
    if (q < monthPosts.length) {
      var p2 = monthPosts[q];
      calc.getRange(r3, 2).setValue(p2.content);
      calc.getRange(r3, 3).setValue(Utilities.formatDate(p2.date, Session.getScriptTimeZone(), 'M/d'));
      calc.getRange(r3, 4).setValue(p2.type);
      calc.getRange(r3, 5).setValue(p2.reach).setNumberFormat('#,##0');
      calc.getRange(r3, 6).setValue(p2.likes);
      calc.getRange(r3, 7).setValue(p2.saves);
      calc.getRange(r3, 8).setValue(p2.comments);
    } else {
      for (var cc = 2; cc <= 8; cc++) calc.getRange(r3, cc).setValue('');
    }
  }

  // アカウント全体インサイト
  var insCols = [3, 4, 5, 6, 7, 8, 9];
  for (var m2 = 0; m2 < 7; m2++) {
    var r4 = 33 + m2;
    var curVal = curIns ? (curIns[insCols[m2]] || '') : '';
    var prevVal = prevIns ? (prevIns[insCols[m2]] || '') : '—';
    if (m2 === 2 || m2 === 3) {
      calc.getRange(r4, 2).setValue(curVal).setNumberFormat('#,##0.0');
      calc.getRange(r4, 3).setValue(prevVal).setNumberFormat('#,##0.0');
    } else {
      calc.getRange(r4, 2).setValue(curVal).setNumberFormat('#,##0');
      calc.getRange(r4, 3).setValue(prevVal).setNumberFormat('#,##0');
    }
    if (curIns && prevIns && prevIns[insCols[m2]]) {
      var cv2 = curIns[insCols[m2]] || 0, pv3 = prevIns[insCols[m2]];
      if (m2 === 2 || m2 === 3) {
        calc.getRange(r4, 4).setValue((cv2 - pv3).toFixed(1) + 'pt');
      } else if (pv3 !== 0) {
        var pc3 = ((cv2 - pv3) / Math.abs(pv3) * 100).toFixed(1);
        calc.getRange(r4, 4).setValue(parseFloat(pc3) >= 0 ? '+' + pc3 + '%' : pc3 + '%');
      }
    } else {
      calc.getRange(r4, 4).setValue('—');
    }
  }

  // 前月比サマリー
  var prevPosts = [], pm2 = prevMonth.match(/(\d+)年(\d+)月/);
  if (pm2) {
    var py = parseInt(pm2[1]), pm3 = parseInt(pm2[2]);
    for (var ii = 0; ii < postData.length; ii++) {
      var r2 = postData[ii]; if (!r2[0]) continue;
      try {
        var d2 = new Date(r2[0]); if (isNaN(d2.getTime())) continue;
        if (d2.getFullYear() === py && (d2.getMonth() + 1) === pm3) {
          prevPosts.push({ reach: Number(r2[4]) || 0, likes: Number(r2[6]) || 0, saves: Number(r2[7]) || 0, comments: Number(r2[8]) || 0, follower: Number(r2[9]) || 0 });
        }
      } catch (e2) {}
    }
  }
  var ppc = prevPosts.length, ptr = 0, ptl = 0, pts = 0, ptc = 0, ptf = 0;
  for (var jj = 0; jj < prevPosts.length; jj++) { ptr += prevPosts[jj].reach; ptl += prevPosts[jj].likes; pts += prevPosts[jj].saves; ptc += prevPosts[jj].comments; ptf += prevPosts[jj].follower; }
  var par = ppc > 0 ? Math.round(ptr / ppc) : 0;
  var cV = [pc, totalReach, avgReach, totalLikes, totalSaves, totalComments, totalFollower];
  var pV = [ppc, ptr, par, ptl, pts, ptc, ptf];
  for (var mm = 0; mm < 7; mm++) {
    var r5 = 11 + mm;
    calc.getRange(r5, 2).setValue(cV[mm]).setNumberFormat('#,##0');
    calc.getRange(r5, 3).setValue(pV[mm]).setNumberFormat('#,##0');
    var diff = cV[mm] - pV[mm];
    calc.getRange(r5, 4).setValue(diff >= 0 ? '+' + diff : '' + diff);
    if (pV[mm] !== 0) {
      var pc4 = ((cV[mm] - pV[mm]) / Math.abs(pV[mm]) * 100).toFixed(1);
      calc.getRange(r5, 5).setValue(parseFloat(pc4) >= 0 ? '+' + pc4 + '%' : pc4 + '%');
    } else { calc.getRange(r5, 5).setValue('—'); }
    calc.getRange(r5, 6).setValue(diff >= 0 ? '▲' : '▽');
  }

  // グラフ用データ
  for (var gg = 0; gg < 3; gg++) {
    calc.getRange(81 + gg, 1).setValue(typeNames[gg]);
    calc.getRange(81 + gg, 2).setValue(calc.getRange(21 + gg, 3).getValue());
    calc.getRange(81 + gg, 3).setValue(calc.getRange(21 + gg, 4).getValue());
    calc.getRange(81 + gg, 4).setValue(calc.getRange(21 + gg, 5).getValue());
    calc.getRange(93 + gg, 1).setValue(typeNames[gg]);
    calc.getRange(93 + gg, 2).setValue(calc.getRange(21 + gg, 2).getValue());
  }
  for (var nn = 0; nn < insData.length && nn < 12; nn++) {
    if (!insData[nn][0]) break;
    calc.getRange(86 + nn, 1).setValue(insData[nn][0]);
    calc.getRange(86 + nn, 2).setValue(insData[nn][3] || 0);
    calc.getRange(86 + nn, 3).setValue(insData[nn][4] || 0);
    calc.getRange(86 + nn, 4).setValue(insData[nn][9] || 0);
  }

  buildReportSheet_();
  SpreadsheetApp.getUi().alert('✅ 全データ更新完了！\n\n対象月: ' + targetMonth + '\n投稿数: ' + pc + '件');
}

function getPrevMonthStr_(y, m) { var m2 = m - 1, y2 = y; if (m2 === 0) { m2 = 12; y2--; } return y2 + '年' + m2 + '月'; }


// ═══ グラフ・条件付き書式 ═══
function createAllCharts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = ss.getSheetByName(CONFIG.SHEET_CALC);
  var c = s.getCharts(); for (var i = 0; i < c.length; i++) s.removeChart(c[i]);
  s.insertChart(s.newChart().setChartType(Charts.ChartType.COLUMN).addRange(s.getRange('A80:D83')).setPosition(42, 1, 0, 0).setOption('title', '投稿種別パフォーマンス比較').setOption('width', 480).setOption('height', 300).setOption('legend', { position: 'bottom' }).setOption('colors', ['#E8734A', '#3B82F6', '#10B981']).setOption('bar', { groupWidth: '60%' }).build());
  s.insertChart(s.newChart().setChartType(Charts.ChartType.PIE).addRange(s.getRange('A92:B95')).setPosition(42, 5, 0, 0).setOption('title', 'コンテンツタイプ構成比').setOption('width', 400).setOption('height', 300).setOption('colors', ['#3B82F6', '#F59E0B', '#EC4899']).setOption('pieSliceText', 'percentage').build());
  s.insertChart(s.newChart().setChartType(Charts.ChartType.LINE).addRange(s.getRange('A85:C89')).setPosition(60, 1, 0, 0).setOption('title', '月次推移（閲覧数・リーチ）').setOption('width', 480).setOption('height', 300).setOption('colors', ['#1B2A4A', '#E8734A']).setOption('pointSize', 6).setOption('lineWidth', 3).build());
  s.insertChart(s.newChart().setChartType(Charts.ChartType.LINE).addRange(s.getRange('A85:A89')).addRange(s.getRange('D85:D89')).setPosition(60, 5, 0, 0).setOption('title', 'フォロワー数推移').setOption('width', 400).setOption('height', 300).setOption('colors', ['#10B981']).setOption('pointSize', 6).setOption('lineWidth', 3).build());
  ss.toast('グラフ4種を作成しました', '✅');
}

// ═══ シート整形（見た目の完成度を上げる一括処理） ═══
function beautifySheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('シートを整形中...', '🎨');

  // ① 投稿管理: 列幅・書式・プルダウン・ヘッダー固定
  var p = ss.getSheetByName(CONFIG.SHEET_POST);
  if (p) {
    p.setFrozenRows(3);
    var w1 = [95, 110, 320, 180, 90, 90, 80, 80, 90, 110];
    for (var i1 = 0; i1 < w1.length; i1++) p.setColumnWidth(i1 + 1, w1[i1]);
    p.getRange('A4:A500').setNumberFormat('yyyy/mm/dd').setHorizontalAlignment('center');
    p.getRange('E4:J500').setNumberFormat('#,##0').setHorizontalAlignment('center');
    p.getRange('B4:B500').setHorizontalAlignment('center').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['リール', 'フィード', 'ストーリーズ'], true).setAllowInvalid(true).build());
    p.getRange('A4:J500').setVerticalAlignment('middle');
  }

  // ② 月次インサイト: 書式・ヘッダー固定
  var ins = ss.getSheetByName(CONFIG.SHEET_INSIGHT);
  if (ins) {
    ins.setFrozenRows(3);
    ins.getRange('D4:E50').setNumberFormat('#,##0');
    ins.getRange('F4:G50').setNumberFormat('0.0"%"');
    ins.getRange('H4:J50').setNumberFormat('#,##0');
    ins.getRange('A4:L50').setVerticalAlignment('middle').setHorizontalAlignment('center');
  }

  // ③ 自動集計: 作業用エリアを目立たなくする
  var calc = ss.getSheetByName(CONFIG.SHEET_CALC);
  if (calc) {
    calc.hideRows(4); // 集計用の年・月セル（スクリプトからは引き続き使える）
    // グラフ用データ（行79〜97）は非表示にするとグラフが消えるため、薄いグレーで控えめに
    calc.getRange('A79:H97').setFontColor('#C0C4CC').setFontSize(8);
    calc.getRange('A79').setValue('▼ グラフ用データ（編集しないでください）');
  }

  // ④ 考察・コメント: 折り返し・上寄せ
  var cm = ss.getSheetByName(CONFIG.SHEET_COMMENT);
  if (cm) {
    cm.getRange('A6:L25').setWrap(true).setVerticalAlignment('top');
  }

  // ⑦ LINE分析: ヘッダー・書式・AI考察エリアを整備
  var line = ss.getSheetByName(CONFIG.SHEET_LINE);
  if (line) {
    line.setFrozenRows(3);
    var w7 = [110, 100, 130, 100, 100, 100, 100, 100, 100, 120, 130];
    for (var i7 = 0; i7 < w7.length; i7++) line.setColumnWidth(i7 + 1, w7[i7]);
    line.getRange(3, 1, 1, 11).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B2A4A')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    line.getRange(4, 1, 14, 11).setNumberFormat('#,##0').setHorizontalAlignment('center').setVerticalAlignment('middle');
    line.getRange(4, 1, 14, 1).setNumberFormat('@'); // 対象月は文字列のまま
    // AI考察エリア（見出し＋結合した記入ブロック）
    line.getRange('A18').setValue('■ AI考察（自動生成）').setFontWeight('bold').setFontColor('#E8734A');
    line.getRange('A19').setValue('📈 傾向と分析').setFontWeight('bold');
    line.getRange('A23').setValue('⚠️ 改善ポイント').setFontWeight('bold');
    try { line.getRange('A20:K22').merge(); } catch (e1) {}
    try { line.getRange('A24:K26').merge(); } catch (e2) {}
    line.getRange('A20:K22').setBackground('#EBF5FF').setWrap(true).setVerticalAlignment('top');
    line.getRange('A24:K26').setBackground('#FFF0EB').setWrap(true).setVerticalAlignment('top');
  }

  setupConditionalFormatting_();
  ss.toast('シート整形が完了しました', '✅');
}

function setupConditionalFormatting_() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CALC);
  s.clearConditionalFormatRules();
  var rules = [], ranges = [s.getRange('D11:E17'), s.getRange('D33:D39')];
  for (var i = 0; i < ranges.length; i++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('+').setFontColor('#10B981').setBold(true).setBackground('#ECFDF5').setRanges([ranges[i]]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('-').setFontColor('#EF4444').setBold(true).setBackground('#FEF2F2').setRanges([ranges[i]]).build());
  }
  var ev = s.getRange('F11:F17');
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('▲').setFontColor('#10B981').setBold(true).setRanges([ev]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('▽').setFontColor('#EF4444').setBold(true).setRanges([ev]).build());
  s.setConditionalFormatRules(rules);
}


// ═══ Gemini API ═══
function callGemini_(prompt, apiKey) {
  var url = CONFIG.GEMINI_ENDPOINT + CONFIG.GEMINI_MODEL + ':generateContent?key=' + apiKey;
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) { Logger.log('Gemini Error: ' + r.getResponseCode()); return null; }
    var j = JSON.parse(r.getContentText());
    if (j.candidates && j.candidates[0] && j.candidates[0].content) return j.candidates[0].content.parts[0].text;
    return null;
  } catch (e) { Logger.log('Gemini Exception: ' + e.message); return null; }
}


// ═══ AI考察 ═══
function generateAIComment() {
  var apiKey = getApiKey_();
  if (!apiKey) { SpreadsheetApp.getUi().alert('❌ APIキー未設定'); return; }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var calc = ss.getSheetByName(CONFIG.SHEET_CALC), cm = ss.getSheetByName(CONFIG.SHEET_COMMENT);
  var month = calc.getRange('B3').getValue();
  if (month instanceof Date) month = month.getFullYear() + '年' + (month.getMonth() + 1) + '月';
  ss.toast('AI考察を生成中...', '🤖');
  var d = collectData_(calc);
  var prompt = buildPrompt_(d, month);
  var result = callGemini_(prompt, apiKey);
  if (result) {
    var p = parseResponse_(result);
    cm.getRange('B3').setValue(month);
    cm.getRange('A6').setValue(p.trend); cm.getRange('A11').setValue(p.good);
    cm.getRange('A16').setValue(p.improve); cm.getRange('A21').setValue(p.next);
    buildReportSheet_();
    SpreadsheetApp.getUi().alert('✅ AI考察生成完了！');
  } else { SpreadsheetApp.getUi().alert('❌ 生成失敗'); }
}

function collectData_(s) {
  return {
    pc: s.getRange('A6').getValue(), tr: s.getRange('B6').getValue(), ar: s.getRange('C6').getValue(),
    tl: s.getRange('D6').getValue(), ts: s.getRange('E6').getValue(), tc: s.getRange('F6').getValue(),
    fc: s.getRange('G6').getValue(), imp: s.getRange('H6').getValue(),
    rc: s.getRange('B21').getValue(), ra: s.getRange('C21').getValue(),
    fdc: s.getRange('B22').getValue(), fda: s.getRange('C22').getValue(), sc: s.getRange('B23').getValue(),
    t1: s.getRange('B27').getValue(), t1r: s.getRange('E27').getValue(),
    t2: s.getRange('B28').getValue(), t2r: s.getRange('E28').getValue(),
    t3: s.getRange('B29').getValue(), t3r: s.getRange('E29').getValue(),
    fi: s.getRange('B35').getValue(), fo: s.getRange('B36').getValue(),
    pa: s.getRange('B37').getValue(), el: s.getRange('B38').getValue()
  };
}

function buildPrompt_(d, month) {
  var p = 'SNSマーケコンサルとして月次分析コメントを生成。\n\n対象月: ' + month + '\n';
  p += '投稿: ' + d.pc + '件/リーチ計:' + d.tr + '/平均:' + d.ar + '/いいね:' + d.tl + '/保存:' + d.ts + '/コメント:' + d.tc + '/フォロワー増:' + d.fc + '\n';
  p += '種別: リール' + d.rc + '件(平均' + d.ra + ')/フィード' + d.fdc + '件(平均' + d.fda + ')/ストーリーズ' + d.sc + '件\n';
  p += 'TOP3: 1.' + d.t1 + '(' + d.t1r + ') 2.' + d.t2 + '(' + d.t2r + ') 3.' + d.t3 + '(' + d.t3r + ')\n';
  p += '全体: 閲覧' + d.imp + '/フォロワー内' + d.fi + '%/外' + d.fo + '%/プロフ' + d.pa + '/リンク' + d.el;
  p += '\n\n以下4セクション、各3〜5行箇条書き（・）で具体的数値を含めて：\n【今月の傾向】\n【良かった点】\n【改善ポイント】\n【次月の施策】\n\n重要: マークダウン記法は一切使わず「・」の箇条書きのみ。';
  return p;
}

function parseResponse_(t) {
  var s = { trend: '', good: '', improve: '', next: '' };
  var m1 = t.match(/【今月の傾向】\n?([\s\S]*?)(?=【|$)/);
  var m2 = t.match(/【良かった点】\n?([\s\S]*?)(?=【|$)/);
  var m3 = t.match(/【改善ポイント】\n?([\s\S]*?)(?=【|$)/);
  var m4 = t.match(/【次月の施策】\n?([\s\S]*?)(?=【|$)/);
  if (m1) s.trend = m1[1].trim(); if (m2) s.good = m2[1].trim();
  if (m3) s.improve = m3[1].trim(); if (m4) s.next = m4[1].trim();
  return s;
}


// ═══ PDF出力 ═══
function exportReportPDF() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEET_REPORT);
  var month = ss.getSheetByName(CONFIG.SHEET_COMMENT).getRange('B3').getValue();
  if (month instanceof Date) month = month.getFullYear() + '年' + (month.getMonth() + 1) + '月';
  var fn = 'IGレポート_' + month + '.pdf';
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + sh.getSheetId()
    + '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false'
    + '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';
  var blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob().setName(fn);
  var pdfFolder = DriveApp.getFolderById(getFolderId_('report'));
  SpreadsheetApp.getUi().alert('✅ PDF保存完了\n' + fn + '\n' + pdfFolder.createFile(blob).getUrl());
}


// ═══ テンプレートコピー（フォルダ丸ごと） ═══
function copyTemplate() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('クライアント名を入力', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = res.getResponseText().trim();
  if (!name) { ui.alert('名前を入力してください'); return; }

  SpreadsheetApp.getActiveSpreadsheet().toast('クライアント環境を作成中...（1分ほどかかります）', '📂');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var parentFolders = DriveApp.getFileById(ss.getId()).getParents();
  var srcFolder = parentFolders.hasNext() ? parentFolders.next() : DriveApp.getRootFolder();

  // 新しいクライアントフォルダは現在のプロジェクトフォルダと「並び」に作成
  var gp = srcFolder.getParents();
  var targetParent = gp.hasNext() ? gp.next() : DriveApp.getRootFolder();

  // フォルダ構成を作成
  var projFolder = targetParent.createFolder('IG管理_' + name);
  var reportFolder = projFolder.createFolder('IGレポート');
  var ssFolder = projFolder.createFolder('IGインサイトスクショ');
  var ssPostFolder = ssFolder.createFolder('投稿');
  var ssAcctFolder = ssFolder.createFolder('アカウント');
  var lineFolder = projFolder.createFolder('LINE_CSV');
  var minFolder = projFolder.createFolder('議事録');
  minFolder.createFolder('録音');
  minFolder.createFolder('処理済み');
  minFolder.createFolder('文字起こし');
  minFolder.createFolder('出力');

  // 議事録処理用サービスアカウントにフォルダを共有（これがないと新環境で議事録が動かない）
  try { projFolder.addEditor(CONFIG.SERVICE_ACCOUNT_EMAIL); }
  catch (e) { Logger.log('SA共有スキップ: ' + e.message); }

  // ガイド類（プロジェクト直下のファイル）もコピー
  // スプシは別途データを空にしてコピーするため除外
  var srcFiles = srcFolder.getFiles();
  while (srcFiles.hasNext()) {
    var sf = srcFiles.next();
    if (sf.getId() === ss.getId()) continue;
    if (sf.getMimeType() === 'application/vnd.google-apps.spreadsheet') continue;
    try { sf.makeCopy(sf.getName(), projFolder); } catch (e) { Logger.log('copy skip: ' + sf.getName()); }
  }

  // スプシをコピーして新フォルダに移動
  var nss = ss.copy('Instagram管理ツール');
  var nf = DriveApp.getFileById(nss.getId());
  projFolder.addFile(nf);
  DriveApp.getRootFolder().removeFile(nf);

  // データクリア
  var p = nss.getSheetByName(CONFIG.SHEET_POST);
  if (p && p.getLastRow() >= 4) p.getRange(4, 1, p.getLastRow() - 3, 10).clearContent();
  var ins = nss.getSheetByName(CONFIG.SHEET_INSIGHT);
  if (ins && ins.getLastRow() >= 4) ins.getRange(4, 1, ins.getLastRow() - 3, 12).clearContent();
  var calc = nss.getSheetByName(CONFIG.SHEET_CALC);
  if (calc) { calc.getRange('A6:H6').clearContent(); calc.getRange('B11:F17').clearContent(); calc.getRange('B21:F23').clearContent(); calc.getRange('B27:H29').clearContent(); calc.getRange('B33:D39').clearContent(); }
  var cm = nss.getSheetByName(CONFIG.SHEET_COMMENT);
  if (cm) { cm.getRange('A6').setValue(''); cm.getRange('A11').setValue(''); cm.getRange('A16').setValue(''); cm.getRange('A21').setValue(''); cm.getRange('B3').setValue(''); }
  var rpt = nss.getSheetByName(CONFIG.SHEET_REPORT); if (rpt) rpt.clear();
  var lrpt = nss.getSheetByName(CONFIG.SHEET_LINE_REPORT); if (lrpt) lrpt.clear();
  var line = nss.getSheetByName(CONFIG.SHEET_LINE);
  if (line && line.getLastRow() >= 4) { line.getRange(4, 1, line.getLastRow() - 3, 11).clearContent(); line.getRange('A20').setValue(''); line.getRange('A24').setValue(''); }

  // ⑥にクライアント名とフォルダIDを自動設定
  var co = nss.getSheetByName(CONFIG.SHEET_CONCEPT);
  if (co) {
    co.getRange('A2').setValue('  クライアント名：' + name);
    co.getRange('A30').setValue('プロジェクトフォルダ'); co.getRange('B30').setValue(projFolder.getId());
    co.getRange('A31').setValue('IGレポート');          co.getRange('B31').setValue(reportFolder.getId());
    co.getRange('A32').setValue('スクショ（投稿）');     co.getRange('B32').setValue(ssPostFolder.getId());
    co.getRange('A33').setValue('スクショ（アカウント）'); co.getRange('B33').setValue(ssAcctFolder.getId());
    co.getRange('A34').setValue('LINE_CSV');            co.getRange('B34').setValue(lineFolder.getId());
    co.getRange('A35').setValue('議事録');               co.getRange('B35').setValue(minFolder.getId());
  }

  ui.alert('✅ クライアント環境を作成しました！\n\n'
    + '📂 IG管理_' + name + '（このフォルダと並びに作成）\n'
    + '　├ Instagram管理ツール（データ空の状態）\n'
    + '　├ セットアップガイド等の資料一式\n'
    + '　└ IGレポート / スクショ / LINE_CSV / 議事録 フォルダ\n\n'
    + '⚠️ 新しいスプシを開いて以下を実行:\n'
    + '1. ⚙️設定 → 🔑 APIキー設定\n'
    + '2. ⚙️設定 → 📁 フォルダ設定を反映\n'
    + '3. ⚙️設定 → 🚀 初期セットアップ\n'
    + '※ 議事録を使う場合は初回にGitHubトークンの入力も必要です\n\n' + nss.getUrl());
}


// ═══ ⑤ レポート出力シート自動構築 ═══
function buildReportSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rpt = ss.getSheetByName(CONFIG.SHEET_REPORT);
  var calc = ss.getSheetByName(CONFIG.SHEET_CALC);
  var cm = ss.getSheetByName(CONFIG.SHEET_COMMENT);
  var post = ss.getSheetByName(CONFIG.SHEET_POST);
  if (!rpt || !calc || !cm || !post) return;

  var month = calc.getRange('B3').getValue();
  if (month instanceof Date) month = month.getFullYear() + '年' + (month.getMonth() + 1) + '月';
  var mm = String(month).match(/(\d+)年(\d+)月/); if (!mm) return;
  var tY = parseInt(mm[1]), tM = parseInt(mm[2]);
  var clientName = getClientName_() || '（クライアント名未設定）';

  rpt.clear();
  rpt.setHiddenGridlines(true);
  var colW = [28, 154, 154, 154, 154, 154, 154, 28];
  for (var cw = 0; cw < colW.length; cw++) rpt.setColumnWidth(cw + 1, colW[cw]);
  var r = 1;

  // ヘッダー
  rpt.getRange(r, 1, 1, 8).merge().setValue('お打ち合わせ内容').setFontSize(20).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B2A4A').setHorizontalAlignment('center').setVerticalAlignment('middle');
  rpt.setRowHeight(r, 50); r++;
  rpt.getRange(r, 2, 1, 3).merge().setValue(clientName + ' 様').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A');
  rpt.getRange(r, 5, 1, 3).merge().setValue(month).setFontSize(11).setFontColor('#6B7280').setHorizontalAlignment('right');
  r += 2;

  // はじめに
  rpt.getRange(r, 2, 1, 6).merge().setValue('はじめに').setFontSize(13).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  rpt.getRange(r, 2, 2, 6).merge().setValue('本日もお忙しい中、お打ち合わせのお時間をいただき誠にありがとうございます。\nどうぞよろしくお願いいたします。').setFontSize(10).setVerticalAlignment('top').setWrap(true);
  r += 3;

  // アジェンダ
  rpt.getRange(r, 2, 1, 6).merge().setValue('本日のアジェンダ').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  var ag = ['前回のお打ち合わせ内容と進捗', 'Instagramのインサイトについてご報告', '総合評価・改善ポイント', '今後の施策'];
  for (var a = 0; a < ag.length; a++) {
    rpt.getRange(r, 2).setValue('0' + (a + 1)).setFontSize(14).setFontWeight('bold').setFontColor('#E8734A').setHorizontalAlignment('center');
    rpt.getRange(r, 3, 1, 5).merge().setValue(ag[a]).setFontSize(11); r++;
  }
  r++;

  // 投稿一覧
  rpt.getRange(r, 2, 1, 6).merge().setValue('■ ' + tM + '月の投稿一覧').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  rpt.getRange(r, 2, 1, 2).merge().setValue('投稿日').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center');
  rpt.getRange(r, 4).setValue('種別').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center');
  rpt.getRange(r, 5, 1, 3).merge().setValue('投稿内容').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A'); r++;
  var pd2 = post.getRange('A4:J500').getValues(), pc2 = 0;
  for (var pi = 0; pi < pd2.length; pi++) {
    var pr = pd2[pi]; if (!pr[0]) continue;
    var pd3; try { pd3 = new Date(pr[0]); if (isNaN(pd3.getTime())) continue; } catch (e) { continue; }
    if (pd3.getFullYear() === tY && (pd3.getMonth() + 1) === tM) {
      rpt.getRange(r, 2, 1, 2).merge().setValue(Utilities.formatDate(pd3, Session.getScriptTimeZone(), 'yyyy/M/d')).setFontSize(9).setHorizontalAlignment('center');
      rpt.getRange(r, 4).setValue(String(pr[1]).trim()).setFontSize(9).setHorizontalAlignment('center');
      rpt.getRange(r, 5, 1, 3).merge().setValue(String(pr[2])).setFontSize(9);
      for (var bc = 2; bc <= 7; bc++) rpt.getRange(r, bc).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
      if (pc2 % 2 === 1) rpt.getRange(r, 2, 1, 6).setBackground('#F8F9FA');
      pc2++; r++;
    }
  }
  r++;

  // 全体インサイト
  rpt.getRange(r, 2, 1, 6).merge().setValue('■ 全体のインサイト').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  rpt.getRange(r, 2, 1, 2).merge().setValue('指標').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center');
  rpt.getRange(r, 4, 1, 2).merge().setValue('今月').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center');
  rpt.getRange(r, 6, 1, 2).merge().setValue('増減率').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center'); r++;
  var iL = ['閲覧数（インプレッション）', 'リーチしたアカウント数', 'フォロワーからの閲覧', 'フォロワー外からの閲覧', 'プロフィールアクセス', '外部リンクタップ', 'フォロワー数（月末）'];
  for (var i2 = 0; i2 < 7; i2++) {
    var iR = 33 + i2;
    rpt.getRange(r, 2, 1, 2).merge().setValue(iL[i2]).setFontSize(10);
    var cv = calc.getRange(iR, 2).getValue();
    if (i2 === 2 || i2 === 3) { rpt.getRange(r, 4, 1, 2).merge().setValue(cv ? cv + '%' : '').setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center'); }
    else { rpt.getRange(r, 4, 1, 2).merge().setValue(cv).setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('#,##0'); }
    rpt.getRange(r, 6, 1, 2).merge().setValue(calc.getRange(iR, 4).getValue()).setFontSize(10).setHorizontalAlignment('center');
    for (var bc2 = 2; bc2 <= 7; bc2++) rpt.getRange(r, bc2).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
    if (i2 % 2 === 1) rpt.getRange(r, 2, 1, 6).setBackground('#F8F9FA'); r++;
  }
  r++;

  // コンテンツタイプ別
  rpt.getRange(r, 2, 1, 6).merge().setValue('■ コンテンツタイプ別パフォーマンス').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  var th = ['種別', '投稿数', '平均リーチ', '平均いいね', '平均保存', '構成比'];
  for (var th2 = 0; th2 < th.length; th2++) rpt.getRange(r, 2 + th2).setValue(th[th2]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#E8734A').setHorizontalAlignment('center');
  r++;
  var tn2 = ['リール', 'フィード', 'ストーリーズ'];
  for (var ti = 0; ti < 3; ti++) {
    var tr2 = 21 + ti;
    rpt.getRange(r, 2).setValue(tn2[ti]).setFontWeight('bold');
    rpt.getRange(r, 3).setValue(calc.getRange(tr2, 2).getValue()).setHorizontalAlignment('center');
    rpt.getRange(r, 4).setValue(calc.getRange(tr2, 3).getValue()).setHorizontalAlignment('center').setNumberFormat('#,##0');
    rpt.getRange(r, 5).setValue(calc.getRange(tr2, 4).getValue()).setHorizontalAlignment('center');
    rpt.getRange(r, 6).setValue(calc.getRange(tr2, 5).getValue()).setHorizontalAlignment('center');
    rpt.getRange(r, 7).setValue(calc.getRange(tr2, 6).getValue()).setHorizontalAlignment('center').setNumberFormat('0.0%');
    for (var bc3 = 2; bc3 <= 7; bc3++) rpt.getRange(r, bc3).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
    r++;
  }
  r++;

  // TOP3
  rpt.getRange(r, 2, 1, 6).merge().setValue('■ リーチ上位 TOP3').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  rpt.getRange(r, 2).setValue('順位').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#8B7021').setHorizontalAlignment('center');
  rpt.getRange(r, 3, 1, 3).merge().setValue('投稿内容').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#8B7021');
  rpt.getRange(r, 6).setValue('リーチ').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#8B7021').setHorizontalAlignment('center');
  rpt.getRange(r, 7).setValue('投稿日').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#8B7021').setHorizontalAlignment('center'); r++;
  for (var ti2 = 0; ti2 < 3; ti2++) {
    var tr3 = 27 + ti2;
    rpt.getRange(r, 2).setValue((ti2 + 1) + '位').setFontWeight('bold').setHorizontalAlignment('center');
    rpt.getRange(r, 3, 1, 3).merge().setValue(calc.getRange(tr3, 2).getValue());
    rpt.getRange(r, 6).setValue(calc.getRange(tr3, 5).getValue()).setFontWeight('bold').setFontColor('#E8734A').setHorizontalAlignment('center').setNumberFormat('#,##0');
    rpt.getRange(r, 7).setValue(calc.getRange(tr3, 3).getValue()).setHorizontalAlignment('center');
    for (var bc4 = 2; bc4 <= 7; bc4++) rpt.getRange(r, bc4).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
    r++;
  }
  r++;

  // 月間サマリー
  rpt.getRange(r, 2, 1, 6).merge().setValue('■ 月間サマリー（前月比較）').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  var sh = ['指標', '今月', '前月', '増減', '増減率', '評価'];
  for (var s2 = 0; s2 < sh.length; s2++) rpt.getRange(r, 2 + s2).setValue(sh[s2]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center');
  r++;
  var sL = ['投稿数', '合計リーチ', '平均リーチ', '合計いいね', '合計保存', '合計コメント', 'フォロワー増減'];
  for (var si = 0; si < 7; si++) {
    var sr = 11 + si;
    rpt.getRange(r, 2).setValue(sL[si]);
    rpt.getRange(r, 3).setValue(calc.getRange(sr, 2).getValue()).setHorizontalAlignment('center').setNumberFormat('#,##0');
    rpt.getRange(r, 4).setValue(calc.getRange(sr, 3).getValue()).setHorizontalAlignment('center').setNumberFormat('#,##0');
    rpt.getRange(r, 5).setValue(calc.getRange(sr, 4).getValue()).setHorizontalAlignment('center');
    rpt.getRange(r, 6).setValue(calc.getRange(sr, 5).getValue()).setHorizontalAlignment('center');
    rpt.getRange(r, 7).setValue(calc.getRange(sr, 6).getValue()).setHorizontalAlignment('center');
    for (var bc5 = 2; bc5 <= 7; bc5++) rpt.getRange(r, bc5).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
    r++;
  }
  r++;

  // AI考察4セクション
  var trend = cm.getRange('A6').getValue(), good = cm.getRange('A11').getValue();
  var improve = cm.getRange('A16').getValue(), nextPlan = cm.getRange('A21').getValue();
  var secs = [
    { t: '■ 総合評価', x: trend, c: '#1B2A4A', bg: '#EBF5FF' },
    { t: '■ 良かった点', x: good, c: '#10B981', bg: '#ECFDF5' },
    { t: '■ 改善ポイント', x: improve, c: '#F59E0B', bg: '#FFFBEB' },
    { t: '■ 次月の施策', x: nextPlan, c: '#E8734A', bg: '#FFF0EB' }
  ];
  for (var sc = 0; sc < secs.length; sc++) {
    var s3 = secs[sc]; if (!s3.x) continue;
    rpt.getRange(r, 2, 1, 6).merge().setValue(s3.t).setFontSize(12).setFontWeight('bold').setFontColor(s3.c); r++;
    var ln = String(s3.x).split('\n').length, rw = Math.max(ln, 3);
    rpt.getRange(r, 2, rw, 6).merge().setValue(s3.x).setFontSize(10).setVerticalAlignment('top').setWrap(true).setBackground(s3.bg);
    r += rw + 1;
  }

  r++;
  rpt.getRange(r, 2, 1, 6).merge().setValue('※ このレポートは自動生成されています。').setFontSize(8).setFontColor('#9CA3AF').setFontStyle('italic');
  rpt.getRange('A1:H' + r).setFontFamily('Arial');

  // 編集ルールをメモで明示（メモはPDFには印刷されない）
  rpt.getRange('A1').setNote('【このシートの編集について】\n'
    + 'このシートは「全データ更新」「AI考察を生成」を実行するたびに自動で作り直されます。\n\n'
    + '❌ セルへの直接入力・文字修正 → 更新時に消えます\n'
    + '　（コメント文の修正は ④考察・コメント シートで行ってください。⑤に反映されます）\n\n'
    + '✅ ロゴ・写真などの画像 → メニュー「挿入 > 画像 > セルの上に画像を挿入」で配置すればOK\n'
    + '　（画像は更新後もそのまま残ります。1回配置すれば毎月使えます）');
}


// ═══ LINE分析 ═══
function importLineCSV() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LINE);
  if (!sheet) { sheet = ss.insertSheet(CONFIG.SHEET_LINE); setupLineSheet_(sheet); }

  var folder;
  try { folder = DriveApp.getFolderById(getFolderId_('lineCsv')); }
  catch (e) { SpreadsheetApp.getUi().alert('❌ LINE_CSVフォルダが見つかりません'); return; }

  var files = folder.getFiles(), fD = null, mD = null;
  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf('.csv') < 0 && file.getMimeType() !== 'text/csv') continue;
    var content = file.getBlob().getDataAsString('UTF-8');
    var lines = content.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (lines.length < 2) continue;
    var header = lines[0].replace(/\ufeff/g, '');
    if (header.indexOf('contacts') >= 0) {
      fD = parseCSV_(lines);
      file.moveTo(getOrCreateSub_(folder, '処理済み'));
    } else if (header.indexOf('AUTO_RESPONSE') >= 0 || header.indexOf('CRM_CHAT') >= 0) {
      mD = parseCSV_(lines);
      file.moveTo(getOrCreateSub_(folder, '処理済み'));
    }
  }
  if (!fD && !mD) { SpreadsheetApp.getUi().alert('📁 対応CSVが見つかりません'); return; }
  var monthly = aggregate_(fD, mD);
  writeLineData_(sheet, monthly);
  SpreadsheetApp.getUi().alert('✅ LINE CSV取り込み完了！\n\n' + monthly.month);
}

function parseCSV_(lines) {
  var h = lines[0].replace(/\ufeff/g, '').split(','), rows = [];
  for (var i = 1; i < lines.length; i++) {
    var c = lines[i].split(','); if (c.length < h.length) continue;
    var o = {};
    for (var j = 0; j < h.length; j++) o[h[j].trim()] = c[j].trim();
    rows.push(o);
  }
  return rows;
}

function aggregate_(fR, mR) {
  var r = { month: '', friends: 0, targetReach: 0, newFriends: 0, newBlocks: 0, autoResponse: 0, crmChat: 0, apiPush: 0, apiReply: 0, totalMessages: 0 };
  if (fR && fR.length > 0) {
    var f = fR[0], l = fR[fR.length - 1], ds = l.date || '';
    if (ds.length === 8) r.month = parseInt(ds.substring(0, 4)) + '年' + parseInt(ds.substring(4, 6)) + '月';
    r.friends = parseInt(l.contacts) || 0; r.targetReach = parseInt(l.targetReaches) || 0;
    r.newFriends = (parseInt(l.contacts) || 0) - (parseInt(f.contacts) || 0);
    r.newBlocks = (parseInt(l.blocks) || 0) - (parseInt(f.blocks) || 0);
  }
  if (mR && mR.length > 0) {
    for (var i = 0; i < mR.length; i++) { r.autoResponse += parseInt(mR[i].AUTO_RESPONSE) || 0; r.crmChat += parseInt(mR[i].CRM_CHAT) || 0; r.apiPush += parseInt(mR[i].API_PUSH) || 0; r.apiReply += parseInt(mR[i].API_REPLY) || 0; }
    r.totalMessages = r.autoResponse + r.crmChat + r.apiPush + r.apiReply;
    if (!r.month && mR.length > 0) { var d2 = mR[mR.length - 1].date || ''; if (d2.length === 8) r.month = parseInt(d2.substring(0, 4)) + '年' + parseInt(d2.substring(4, 6)) + '月'; }
  }
  return r;
}

function writeLineData_(sheet, data) {
  var wr = CONFIG.LINE_DATA_START_ROW;
  for (var r = CONFIG.LINE_DATA_START_ROW; r <= 17; r++) {
    var v = sheet.getRange(r, 1).getValue();
    if (v === data.month) { wr = r; break; }
    if (!v || String(v).trim() === '') { wr = r; break; }
    wr = r + 1;
  }
  if (wr > 17) { SpreadsheetApp.getUi().alert('❌ LINEデータが上限です'); return; }
  sheet.getRange(wr, 1, 1, 11).setValues([[data.month, data.friends, data.targetReach, data.newFriends, data.newBlocks, data.autoResponse, data.crmChat, data.apiPush, data.apiReply, data.totalMessages, '']]);
  if (wr > CONFIG.LINE_DATA_START_ROW) {
    var pf = sheet.getRange(wr - 1, 2).getValue();
    if (pf) sheet.getRange(wr, 11).setValue(data.friends - pf);
  }
}

function setupLineSheet_(s) {
  var h = ['対象月', '友だち数', 'ターゲットリーチ', '新規友だち', '新規ブロック', '自動応答', 'チャット', 'API配信', 'API返信', '合計メッセージ', '前月友だち増減'];
  s.getRange(3, 1, 1, h.length).setValues([h]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B2A4A');
  s.getRange('A1').setValue('  📱  公式LINE分析シート').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF');
  s.getRange('A1:K1').setBackground('#2D4A7A');
  s.getRange('A18').setValue('■ AI考察（自動生成）').setFontWeight('bold').setFontColor('#E8734A');
  s.getRange('A19').setValue('📈 傾向').setFontWeight('bold'); s.getRange('A20:K22').setBackground('#EBF5FF');
  s.getRange('A23').setValue('⚠️ 改善点').setFontWeight('bold'); s.getRange('A24:K26').setBackground('#FFF0EB');
}

function generateLineAIComment() {
  var apiKey = getApiKey_(); if (!apiKey) { SpreadsheetApp.getUi().alert('❌ APIキー未設定'); return; }
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getSheetByName(CONFIG.SHEET_LINE);
  if (!sheet) return;
  ss.toast('LINE AI考察生成中...', '🤖');
  var lr = sheet.getLastRow(), rc = Math.min(lr - CONFIG.LINE_DATA_START_ROW + 1, 6);
  if (rc < 1) return;
  var data = sheet.getRange(CONFIG.LINE_DATA_START_ROW, 1, rc, 11).getValues();
  var prompt = '公式LINEの月次データを分析。\n\n';
  for (var i = 0; i < data.length; i++) {
    var rr = data[i];
    prompt += rr[0] + ': 友だち' + rr[1] + '人 新規+' + rr[3] + ' ブロック+' + rr[4] + ' メッセージ計' + rr[9] + '通\n';
  }
  prompt += '\n各3〜5行箇条書き（・）で：\n【傾向と分析】\n【改善ポイント】\n\n「・」の箇条書きのみ。';
  var result = callGemini_(prompt, apiKey);
  if (result) {
    var tm = result.match(/【傾向と分析】\n?([\s\S]*?)(?=【|$)/);
    var im = result.match(/【改善ポイント】\n?([\s\S]*?)(?=【|$)/);
    if (tm) sheet.getRange('A20').setValue(tm[1].trim());
    if (im) sheet.getRange('A24').setValue(im[1].trim());
    SpreadsheetApp.getUi().alert('✅ LINE AI考察完了！');
  } else { SpreadsheetApp.getUi().alert('❌ 生成失敗'); }
}

function getOrCreateSub_(parent, name) {
  var s = parent.getFoldersByName(name);
  return s.hasNext() ? s.next() : parent.createFolder(name);
}


// ═══ LINEレポートPDF出力 ═══
function exportLinePDF() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var line = ss.getSheetByName(CONFIG.SHEET_LINE);
  if (!line) { SpreadsheetApp.getUi().alert('❌ ⑦LINE分析シートがありません'); return; }
  ss.toast('LINEレポートを作成中...', '📱');

  var month = buildLineReportSheet_();
  if (!month) { SpreadsheetApp.getUi().alert('❌ ⑦LINE分析にデータがありません。先にCSVを取り込んでください。'); return; }
  SpreadsheetApp.flush();

  var rpt = ss.getSheetByName(CONFIG.SHEET_LINE_REPORT);
  var fn = 'LINEレポート_' + month + '.pdf';
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + rpt.getSheetId()
    + '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false'
    + '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';
  var blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob().setName(fn);
  var pdfFolder = DriveApp.getFolderById(getFolderId_('report'));
  SpreadsheetApp.getUi().alert('✅ LINEレポートPDF保存完了\n' + fn + '\n' + pdfFolder.createFile(blob).getUrl());
}

// ⑧LINEレポートシートを自動構築。最新月の文字列を返す（データなしはnull）
function buildLineReportSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var line = ss.getSheetByName(CONFIG.SHEET_LINE);
  if (!line) return null;

  // ⑦のデータ行（4〜17行）を収集
  var vals = line.getRange(CONFIG.LINE_DATA_START_ROW, 1, 17 - CONFIG.LINE_DATA_START_ROW + 1, 11).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] && String(vals[i][0]).trim() !== '') rows.push(vals[i]);
  }
  if (rows.length === 0) return null;
  var latest = String(rows[rows.length - 1][0]);
  var clientName = getClientName_() || '（クライアント名未設定）';

  var rpt = ss.getSheetByName(CONFIG.SHEET_LINE_REPORT);
  if (!rpt) rpt = ss.insertSheet(CONFIG.SHEET_LINE_REPORT);
  rpt.clear();
  rpt.setHiddenGridlines(true);
  var colW = [28, 130, 110, 110, 110, 110, 110, 110, 28];
  for (var cw = 0; cw < colW.length; cw++) rpt.setColumnWidth(cw + 1, colW[cw]);
  var r = 1;

  // ヘッダー
  rpt.getRange(r, 1, 1, 9).merge().setValue('公式LINE 運用レポート').setFontSize(20).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B2A4A').setHorizontalAlignment('center').setVerticalAlignment('middle');
  rpt.setRowHeight(r, 50); r++;
  rpt.getRange(r, 2, 1, 4).merge().setValue(clientName + ' 様').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A');
  rpt.getRange(r, 6, 1, 3).merge().setValue(latest).setFontSize(11).setFontColor('#6B7280').setHorizontalAlignment('right');
  r += 2;

  // 最新月サマリー
  var cur = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
  rpt.getRange(r, 2, 1, 7).merge().setValue('■ ' + latest + ' サマリー').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  var sumH = ['指標', '今月', '前月', '増減'];
  for (var sh2 = 0; sh2 < sumH.length; sh2++) rpt.getRange(r, 2 + sh2).setValue(sumH[sh2]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#06C755').setHorizontalAlignment('center');
  r++;
  var items = [['友だち数', 1], ['ターゲットリーチ', 2], ['新規友だち', 3], ['新規ブロック', 4], ['合計メッセージ', 9]];
  for (var it = 0; it < items.length; it++) {
    var cv3 = Number(cur[items[it][1]]) || 0;
    var pv4 = prev ? (Number(prev[items[it][1]]) || 0) : null;
    rpt.getRange(r, 2).setValue(items[it][0]).setFontSize(10);
    rpt.getRange(r, 3).setValue(cv3).setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('#,##0');
    rpt.getRange(r, 4).setValue(pv4 !== null ? pv4 : '—').setFontSize(10).setHorizontalAlignment('center').setNumberFormat('#,##0');
    var df2 = (pv4 !== null) ? (cv3 - pv4) : null;
    rpt.getRange(r, 5).setValue(df2 !== null ? (df2 >= 0 ? '+' + df2 : String(df2)) : '—').setFontSize(10).setHorizontalAlignment('center');
    for (var bl = 2; bl <= 5; bl++) rpt.getRange(r, bl).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
    if (it % 2 === 1) rpt.getRange(r, 2, 1, 4).setBackground('#F8F9FA');
    r++;
  }
  r++;

  // 月次推移テーブル
  rpt.getRange(r, 2, 1, 7).merge().setValue('■ 月次推移').setFontSize(12).setFontWeight('bold').setFontColor('#1B2A4A'); r++;
  var th3 = ['対象月', '友だち数', '新規友だち', 'ブロック', 'メッセージ計', '友だち増減'];
  for (var t3 = 0; t3 < th3.length; t3++) rpt.getRange(r, 2 + t3).setValue(th3[t3]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2D4A7A').setHorizontalAlignment('center');
  r++;
  var cols = [0, 1, 3, 4, 9, 10];
  for (var rw2 = 0; rw2 < rows.length; rw2++) {
    for (var c2 = 0; c2 < cols.length; c2++) {
      var cell = rpt.getRange(r, 2 + c2).setValue(rows[rw2][cols[c2]]).setFontSize(10).setHorizontalAlignment('center');
      if (c2 > 0) cell.setNumberFormat('#,##0');
    }
    for (var bl2 = 2; bl2 <= 7; bl2++) rpt.getRange(r, bl2).setBorder(null, null, true, null, null, null, '#DEE2E6', SpreadsheetApp.BorderStyle.SOLID);
    if (rw2 % 2 === 1) rpt.getRange(r, 2, 1, 6).setBackground('#F8F9FA');
    r++;
  }
  r++;

  // AI考察（⑦のA20/A24から転記）
  var trend2 = line.getRange('A20').getValue(), improve2 = line.getRange('A24').getValue();
  var secs2 = [
    { t: '■ 傾向と分析', x: trend2, c: '#1B2A4A', bg: '#EBF5FF' },
    { t: '■ 改善ポイント', x: improve2, c: '#F59E0B', bg: '#FFFBEB' }
  ];
  for (var sc2 = 0; sc2 < secs2.length; sc2++) {
    var s4 = secs2[sc2]; if (!s4.x) continue;
    rpt.getRange(r, 2, 1, 7).merge().setValue(s4.t).setFontSize(12).setFontWeight('bold').setFontColor(s4.c); r++;
    var ln2 = String(s4.x).split('\n').length, rw3 = Math.max(ln2, 3);
    rpt.getRange(r, 2, rw3, 7).merge().setValue(s4.x).setFontSize(10).setVerticalAlignment('top').setWrap(true).setBackground(s4.bg);
    r += rw3 + 1;
  }

  r++;
  rpt.getRange(r, 2, 1, 7).merge().setValue('※ このレポートは自動生成されています。').setFontSize(8).setFontColor('#9CA3AF').setFontStyle('italic');
  rpt.getRange('A1:I' + r).setFontFamily('Arial');

  // 編集ルールをメモで明示
  rpt.getRange('A1').setNote('【このシートの編集について】\n'
    + 'このシートは「LINEレポートをPDF出力」を実行するたびに自動で作り直されます。\n'
    + '❌ セルへの直接入力 → 更新時に消えます（考察の修正は⑦シートのAI考察欄で）\n'
    + '✅ ロゴ・画像 → 「挿入 > 画像 > セルの上に画像を挿入」なら更新後も残ります');
  return latest;
}


// ═══ 議事録（GitHub Actions連携） ═══
function processMinutes() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var ghToken = props.getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    var res = ui.prompt('GitHub Personal Access Token を入力', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK || !res.getResponseText().trim()) return;
    ghToken = res.getResponseText().trim();
    props.setProperty('GITHUB_TOKEN', ghToken);
  }

  var ghOwner = props.getProperty('GITHUB_OWNER') || 'SakuLife';
  var ghRepo = props.getProperty('GITHUB_REPO') || 'Instagram-Consulting';

  var folder = DriveApp.getFolderById(getFolderId_('minutes'));
  var recSubs = folder.getFoldersByName('録音');
  if (!recSubs.hasNext()) { folder.createFolder('録音'); ui.alert('📁「録音」フォルダを作成しました。'); return; }

  var recFolder = recSubs.next(), files = recFolder.getFiles(), af = [];
  while (files.hasNext()) {
    var f = files.next(), n = f.getName(), ext = n.split('.').pop().toLowerCase();
    if (['m4a', 'mp3', 'wav', 'ogg', 'flac', 'webm', 'mp4'].indexOf(ext) >= 0) {
      af.push({ id: f.getId(), name: n, date: f.getDateCreated() });
    }
  }
  if (af.length === 0) { ui.alert('📁「録音」フォルダに音声ファイルがありません'); return; }

  var lt = '録音ファイル一覧:\n\n';
  for (var i = 0; i < af.length; i++) {
    lt += '  ' + (i + 1) + '. ' + af[i].name + '  (' + Utilities.formatDate(af[i].date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm') + ')\n';
  }
  lt += '\n番号を入力:';
  var fr = ui.prompt(lt, ui.ButtonSet.OK_CANCEL);
  if (fr.getSelectedButton() !== ui.Button.OK) return;
  var fn = parseInt(fr.getResponseText().trim());
  if (isNaN(fn) || fn < 1 || fn > af.length) { ui.alert('❌ 無効な番号'); return; }
  var sel = af[fn - 1];

  var cr = ui.prompt('クライアント名（Enterでスキップ）:', ui.ButtonSet.OK_CANCEL);
  if (cr.getSelectedButton() !== ui.Button.OK) return;
  var cn = cr.getResponseText().trim();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy年M月d日');
  var dr = ui.prompt('日付（Enterで今日: ' + today + '）:', ui.ButtonSet.OK_CANCEL);
  if (dr.getSelectedButton() !== ui.Button.OK) return;
  var md = dr.getResponseText().trim() || today;

  if (ui.alert('ファイル: ' + sel.name + '\nクライアント: ' + (cn || '未指定') + '\n日付: ' + md + '\n\n開始しますか？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // 出力用の空ファイルをユーザー名義で先に作成しておく
  // （サービスアカウントはストレージ容量を持たず新規ファイルを作れないため、中身の更新のみ行わせる）
  var prefix = cn ? md + '_' + cn : md;
  var txtFolder = getOrCreateSub_(folder, '文字起こし');
  var outFolder = getOrCreateSub_(folder, '出力');
  var tFile = txtFolder.createFile(prefix + '_文字起こし.txt', '（処理中です。完了まで15〜40分ほどお待ちください）', MimeType.PLAIN_TEXT);
  var mFile = outFolder.createFile(prefix + '_議事録.txt', '（処理中です。完了まで15〜40分ほどお待ちください）', MimeType.PLAIN_TEXT);

  var url = 'https://api.github.com/repos/' + ghOwner + '/' + ghRepo + '/actions/workflows/minutes.yml/dispatches';
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github.v3+json' },
      payload: JSON.stringify({ ref: 'main', inputs: {
        file_id: sel.id, file_name: sel.name, client_name: cn, meeting_date: md,
        folder_id: getFolderId_('minutes'),
        transcript_file_id: tFile.getId(), minutes_file_id: mFile.getId()
      } }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() === 204) {
      ui.alert('✅ 議事録処理を開始！\n\n完了まで15〜40分ほどかかります。\n「文字起こし」「出力」フォルダに作成された（処理中）ファイルが、完了すると自動で書き換わります。');
    } else {
      tFile.setTrashed(true); mFile.setTrashed(true);
      ui.alert('❌ 起動失敗（' + r.getResponseCode() + '）\n\n' + r.getContentText().substring(0, 500));
    }
  } catch (e) {
    tFile.setTrashed(true); mFile.setTrashed(true);
    ui.alert('❌ 接続エラー: ' + e.message);
  }
}


// ═══ IGスクショ読み取り ═══
function readPostScreenshots() {
  var apiKey = getApiKey_();
  if (!apiKey) { SpreadsheetApp.getUi().alert('❌ APIキー未設定'); return; }
  var folder = DriveApp.getFolderById(getFolderId_('ssPost'));
  var images = getImages_(folder);
  if (images.length === 0) { SpreadsheetApp.getUi().alert('📁「投稿」フォルダに画像がありません。'); return; }
  SpreadsheetApp.getActiveSpreadsheet().toast(images.length + '枚読み取り中...', '📸');

  var prompt = 'これらは同じInstagramアカウントの投稿インサイト画面を上から順にスクロールして撮った連続スクショです（' + images.length + '枚）。\n'
    + '画面の全投稿をJSON配列で抽出。同じ投稿が複数枚にまたがる場合は1回だけ。\n\n'
    + '出力形式（JSONのみ）:\n[\n  {\n'
    + '    "date": "投稿日（YYYY/MM/DD）",\n'
    + '    "type": "リール or フィード or ストーリーズ",\n'
    + '    "content": "投稿のタイトル（サムネイル画像やカバー画像内のタイトルテキストを優先。なければキャプション内容を短く要約）",\n'
    + '    "reach": リーチ数,\n'
    + '    "plays": 再生数（なければ0）,\n'
    + '    "likes": いいね数,\n'
    + '    "saves": 保存数,\n'
    + '    "comments": コメント数,\n'
    + '    "follower_change": この投稿経由のフォロー数（なければ0）,\n'
    + '    "confidence": "high/medium/low",\n'
    + '    "note": "読み取れなかった項目や不確かな値のメモ"\n'
    + '  }\n]\n値が表示されていない場合は0にしてnoteに理由を書く。JSONのみ出力。';

  var data = callVision_(images, prompt, apiKey);
  if (!data || !Array.isArray(data)) { SpreadsheetApp.getUi().alert('❌ 読み取り失敗'); return; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_POST);
  var existing = sheet.getRange('A4:J500').getValues();
  var mkr = -1, ldr = 3;
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i][0]).indexOf('▼') >= 0) { mkr = i + 4; break; }
    if (existing[i][0] && String(existing[i][0]).trim() !== '') { ldr = i + 4; }
  }
  var ws = (mkr > 0) ? mkr : ldr + 1;
  if (mkr > 0 && data.length > 0) { sheet.insertRowsBefore(mkr, data.length); ws = mkr; }
  var fmtSrc = sheet.getRange(4, 1, 1, 10);

  var written = 0, skipped = 0, warns = [];
  for (var p = 0; p < data.length; p++) {
    var post = data[p], isDup = false;
    for (var ex = 0; ex < existing.length; ex++) {
      var eD = String(existing[ex][0]).replace(/[-\/]/g, ''), pD = String(post.date || '').replace(/[-\/]/g, '');
      if (eD === pD && existing[ex][2] && String(existing[ex][2]).indexOf(String(post.content || '').substring(0, 10)) >= 0) { isDup = true; break; }
    }
    if (isDup) { skipped++; continue; }
    var rn = ws + written;
    fmtSrc.copyFormatToRange(sheet, 1, 10, rn, rn);
    sheet.getRange(rn, 1).setValue(post.date || '');
    sheet.getRange(rn, 2).setValue(post.type || '');
    sheet.getRange(rn, 3).setValue(post.content || '');
    sheet.getRange(rn, 5).setValue(post.reach || 0);
    sheet.getRange(rn, 6).setValue(post.plays || 0);
    sheet.getRange(rn, 7).setValue(post.likes || 0);
    sheet.getRange(rn, 8).setValue(post.saves || 0);
    sheet.getRange(rn, 9).setValue(post.comments || 0);
    sheet.getRange(rn, 10).setValue(post.follower_change || 0);
    written++;
    if (post.confidence === 'low' || post.note) {
      warns.push((post.date || '?') + ' ' + (post.content || '').substring(0, 15) + ': ' + (post.note || '確度low'));
    }
  }
  if (mkr > 0 && data.length > written + skipped) {
    var extra = data.length - written - skipped;
    if (extra > 0) sheet.deleteRows(ws + written, extra);
  }
  moveProcessed_(folder, images);
  var msg = '✅ 投稿データ ' + written + '件を①に書き込みました！\n（検出: ' + data.length + '件 / 重複スキップ: ' + skipped + '件）';
  if (warns.length > 0) { msg += '\n\n⚠️ 読み取り精度が低い可能性:\n' + warns.join('\n'); }
  SpreadsheetApp.getUi().alert(msg);
}

function readAccountScreenshots() {
  var apiKey = getApiKey_();
  if (!apiKey) { SpreadsheetApp.getUi().alert('❌ APIキー未設定'); return; }
  var folder = DriveApp.getFolderById(getFolderId_('ssAccount'));
  var images = getImages_(folder);
  if (images.length === 0) { SpreadsheetApp.getUi().alert('📁「アカウント」フォルダに画像がありません。'); return; }
  SpreadsheetApp.getActiveSpreadsheet().toast(images.length + '枚読み取り中...', '📸');

  var prompt = 'これらは同じInstagramアカウントのインサイト概要画面を上から順にスクロールして撮った連続スクショです（' + images.length + '枚）。\n'
    + '月次アカウントデータをJSONで抽出。\n\n出力形式（JSONのみ）:\n{\n'
    + '  "period_start": "集計期間開始日（M/D）",\n'
    + '  "period_end": "集計期間終了日（M/D）",\n'
    + '  "month": "対象月（終了日基準でYYYY年M月）",\n'
    + '  "impressions": 閲覧数,\n'
    + '  "reach": リーチしたアカウント数,\n'
    + '  "follower_reach_pct": フォロワーからの閲覧割合（数値。例: 9.2）,\n'
    + '  "non_follower_reach_pct": フォロワー以外の割合（数値。例: 90.8）,\n'
    + '  "profile_visits": プロフィールへのアクセス数,\n'
    + '  "link_clicks": 外部リンクタップ数,\n'
    + '  "followers": フォロワー数,\n'
    + '  "age_top": "最も割合が高い年齢層1つだけ（例: 25-34: 31%）",\n'
    + '  "gender_ratio": "性別比（表示されていれば。例: 男65:女35）",\n'
    + '  "follower_change": フォロワー増減数,\n'
    + '  "missing": ["読み取れなかった項目名"]\n'
    + '}\nmissingは必ず含める。全部読めたら空配列[]。表示されていない値は0か空文字にしてmissingに追加。JSONのみ出力。';

  var data = callVision_(images, prompt, apiKey);
  if (!data || typeof data !== 'object' || Array.isArray(data)) { SpreadsheetApp.getUi().alert('❌ 読み取り失敗'); return; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_INSIGHT);
  var month = data.month || '';
  var existing = sheet.getRange('A4:A50').getValues();
  var tr = sheet.getLastRow() + 1;
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i][0]).trim() === month) { tr = i + 4; break; }
  }

  sheet.getRange(4, 1, 1, 12).copyFormatToRange(sheet, 1, 12, tr, tr);
  sheet.getRange(tr, 1).setValue(month);
  sheet.getRange(tr, 2).setValue(data.period_start || '');
  sheet.getRange(tr, 3).setValue(data.period_end || '');
  sheet.getRange(tr, 4).setValue(data.impressions || 0);
  sheet.getRange(tr, 5).setValue(data.reach || 0);
  sheet.getRange(tr, 6).setValue(data.follower_reach_pct || 0);
  sheet.getRange(tr, 7).setValue(data.non_follower_reach_pct || 0);
  sheet.getRange(tr, 8).setValue(data.profile_visits || 0);
  sheet.getRange(tr, 9).setValue(data.link_clicks || 0);
  sheet.getRange(tr, 10).setValue(data.followers || 0);
  sheet.getRange(tr, 11).setValue(data.age_top || '');
  sheet.getRange(tr, 12).setValue(data.gender_ratio || '—');

  moveProcessed_(folder, images);
  var msg = '✅ アカウントインサイトを②に書き込みました！\n\n対象月: ' + month
    + '\n期間: ' + (data.period_start || '?') + ' - ' + (data.period_end || '?')
    + '\n閲覧数: ' + (data.impressions || 0) + '\nリーチ: ' + (data.reach || 0)
    + '\nフォロワー: ' + (data.followers || 0) + '\nフォロワー増減: ' + (data.follower_change || 0);
  if (data.missing && data.missing.length > 0) {
    msg += '\n\n⚠️ 読み取れなかった項目:\n・' + data.missing.join('\n・') + '\n\n手動で②を確認してください。';
  } else { msg += '\n\n全項目の読み取りに成功しました。'; }
  SpreadsheetApp.getUi().alert(msg);
}


// ── 共通ヘルパー ──
function getImages_(folder) {
  var f = folder.getFiles(), imgs = [];
  while (f.hasNext()) {
    var file = f.next(), ext = file.getName().split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].indexOf(ext) >= 0) imgs.push(file);
  }
  imgs.sort(function (a, b) { return a.getName().localeCompare(b.getName()); });
  return imgs;
}

function callVision_(images, prompt, apiKey) {
  var parts = [];
  for (var i = 0; i < images.length; i++) {
    var b = images[i].getBlob();
    parts.push({ inlineData: { mimeType: b.getContentType() || 'image/png', data: Utilities.base64Encode(b.getBytes()) } });
  }
  parts.push({ text: prompt });
  var url = CONFIG.GEMINI_ENDPOINT + CONFIG.GEMINI_MODEL + ':generateContent?key=' + apiKey;
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) { Logger.log('Vision Error: ' + r.getResponseCode()); return null; }
    var j = JSON.parse(r.getContentText());
    if (!j.candidates || !j.candidates[0]) return null;
    var t = j.candidates[0].content.parts[0].text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    return JSON.parse(t);
  } catch (e) { Logger.log('Vision Exception: ' + e.message); return null; }
}

function moveProcessed_(folder, files) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var subs = folder.getFoldersByName('処理済み');
  var top = subs.hasNext() ? subs.next() : folder.createFolder('処理済み');
  var ds = top.getFoldersByName(today);
  var df = ds.hasNext() ? ds.next() : top.createFolder(today);
  for (var i = 0; i < files.length; i++) { files[i].moveTo(df); }
}
