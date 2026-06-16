"""
Instagram インサイト自動スクショ取得（Android WiFi版）
ADB WiFi経由でスクショ取得 → Google Driveに自動アップロード

セットアップ:
  1. Android端末の「開発者オプション」→「USBデバッグ」をON
  2. 初回だけUSB接続して以下を実行:
     adb tcpip 5555
     adb connect <AndroidのIPアドレス>:5555
  3. 以降はUSB不要。WiFiで自動接続

使い方:
  python ig_screenshot_android.py --mode post     # 投稿インサイト
  python ig_screenshot_android.py --mode account  # アカウントインサイト
  python ig_screenshot_android.py --mode both     # 両方
"""

import subprocess
import time
import sys
import os
import json
import argparse
from pathlib import Path
from datetime import datetime


# ═══════════════════════════════════════════
# 設定
# ═══════════════════════════════════════════
CONFIG_FILE = Path(__file__).parent / 'config_android.json'
DEFAULT_CONFIG = {
    "device_ip": "",
    "device_port": 5555,
    "adb_path": "adb",
    "service_account_file": "service_account.json",
    "drive_post_folder_id": "1S_hiDUja_Aq0FfacpAsmY82G95dXMa2t",
    "drive_account_folder_id": "1kJ-Go0bwrF_CvHXMV1YTXFMrvQ1J5Dsj",
    "screenshot_count_post": 3,
    "screenshot_count_account": 4,
    "scroll_pause": 2.0,
    "scroll_distance": 800
}


def load_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        print(f'設定ファイルを作成: {CONFIG_FILE}')
        print('config_android.json の device_ip にAndroidのIPアドレスを設定してください。')
        print('\nAndroidのIPアドレスの確認方法:')
        print('  設定 → Wi-Fi → 接続中のネットワーク → IPアドレス')
        sys.exit(1)
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


