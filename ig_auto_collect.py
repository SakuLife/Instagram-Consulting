"""
Instagram インサイト自動取得
iPhone: pymobiledevice3 でスクショ取得
Android: ADB でスクショ + 画面操作
共通: Gemini Vision APIで数値読み取り → Google Sheetsに書き込み

セットアップ:
  pip install pymobiledevice3 gspread google-auth

使い方:
  1. スマホをUSBでPCに接続
  2. IGアプリでインサイト画面を開く
  3. python ig_auto_collect.py を実行
"""

import json
import sys
import os
import time
import subprocess
import base64
import urllib.request
from pathlib import Path
from datetime import datetime

CONFIG_FILE = Path(__file__).parent / 'config.json'
DEFAULT_CONFIG = {
    "gemini_api_key": "YOUR_GEMINI_API_KEY",
    "gemini_model": "gemini-2.5-flash",
    "spreadsheet_id": "YOUR_SPREADSHEET_ID",
    "service_account_file": "service_account.json",
    "screenshot_dir": "./screenshots",
    "capture_count": 4,
    "capture_interval": 3,
    "client_name": ""
}

def load_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        print(f'設定ファイルを作成: {CONFIG_FILE}')
        print('config.json を編集してAPIキーとスプシIDを設定してください。')
        sys.exit(1)
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


# ═══════════════════════════════════════════
# デバイス検出
# ═══════════════════════════════════════════
def detect_device():
    """接続されたデバイスを検出（iPhone優先）"""
    # iPhone検出
    try:
        from pymobiledevice3.usbmux import list_devices
        devices = list_devices()
        if devices:
            print(f'📱 iPhone検出: {len(devices)}台')
            return 'iphone'
    except ImportError:
        pass
    except Exception as e:
        print(f'  (iPhone検出エラー: {e})')

    # Android検出
    try:
        result = subprocess.run(['adb', 'devices'], capture_output=True, text=True, timeout=5)
        lines = result.stdout.strip().split('\n')[1:]
        androids = [l for l in lines if 'device' in l and 'unauthorized' not in l]
        if androids:
            print(f'🤖 Android検出: {len(androids)}台')
            return 'android'
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f'  (Android検出エラー: {e})')

    return None


# ═══════════════════════════════════════════
# iPhone スクリーンショット
# ═══════════════════════════════════════════
class IPhoneCapture:
    def __init__(self):
        self.lockdown = None

    def connect(self):
        try:
            from pymobiledevice3.lockdown import create_using_usbmux
            self.lockdown = create_using_usbmux()
            name = self.lockdown.display_name
            print(f'  ✅ iPhone接続: {name}')
            return True
        except Exception as e:
            print(f'  ❌ iPhone接続失敗: {e}')
            print('  → iPhoneとPCをUSBで接続して「このコンピュータを信頼」をタップしてください')
            return False

    def screenshot(self, save_path):
        try:
            from pymobiledevice3.services.screenshot import ScreenshotService
            screenshot_data = ScreenshotService(lockdown=self.lockdown).take_screenshot()
            with open(save_path, 'wb') as f:
                f.write(screenshot_data)
            print(f'  📸 スクショ保存: {Path(save_path).name}')
            return True
        except Exception as e:
            print(f'  ❌ スクショ失敗: {e}')
            return False


