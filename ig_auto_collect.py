"""
Instagram自動データ取得スクリプト
ADB経由でスマホのInstagramインサイトをスクショ → Gemini Vision APIで数値読み取り → スプシに書き込み

使い方:
1. AndroidスマホをUSB接続、USBデバッグON
2. config.json にGemini APIキーとスプシIDを設定
3. python ig_auto_collect.py を実行
"""

import subprocess
import json
import time
import os
import sys
import base64
from datetime import datetime
from pathlib import Path

# ── 設定ファイル読み込み ──
CONFIG_FILE = Path(__file__).parent / 'config.json'
DEFAULT_CONFIG = {
    "gemini_api_key": "YOUR_GEMINI_API_KEY",
    "gemini_model": "gemini-2.0-flash",
    "spreadsheet_id": "YOUR_SPREADSHEET_ID",
    "screenshot_dir": "./screenshots",
    "adb_path": "adb",
    "wait_seconds": 2,
    "client_name": "石井組",
}

def load_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        print(f"設定ファイルを作成しました: {CONFIG_FILE}")
        print("config.json を編集してAPIキーとスプシIDを設定してください。")
        sys.exit(1)
    
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


# ═══════════════════════════════════════════
# ADB操作
# ═══════════════════════════════════════════
class ADBController:
    def __init__(self, adb_path='adb'):
        self.adb = adb_path
    
    def run(self, *args):
        cmd = [self.adb] + list(args)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.stdout.strip()
    
    def check_device(self):
        """デバイス接続確認"""
        output = self.run('devices')
        lines = output.strip().split('\n')
        devices = [l for l in lines[1:] if 'device' in l and 'unauthorized' not in l]
        if not devices:
            print("❌ Androidデバイスが見つかりません。")
            print("   - USBケーブルで接続してください")
            print("   - USBデバッグを有効にしてください")
            print("   - 「USBデバッグを許可しますか？」のダイアログでOKを押してください")
            return False
        print(f"✅ デバイス検出: {devices[0].split()[0]}")
        return True
    
    def screenshot(self, local_path):
        """スクリーンショット取得"""
        remote_path = '/sdcard/ig_screenshot.png'
        self.run('shell', 'screencap', '-p', remote_path)
        self.run('pull', remote_path, local_path)
        self.run('shell', 'rm', remote_path)
        return os.path.exists(local_path)
    
    def tap(self, x, y):
        """タップ"""
        self.run('shell', 'input', 'tap', str(x), str(y))
        time.sleep(0.5)
    
    def swipe(self, x1, y1, x2, y2, duration=300):
        """スワイプ"""
        self.run('shell', 'input', 'swipe', str(x1), str(y1), str(x2), str(y2), str(duration))
        time.sleep(0.5)
    
    def swipe_up(self):
        """画面を上にスクロール"""
        self.swipe(540, 1500, 540, 500, 400)
    
    def back(self):
        """戻るボタン"""
        self.run('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(0.5)
    
    def get_screen_size(self):
        """画面サイズ取得"""
        output = self.run('shell', 'wm', 'size')
        # "Physical size: 1080x2400"
        match = output.split(':')[-1].strip()
        w, h = match.split('x')
        return int(w), int(h)
    
    def open_instagram(self):
        """Instagramアプリを起動"""
        self.run('shell', 'am', 'start', '-n', 'com.instagram.android/.activity.MainTabActivity')
        time.sleep(3)


# ═══════════════════════════════════════════
# Gemini Vision API
# ═══════════════════════════════════════════
class GeminiVision:
    def __init__(self, api_key, model='gemini-2.0-flash'):
        self.api_key = api_key
        self.model = model
        self.endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    
    def read_screenshot(self, image_path, prompt):
        """スクショから情報を読み取る"""
        import urllib.request
        
        with open(image_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')
        
        payload = {
            "contents": [{
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": image_data
                        }
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 2000,
            }
        }
        
        url = f"{self.endpoint}?key={self.api_key}"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get('candidates'):
                    return result['candidates'][0]['content']['parts'][0]['text']
        except Exception as e:
            print(f"❌ Gemini API エラー: {e}")
        
        return None
    
    def extract_post_insights(self, image_path):
        """投稿インサイトのスクショから数値を抽出"""
        prompt = """この画像はInstagramの投稿インサイト画面です。
以下の情報をJSON形式で抽出してください。数値が見つからない場合はnullにしてください。

{
  "reach": リーチ数（数値のみ）,
  "impressions": インプレッション数,
  "likes": いいね数,
  "saves": 保存数,
  "comments": コメント数,
  "plays": 再生数（リールの場合）,
  "post_type": "リール" or "フィード" or "ストーリーズ",
  "post_date": "YYYY/MM/DD形式の投稿日",
  "caption_preview": "投稿内容の冒頭30文字程度"
}

JSON以外のテキストは出力しないでください。"""
        
        result = self.read_screenshot(image_path, prompt)
        if result:
            try:
                # JSON部分を抽出
                json_str = result.strip()
                if json_str.startswith('```'):
                    json_str = json_str.split('\n', 1)[1].rsplit('```', 1)[0]
                return json.loads(json_str)
            except json.JSONDecodeError:
                print(f"⚠️ JSON解析失敗: {result[:200]}")
        return None
    
    def extract_account_insights(self, image_path):
        """アカウント全体のインサイトスクショから数値を抽出"""
        prompt = """この画像はInstagramのアカウント全体のインサイト画面です。
以下の情報をJSON形式で抽出してください。見つからない項目はnullにしてください。

{
  "impressions": 閲覧数/インプレッション数,
  "reach": リーチしたアカウント数,
  "follower_inside_pct": フォロワーからの閲覧%（数値のみ）,
  "follower_outside_pct": フォロワー外からの閲覧%（数値のみ）,
  "profile_visits": プロフィールアクセス/アクティビティ数,
  "external_link_taps": 外部リンクタップ数,
  "follower_count": フォロワー数,
  "period": "集計期間（例: 2/24〜3/25）"
}

JSON以外のテキストは出力しないでください。"""
        
        return self.read_screenshot(image_path, prompt)
    
    def extract_audience_data(self, image_path):
        """オーディエンスデータのスクショから情報を抽出"""
        prompt = """この画像はInstagramのオーディエンス分析画面です。
以下の情報をJSON形式で抽出してください。見つからない項目はnullにしてください。

{
  "age_top": "最も多い年齢層（例: 25-34: 33%）",
  "gender_ratio": "性別比（例: 63:37）",
  "top_city": "最も多い地域（例: 富士市 9.7%）",
  "top_country": "最も多い国（例: 日本 98.5%）"
}

JSON以外のテキストは出力しないでください。"""
        
        return self.read_screenshot(image_path, prompt)


# ═══════════════════════════════════════════
# Google Sheets書き込み
# ═══════════════════════════════════════════
class SheetsWriter:
    def __init__(self, spreadsheet_id):
        self.spreadsheet_id = spreadsheet_id
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            try:
                import gspread
                from google.oauth2.service_account import Credentials
                
                scopes = [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive'
                ]
                creds = Credentials.from_service_account_file(
                    'service_account.json', scopes=scopes
                )
                self._client = gspread.authorize(creds)
            except ImportError:
                print("❌ gspread がインストールされていません。")
                print("   pip install gspread google-auth")
                sys.exit(1)
            except FileNotFoundError:
                print("❌ service_account.json が見つかりません。")
                print("   Google Cloud Console でサービスアカウントキーを作成してください。")
                sys.exit(1)
        return self._client
    
    def write_post_data(self, post_data_list):
        """投稿データをスプシに書き込み"""
        ss = self.client.open_by_key(self.spreadsheet_id)
        ws = ss.worksheet('① 投稿管理')
        
        # 最終行を取得
        existing = ws.get_all_values()
        next_row = len(existing) + 1
        
        for data in post_data_list:
            row = [
                data.get('post_date', ''),
                data.get('post_type', ''),
                data.get('caption_preview', ''),
                '',  # URL（手動入力）
                data.get('reach', ''),
                data.get('plays', ''),
                data.get('likes', ''),
                data.get('saves', ''),
                data.get('comments', ''),
                '',  # フォロワー増減（手動入力）
            ]
            ws.update(f'A{next_row}:J{next_row}', [row])
            next_row += 1
            print(f"  ✅ 書き込み: {data.get('post_date', '')} - {data.get('caption_preview', '')[:20]}")
        
        print(f"\n✅ {len(post_data_list)}件の投稿データを書き込みました。")
    
    def write_monthly_insight(self, month_label, insight_data):
        """月次インサイトをスプシに書き込み"""
        ss = self.client.open_by_key(self.spreadsheet_id)
        ws = ss.worksheet('② 月次インサイト')
        
        existing = ws.get_all_values()
        next_row = len(existing) + 1
        
        row = [
            month_label,
            insight_data.get('period_start', ''),
            insight_data.get('period_end', ''),
            insight_data.get('impressions', ''),
            insight_data.get('reach', ''),
            insight_data.get('follower_inside_pct', ''),
            insight_data.get('follower_outside_pct', ''),
            insight_data.get('profile_visits', ''),
            insight_data.get('external_link_taps', ''),
            insight_data.get('follower_count', ''),
            insight_data.get('age_top', ''),
            insight_data.get('gender_ratio', ''),
        ]
        ws.update(f'A{next_row}:L{next_row}', [row])
        print(f"✅ 月次インサイト（{month_label}）を書き込みました。")


# ═══════════════════════════════════════════
# メイン処理
# ═══════════════════════════════════════════
def main():
    config = load_config()
    
    print("=" * 50)
    print("Instagram 自動データ取得")
    print(f"クライアント: {config['client_name']}")
    print("=" * 50)
    
    # スクショ保存先
    ss_dir = Path(config['screenshot_dir'])
    ss_dir.mkdir(exist_ok=True)
    
    # ADB初期化
    adb = ADBController(config['adb_path'])
    if not adb.check_device():
        return
    
    screen_w, screen_h = adb.get_screen_size()
    print(f"📱 画面サイズ: {screen_w}x{screen_h}")
    
    # Gemini初期化
    gemini = GeminiVision(config['gemini_api_key'], config['gemini_model'])
    
    # ── Step 1: Instagramを開く ──
    print("\n📲 Instagramを起動中...")
    adb.open_instagram()
    time.sleep(config['wait_seconds'])
    
    # ── Step 2: インサイト画面に遷移 ──
    print("\n📊 インサイト画面に遷移してください。")
    print("   準備ができたらEnterキーを押してください。")
    input("   >> ")
    
    # ── Step 3: アカウント全体のインサイトをスクショ ──
    print("\n📸 アカウント全体のインサイトをスクショ中...")
    account_ss = str(ss_dir / f"account_insight_{datetime.now():%Y%m%d_%H%M%S}.png")
    if adb.screenshot(account_ss):
        print(f"   保存: {account_ss}")
        print("   🤖 AI読み取り中...")
        account_data = gemini.extract_account_insights(account_ss)
        if account_data:
            print(f"   ✅ 読み取り成功")
            try:
                account_json = json.loads(account_data) if isinstance(account_data, str) else account_data
                for k, v in account_json.items():
                    print(f"      {k}: {v}")
            except:
                print(f"   ⚠️ JSON解析注意: {str(account_data)[:200]}")
    
    # ── Step 4: オーディエンスデータ ──
    print("\n📸 オーディエンス画面を表示してください。")
    input("   準備ができたらEnterキー >> ")
    
    audience_ss = str(ss_dir / f"audience_{datetime.now():%Y%m%d_%H%M%S}.png")
    if adb.screenshot(audience_ss):
        print(f"   保存: {audience_ss}")
        print("   🤖 AI読み取り中...")
        audience_data = gemini.extract_audience_data(audience_ss)
        if audience_data:
            print(f"   ✅ 読み取り成功")
    
    # ── Step 5: 各投稿のインサイト ──
    print("\n📸 投稿一覧画面を表示してください。")
    print("   各投稿のインサイトを1件ずつスクショしていきます。")
    
    post_data_list = []
    while True:
        print(f"\n--- 投稿 {len(post_data_list)+1} ---")
        print("   投稿のインサイト画面を表示してEnterキー（終了は 'q'）")
        user_input = input("   >> ").strip()
        
        if user_input.lower() == 'q':
            break
        
        post_ss = str(ss_dir / f"post_{len(post_data_list)+1}_{datetime.now():%Y%m%d_%H%M%S}.png")
        if adb.screenshot(post_ss):
            print(f"   保存: {post_ss}")
            print("   🤖 AI読み取り中...")
            post_data = gemini.extract_post_insights(post_ss)
            if post_data:
                post_data_list.append(post_data)
                print(f"   ✅ {post_data.get('post_type', '?')}: リーチ {post_data.get('reach', '?')}")
    
    # ── Step 6: スプシに書き込み ──
    if post_data_list or account_data:
        print("\n📝 スプシに書き込みますか？ (y/n)")
        if input("   >> ").strip().lower() == 'y':
            writer = SheetsWriter(config['spreadsheet_id'])
            
            if post_data_list:
                writer.write_post_data(post_data_list)
            
            if account_data:
                month_label = input("   対象月を入力（例: 2026年3月）>> ").strip()
                if month_label:
                    insight = json.loads(account_data) if isinstance(account_data, str) else account_data
                    if audience_data:
                        aud = json.loads(audience_data) if isinstance(audience_data, str) else audience_data
                        insight.update(aud)
                    writer.write_monthly_insight(month_label, insight)
    
    print("\n" + "=" * 50)
    print("✅ 完了！")
    print(f"   投稿数: {len(post_data_list)}件")
    print(f"   スクショ: {ss_dir}")
    print("=" * 50)


if __name__ == '__main__':
    main()