# ═══════════════════════════════════════════
# ADB操作クラス
# ═══════════════════════════════════════════
class ADBController:
    def __init__(self, adb_path='adb', device_ip='', port=5555):
        self.adb = adb_path
        self.device_ip = device_ip
        self.port = port
        self.device_serial = None

    def run(self, args, timeout=10):
        """ADBコマンド実行（共通）"""
        cmd = [self.adb]
        if self.device_serial:
            cmd += ['-s', self.device_serial]
        cmd += args
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
        except subprocess.TimeoutExpired:
            return False, '', 'タイムアウト'
        except FileNotFoundError:
            print('❌ ADBが見つかりません。')
            print('   https://developer.android.com/tools/releases/platform-tools')
            print('   からPlatform Toolsをダウンロードし、PATHに追加してください。')
            sys.exit(1)

    def connect_wifi(self):
        """WiFi経由でADB接続"""
        if not self.device_ip:
            # まずUSB接続のデバイスを確認
            ok, out, _ = self.run(['devices'])
            if ok:
                lines = out.strip().split('\n')[1:]
                usb_devices = [l.split('\t')[0] for l in lines
                              if 'device' in l and 'unauthorized' not in l and ':' not in l.split('\t')[0]]
                if usb_devices:
                    self.device_serial = usb_devices[0]
                    print(f'  ✅ USB接続検出: {self.device_serial}')
                    return True

                # WiFi接続済みデバイス確認
                wifi_devices = [l.split('\t')[0] for l in lines
                               if 'device' in l and ':' in l.split('\t')[0]]
                if wifi_devices:
                    self.device_serial = wifi_devices[0]
                    print(f'  ✅ WiFi接続済み: {self.device_serial}')
                    return True

            print('❌ デバイスが見つかりません。')
            print('   USB接続するか、config_android.json に device_ip を設定してください。')
            return False

        target = f'{self.device_ip}:{self.port}'
        print(f'  📡 WiFi接続中: {target}')

        # 接続済みか確認
        ok, out, _ = self.run(['devices'])
        if ok and target in out and 'device' in out:
            self.device_serial = target
            print(f'  ✅ 接続済み')
            return True

        # 接続試行
        ok, out, err = self.run(['connect', target], timeout=15)
        if ok and ('connected' in out.lower() or 'already' in out.lower()):
            self.device_serial = target
            print(f'  ✅ WiFi接続成功')
            return True

        print(f'  ❌ WiFi接続失敗: {out} {err}')
        print(f'\n  トラブルシューティング:')
        print(f'  1. AndroidとPCが同じWiFiに接続されていることを確認')
        print(f'  2. 初回はUSBを接続して以下を実行:')
        print(f'     {self.adb} tcpip 5555')
        print(f'     {self.adb} connect {target}')
        print(f'  3. Android側で「USBデバッグを許可しますか？」が出たら「許可」をタップ')
        return False

    def is_screen_on(self):
        """画面がONか確認"""
        ok, out, _ = self.run(['shell', 'dumpsys', 'power'], timeout=5)
        if ok:
            return 'mWakefulness=Awake' in out or 'Display Power: state=ON' in out
        return True  # 確認できない場合はON扱い

    def wake_screen(self):
        """画面をONにする"""
        if not self.is_screen_on():
            self.run(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
            time.sleep(1)

    def unlock_screen(self):
        """ロック画面をスワイプで解除（PINなしの場合）"""
        self.run(['shell', 'input', 'swipe', '540', '2000', '540', '500', '300'])
        time.sleep(0.5)

    def screenshot(self, local_path):
        """スクリーンショットを取得"""
        remote_path = '/sdcard/ig_screenshot_tmp.png'
        # スクショ撮影
        ok1, _, err1 = self.run(['shell', 'screencap', '-p', remote_path], timeout=10)
        if not ok1:
            print(f'    ❌ スクショ撮影失敗: {err1}')
            return False
        # PCに転送
        ok2, _, err2 = self.run(['pull', remote_path, local_path], timeout=15)
        if not ok2:
            print(f'    ❌ 転送失敗: {err2}')
            return False
        # リモート削除
        self.run(['shell', 'rm', remote_path])
        # ファイルサイズ確認
        size = os.path.getsize(local_path)
        if size < 1000:
            print(f'    ❌ スクショが小さすぎます（{size}bytes）。画面がOFFの可能性。')
            return False
        return True

    def tap(self, x, y):
        """画面タップ"""
        self.run(['shell', 'input', 'tap', str(x), str(y)])
        time.sleep(0.5)

    def swipe_up(self, distance=800, duration=300):
        """上にスワイプ（スクロール）"""
        cx = 540  # 画面中央X（1080px幅想定）
        y_start = 1500
        y_end = y_start - distance
        self.run(['shell', 'input', 'swipe', str(cx), str(y_start), str(cx), str(y_end), str(duration)])

    def open_url(self, url):
        """URLを開く（IG deeplink用）"""
        self.run(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url])

    def press_back(self):
        """戻るボタン"""
        self.run(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
        time.sleep(0.5)

    def press_home(self):
        """ホームボタン"""
        self.run(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])

    def get_screen_size(self):
        """画面サイズ取得"""
        ok, out, _ = self.run(['shell', 'wm', 'size'])
        if ok and 'x' in out:
            # "Physical size: 1080x2400" → (1080, 2400)
            parts = out.split(':')[-1].strip().split('x')
            return int(parts[0]), int(parts[1])
        return 1080, 2400  # デフォルト

    def open_instagram_insights(self):
        """IGアプリのインサイト画面を開く"""
        print('  📱 Instagramを起動中...')
        # IGアプリを起動
        self.run(['shell', 'am', 'start', '-n',
                  'com.instagram.android/com.instagram.mainactivity.LauncherActivity'])
        time.sleep(3)

        # プロフィールタブ（右下）をタップ
        w, h = self.get_screen_size()
        print('  👆 プロフィールタブをタップ')
        self.tap(int(w * 0.9), int(h * 0.97))  # 右下のプロフィールアイコン
        time.sleep(2)

        # 「プロフェッショナルダッシュボード」or インサイトボタンをタップ
        # 位置はアカウントによって異なるため、汎用的な位置を使用
        print('  👆 インサイトボタンをタップ')
        # 「インサイト」テキストの一般的な位置
        self.tap(int(w * 0.5), int(h * 0.45))
        time.sleep(2)

        return True


# ═══════════════════════════════════════════
# Google Drive アップローダー
# ═══════════════════════════════════════════
class DriveUploader:
    def __init__(self, service_account_file='service_account.json'):
        self._service = None
        self._sa_file = service_account_file

    @property
    def service(self):
        if self._service is None:
            try:
                from google.oauth2.service_account import Credentials
                from googleapiclient.discovery import build
                creds = Credentials.from_service_account_file(
                    self._sa_file,
                    scopes=['https://www.googleapis.com/auth/drive']
                )
                self._service = build('drive', 'v3', credentials=creds)
            except ImportError:
                print('❌ google-api-python-client が必要です')
                print('   pip install google-api-python-client google-auth')
                sys.exit(1)
            except FileNotFoundError:
                print(f'❌ {self._sa_file} が見つかりません')
                sys.exit(1)
        return self._service

    def upload(self, local_path, folder_id, filename=None):
        """ファイルをDriveフォルダにアップロード"""
        from googleapiclient.http import MediaFileUpload
        if not filename:
            filename = os.path.basename(local_path)
        metadata = {'name': filename, 'parents': [folder_id]}
        media = MediaFileUpload(local_path, mimetype='image/png')
        file = self.service.files().create(
            body=metadata, media_body=media, fields='id'
        ).execute()
        return file['id']