# ═══════════════════════════════════════════
# Android スクリーンショット + 操作
# ═══════════════════════════════════════════
class AndroidCapture:
    def connect(self):
        try:
            result = subprocess.run(['adb', 'devices'], capture_output=True, text=True, timeout=5)
            lines = result.stdout.strip().split('\n')[1:]
            devices = [l for l in lines if 'device' in l and 'unauthorized' not in l]
            if devices:
                print(f'  ✅ Android接続: {devices[0].split()[0]}')
                return True
            else:
                print('  ❌ Android未検出')
                print('  → USBデバッグを有効にしてPCと接続してください')
                return False
        except FileNotFoundError:
            print('  ❌ ADBがインストールされていません')
            print('  → https://developer.android.com/tools/releases/platform-tools')
            return False

    def screenshot(self, save_path):
        try:
            subprocess.run(['adb', 'shell', 'screencap', '-p', '/sdcard/screenshot.png'],
                         capture_output=True, timeout=10)
            subprocess.run(['adb', 'pull', '/sdcard/screenshot.png', save_path],
                         capture_output=True, timeout=10)
            subprocess.run(['adb', 'shell', 'rm', '/sdcard/screenshot.png'],
                         capture_output=True, timeout=5)
            print(f'  📸 スクショ保存: {Path(save_path).name}')
            return True
        except Exception as e:
            print(f'  ❌ スクショ失敗: {e}')
            return False

    def swipe_up(self):
        """画面を上にスワイプ（スクロール）"""
        try:
            subprocess.run(['adb', 'shell', 'input', 'swipe', '540', '1500', '540', '500', '300'],
                         capture_output=True, timeout=5)
            time.sleep(1)
        except Exception:
            pass

    def tap(self, x, y):
        """指定座標をタップ"""
        try:
            subprocess.run(['adb', 'shell', 'input', 'tap', str(x), str(y)],
                         capture_output=True, timeout=5)
            time.sleep(0.5)
        except Exception:
            pass


# ═══════════════════════════════════════════
# Gemini Vision で画像からデータ読み取り
# ═══════════════════════════════════════════
class GeminiVisionReader:
    def __init__(self, api_key, model='gemini-2.5-flash'):
        self.api_key = api_key
        self.model = model
        self.endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'

    def read_insight(self, image_paths, insight_type='post'):
        """複数のスクショからインサイトデータを読み取り"""
        print(f'  🔍 Gemini Visionで読み取り中（{len(image_paths)}枚）...')

        # 画像をBase64エンコード
        parts = []
        for path in image_paths:
            with open(path, 'rb') as f:
                img_data = base64.b64encode(f.read()).decode('utf-8')
            parts.append({
                "inlineData": {
                    "mimeType": "image/png",
                    "data": img_data
                }
            })

        if insight_type == 'post':
            prompt = self._post_prompt()
        elif insight_type == 'account':
            prompt = self._account_prompt()
        else:
            prompt = self._post_prompt()

        parts.append({"text": prompt})

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096}
        }

        url = f"{self.endpoint}?key={self.api_key}"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get('candidates'):
                    text = result['candidates'][0]['content']['parts'][0]['text']
                    return self._parse_json_response(text)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8')
            print(f'  ❌ Gemini APIエラー（{e.code}）: {body[:300]}')
        except Exception as e:
            print(f'  ❌ 読み取りエラー: {e}')

        return None

    def _post_prompt(self):
        return """この画像はInstagramの投稿インサイト画面です。
以下の情報をJSON配列で抽出してください。各投稿ごとに1つのオブジェクトです。

出力形式（JSONのみ、他のテキスト不要）:
[
  {
    "date": "投稿日（YYYY/MM/DD形式）",
    "type": "リール or フィード or ストーリーズ",
    "content": "投稿内容の説明（キャプション冒頭など）",
    "reach": リーチ数（数値）,
    "plays": 再生数（数値、なければ0）,
    "likes": いいね数（数値）,
    "saves": 保存数（数値）,
    "comments": コメント数（数値）
  }
]

読み取れない値は0にしてください。JSONのみ出力、説明文不要。"""

    def _account_prompt(self):
        return """この画像はInstagramのアカウントインサイト画面です。
以下の情報をJSONで抽出してください。

出力形式（JSONのみ）:
{
  "month": "対象月（YYYY年M月形式）",
  "impressions": インプレッション数（数値）,
  "reach": リーチしたアカウント数（数値）,
  "follower_reach_pct": フォロワーからの閲覧割合（数値、%なし）,
  "non_follower_reach_pct": フォロワー外からの閲覧割合（数値、%なし）,
  "profile_visits": プロフィールアクセス数（数値）,
  "link_clicks": 外部リンクタップ数（数値）,
  "followers": フォロワー数（数値）
}

読み取れない値は0にしてください。JSONのみ出力。"""

    def _parse_json_response(self, text):
        """GeminiレスポンスからJSONを抽出"""
        text = text.strip()
        # コードブロック除去
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text[3:]
        if text.endswith('```'):
            text = text[:-3]
        text = text.strip()
        if text.startswith('json'):
            text = text[4:].strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            print(f'  ⚠️ JSONパースエラー: {e}')
            print(f'  レスポンス: {text[:200]}')
            return None


# ═══════════════════════════════════════════
# スプレッドシート書き込み
# ═══════════════════════════════════════════
class SheetWriter:
    def __init__(self, spreadsheet_id, service_account_file='service_account.json'):
        self.spreadsheet_id = spreadsheet_id
        self._client = None
        self._sa_file = service_account_file

    @property
    def client(self):
        if self._client is None:
            try:
                import gspread
                from google.oauth2.service_account import Credentials
                scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
                creds = Credentials.from_service_account_file(self._sa_file, scopes=scopes)
                self._client = gspread.authorize(creds)
            except ImportError:
                print('❌ gspread がインストールされていません')
                print('   pip install gspread google-auth')
                sys.exit(1)
        return self._client

    def write_posts(self, posts):
        """投稿データを①投稿管理に書き込み"""
        ss = self.client.open_by_key(self.spreadsheet_id)
        sheet = ss.worksheet('① 投稿管理')

        # 既存データの最終行を取得
        existing = sheet.get_all_values()
        next_row = len(existing) + 1

        # 「▼ 以下に新しい投稿データを入力」行を探す
        for i, row in enumerate(existing):
            if '▼' in str(row[0]):
                next_row = i + 2  # その行の下に挿入
                break

        written = 0
        for p in posts:
            # 重複チェック（同じ日付+内容があればスキップ）
            is_dup = False
            for row in existing:
                if str(row[0]).replace('/', '-') == str(p.get('date', '')).replace('/', '-') and str(row[2]) == str(p.get('content', '')):
                    is_dup = True
                    break
            if is_dup:
                print(f'  ⏭️ 重複スキップ: {p.get("date")} {p.get("content", "")[:20]}')
                continue

            row_data = [
                p.get('date', ''),
                p.get('type', ''),
                p.get('content', ''),
                '',  # URL（スクショからは取得不可）
                p.get('reach', 0),
                p.get('plays', 0),
                p.get('likes', 0),
                p.get('saves', 0),
                p.get('comments', 0),
                0  # フォロワー増（個別投稿では不明）
            ]
            sheet.update(f'A{next_row}:J{next_row}', [row_data])
            next_row += 1
            written += 1

        print(f'  ✅ {written}件の投稿を書き込みました')
        return written

    def write_account_insight(self, data):
        """アカウントインサイトを②月次インサイトに書き込み"""
        ss = self.client.open_by_key(self.spreadsheet_id)
        sheet = ss.worksheet('② 月次インサイト')

        month = data.get('month', '')
        existing = sheet.get_all_values()

        # 同じ月があれば上書き、なければ追加
        target_row = len(existing) + 1
        for i, row in enumerate(existing):
            if str(row[0]).strip() == month:
                target_row = i + 1
                break

        row_data = [
            month,
            '',  # クライアント名（後で設定）
            '',  # 期間
            data.get('impressions', 0),
            data.get('reach', 0),
            data.get('follower_reach_pct', 0),
            data.get('non_follower_reach_pct', 0),
            data.get('profile_visits', 0),
            data.get('link_clicks', 0),
            data.get('followers', 0)
        ]
        sheet.update(f'A{target_row}:J{target_row}', [row_data])
        print(f'  ✅ アカウントインサイト書き込み: {month}')