# ═══════════════════════════════════════════
# メイン処理
# ═══════════════════════════════════════════
def capture_screenshots(adb, count, scroll_distance, scroll_pause, ss_dir, prefix):
    """スクショを連続撮影"""
    screenshots = []
    for i in range(count):
        filename = f'{prefix}_{i+1:02d}.png'
        filepath = str(ss_dir / filename)
        print(f'  📸 スクショ {i+1}/{count}: {filename}')
        if adb.screenshot(filepath):
            screenshots.append(filepath)
            print(f'    ✅ 保存完了（{os.path.getsize(filepath) // 1024}KB）')
        else:
            print(f'    ⚠️ スクショ失敗。リトライ...')
            time.sleep(1)
            if adb.screenshot(filepath):
                screenshots.append(filepath)
            else:
                print(f'    ❌ リトライも失敗。スキップ。')

        if i < count - 1:
            print(f'  📜 スクロール中...')
            adb.swipe_up(distance=scroll_distance)
            time.sleep(scroll_pause)

    return screenshots


def upload_to_drive(uploader, screenshots, folder_id):
    """スクショをDriveにアップロード"""
    uploaded = 0
    for path in screenshots:
        filename = os.path.basename(path)
        print(f'  ⬆️ アップロード: {filename}')
        try:
            uploader.upload(path, folder_id, filename)
            uploaded += 1
        except Exception as e:
            print(f'    ❌ アップロード失敗: {e}')
    return uploaded


def main():
    parser = argparse.ArgumentParser(description='IG インサイト自動スクショ（Android WiFi）')
    parser.add_argument('--mode', choices=['post', 'account', 'both'], default='both',
                       help='取得モード: post=投稿, account=アカウント, both=両方')
    parser.add_argument('--setup', action='store_true',
                       help='初回WiFiセットアップ（USB接続が必要）')
    args = parser.parse_args()

    config = load_config()

    print('=' * 55)
    print('  📸 IG インサイト自動スクショ（Android WiFi）')
    print('=' * 55)

    adb = ADBController(
        adb_path=config.get('adb_path', 'adb'),
        device_ip=config.get('device_ip', ''),
        port=config.get('device_port', 5555)
    )

    # 初回セットアップモード
    if args.setup:
        print('\n── 初回WiFiセットアップ ──')
        print('AndroidをUSBで接続してください。')
        input('接続したらEnter >> ')
        ok, out, _ = adb.run(['devices'])
        print(f'  デバイス一覧: {out}')
        ok, out, _ = adb.run(['tcpip', '5555'])
        print(f'  tcpip設定: {out}')
        if ok:
            print('\n  ✅ WiFiモード有効化完了！')
            print('  USBを外して、config_android.json に device_ip を設定してください。')
            print('  次回からはUSBなしで実行できます。')
        else:
            print('  ❌ 失敗。USBデバッグが有効か確認してください。')
        return

    # デバイス接続
    print('\n── デバイス接続 ──')
    if not adb.connect_wifi():
        sys.exit(1)

    # 画面ON確認
    adb.wake_screen()
    adb.unlock_screen()

    # スクショ保存先
    ss_dir = Path('./screenshots')
    ss_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # Drive アップローダー
    uploader = DriveUploader(config.get('service_account_file', 'service_account.json'))

    scroll_dist = config.get('scroll_distance', 800)
    scroll_pause = config.get('scroll_pause', 2.0)

    # 投稿インサイト
    if args.mode in ['post', 'both']:
        print('\n── 投稿インサイト取得 ──')
        print('IGアプリのインサイト → 投稿一覧画面を表示してください。')
        input('準備できたらEnter >> ')

        post_ss = capture_screenshots(
            adb,
            config.get('screenshot_count_post', 3),
            scroll_dist, scroll_pause,
            ss_dir, f'post_{timestamp}'
        )

        if post_ss:
            print(f'\n  ☁️ Driveにアップロード中（投稿フォルダ）...')
            n = upload_to_drive(uploader, post_ss, config['drive_post_folder_id'])
            print(f'  ✅ {n}枚アップロード完了')
        else:
            print('  ❌ スクショが1枚も取れませんでした')

    # アカウントインサイト
    if args.mode in ['account', 'both']:
        print('\n── アカウントインサイト取得 ──')
        print('IGアプリのインサイト → 概要画面を表示してください。')
        input('準備できたらEnter >> ')

        acct_ss = capture_screenshots(
            adb,
            config.get('screenshot_count_account', 4),
            scroll_dist, scroll_pause,
            ss_dir, f'account_{timestamp}'
        )

        if acct_ss:
            print(f'\n  ☁️ Driveにアップロード中（アカウントフォルダ）...')
            n = upload_to_drive(uploader, acct_ss, config['drive_account_folder_id'])
            print(f'  ✅ {n}枚アップロード完了')
        else:
            print('  ❌ スクショが1枚も取れませんでした')

    print(f'\n{"=" * 55}')
    print(f'  ✅ 完了！')
    print(f'  スプシで「📸 投稿/アカウントスクショ読み取り」を実行してください。')
    print(f'{"=" * 55}')


if __name__ == '__main__':
    main()