# ═══════════════════════════════════════════
# メイン処理
# ═══════════════════════════════════════════
def main():
    config = load_config()

    print('=' * 55)
    print('  📸 Instagram インサイト自動取得')
    print('     スクショ → Gemini Vision → スプシ書き込み')
    print('=' * 55)

    # スクショ保存先
    ss_dir = Path(config.get('screenshot_dir', './screenshots'))
    ss_dir.mkdir(exist_ok=True)

    # デバイス検出
    device_type = detect_device()
    if not device_type:
        print('\n❌ デバイスが見つかりません。')
        print('   スマホをUSBでPCに接続してください。')
        print('   iPhone: 「このコンピュータを信頼」をタップ')
        print('   Android: USBデバッグを有効に')
        sys.exit(1)

    # デバイス接続
    if device_type == 'iphone':
        capture = IPhoneCapture()
    else:
        capture = AndroidCapture()

    if not capture.connect():
        sys.exit(1)

    # キャプチャモード選択
    print('\n取得モードを選択:')
    print('  1. 投稿インサイト（投稿ごとのリーチ・いいね等）')
    print('  2. アカウントインサイト（月次の全体数値）')
    print('  3. 両方')
    mode = input('>> ').strip()
    if mode not in ['1', '2', '3']:
        mode = '3'

    capture_count = config.get('capture_count', 4)
    interval = config.get('capture_interval', 3)

    reader = GeminiVisionReader(config['gemini_api_key'], config.get('gemini_model', 'gemini-2.5-flash'))
    writer = SheetWriter(config['spreadsheet_id'], config.get('service_account_file', 'service_account.json'))

    # 投稿インサイト
    if mode in ['1', '3']:
        print(f'\n── 投稿インサイト取得 ──')
        print(f'IGアプリで投稿一覧のインサイト画面を開いてください。')
        input('準備できたらEnter >> ')

        post_screenshots = []
        for i in range(capture_count):
            path = str(ss_dir / f'post_{i+1}.png')
            if capture.screenshot(path):
                post_screenshots.append(path)

            if i < capture_count - 1:
                if device_type == 'android':
                    print(f'  📜 スクロール中...')
                    capture.swipe_up()
                else:
                    print(f'  👆 画面をスクロールしてください（{interval}秒待機）')
                    time.sleep(interval)

        if post_screenshots:
            posts = reader.read_insight(post_screenshots, 'post')
            if posts and isinstance(posts, list):
                print(f'  📊 {len(posts)}件の投稿を検出')
                writer.write_posts(posts)
            else:
                print('  ⚠️ 投稿データの読み取りに失敗しました')

    # アカウントインサイト
    if mode in ['2', '3']:
        print(f'\n── アカウントインサイト取得 ──')
        print(f'IGアプリでアカウントの概要インサイト画面を開いてください。')
        input('準備できたらEnter >> ')

        acct_screenshots = []
        for i in range(2):  # アカウント概要は2枚くらいでOK
            path = str(ss_dir / f'account_{i+1}.png')
            if capture.screenshot(path):
                acct_screenshots.append(path)

            if i == 0:
                if device_type == 'android':
                    capture.swipe_up()
                else:
                    print(f'  👆 画面をスクロールしてください（{interval}秒待機）')
                    time.sleep(interval)

        if acct_screenshots:
            acct_data = reader.read_insight(acct_screenshots, 'account')
            if acct_data and isinstance(acct_data, dict):
                writer.write_account_insight(acct_data)
            else:
                print('  ⚠️ アカウントデータの読み取りに失敗しました')

    print(f'\n{"=" * 55}')
    print(f'  ✅ 完了！')
    print(f'  スクショ: {ss_dir}')
    print(f'{"=" * 55}')


if __name__ == '__main__':
    main()
