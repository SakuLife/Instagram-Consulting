"""
議事録自動パイプライン
録音ファイル → faster-whisper（ローカル文字起こし）→ Gemini（議事録整理）→ Google Drive保存

セットアップ:
  pip install faster-whisper gspread google-auth google-api-python-client

使い方:
  1. Google Driveの議事録フォルダ内「録音」に録音ファイル(m4a/mp3/wav)を入れる
  2. python meeting_minutes.py を実行
  3. 議事録がDriveの「出力」フォルダにGoogle Docsとして保存される
"""

import json
import sys
import os
import time
import urllib.request
from pathlib import Path
from datetime import datetime

CONFIG_FILE = Path(__file__).parent / 'config_minutes.json'
DEFAULT_CONFIG = {
    "gemini_api_key": "YOUR_GEMINI_API_KEY",
    "gemini_model": "gemini-2.5-flash",
    "whisper_model": "large-v3",
    "whisper_device": "auto",
    "whisper_compute_type": "auto",
    "parent_folder_id": "YOUR_DRIVE_FOLDER_ID",
    "subfolder_recording": "録音",
    "subfolder_done": "処理済み",
    "subfolder_transcript": "文字起こし",
    "subfolder_output": "出力",
    "service_account_file": "service_account.json"
}

def load_config():
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        print(f'設定ファイルを作成しました: {CONFIG_FILE}')
        print('config_minutes.json を編集してAPIキーとフォルダIDを設定してください。')
        sys.exit(1)
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


class WhisperTranscriber:
    def __init__(self, model_name='large-v3', device='auto', compute_type='auto'):
        self.model_name = model_name
        self.model = None
        self.device = device
        self.compute_type = compute_type

    def _load_model(self):
        if self.model is not None:
            return
        print(f'  📦 Whisperモデル読み込み中（{self.model_name}）...')
        print(f'     初回はモデルダウンロードに時間がかかります（約3GB）')
        try:
            from faster_whisper import WhisperModel
            device = self.device
            compute_type = self.compute_type
            if device == 'auto':
                try:
                    import torch
                    if torch.cuda.is_available():
                        device = 'cuda'
                        compute_type = 'float16' if compute_type == 'auto' else compute_type
                        print('     🖥️ GPU検出: CUDAで実行')
                    else:
                        device = 'cpu'
                        compute_type = 'int8' if compute_type == 'auto' else compute_type
                        print('     💻 CPUで実行（GPUなし）')
                except ImportError:
                    device = 'cpu'
                    compute_type = 'int8' if compute_type == 'auto' else compute_type
                    print('     💻 CPUで実行')
            self.model = WhisperModel(self.model_name, device=device, compute_type=compute_type)
            print(f'  ✅ モデル読み込み完了')
        except ImportError:
            print('❌ faster-whisper がインストールされていません')
            print('   pip install faster-whisper')
            sys.exit(1)

    def transcribe(self, audio_path):
        self._load_model()
        filename = Path(audio_path).name
        file_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        print(f'  🎤 文字起こし中: {filename} ({file_size_mb:.1f}MB)')
        print(f'     ※ CPUの場合、1時間の録音で5〜10分かかります')
        start_time = time.time()
        segments, info = self.model.transcribe(
            audio_path, language='ja', beam_size=5, vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200)
        )
        texts = []
        for segment in segments:
            texts.append(segment.text.strip())
        full_text = '\n'.join(texts)
        elapsed = time.time() - start_time
        print(f'  ✅ 文字起こし完了（{elapsed:.1f}秒、{len(full_text)}文字）')
        print(f'     検出言語: {info.language}（確度: {info.language_probability:.1%}）')
        return full_text


class MinutesFormatter:
    def __init__(self, api_key, model='gemini-2.5-flash'):
        self.api_key = api_key
        self.model = model
        self.endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'

    def format_minutes(self, transcript, client_name='', meeting_date=''):
        print(f'  📝 議事録整理中（Gemini {self.model}）...')
        if not meeting_date:
            meeting_date = datetime.now().strftime('%Y年%m月%d日')
        prompt = f"""以下の打ち合わせの文字起こしテキストを、議事録フォーマットに整理してください。

## 基本情報
- クライアント名: {client_name or '（不明）'}
- 打ち合わせ日: {meeting_date}

## 文字起こしテキスト
{transcript[:12000]}

## 出力フォーマット（必ずこの形式で出力）
【日時】{meeting_date}

【出席者】
（文字起こしから推測できる出席者。不明なら「確認中」）

【議題】
① （議題1）
② （議題2）
③ ...

【決定事項】
・（決定事項1）
・（決定事項2）

【TODO】
《クライアント側》
・（TODO1）
《speaK側》
・（TODO1）

【次回予定】
（次回の予定。なければ「未定」）

【議事内容の要約】
（3〜5行で要約）

【詳細メモ】
（話題ごとに時系列で整理。重要な発言はそのまま残す）

重要:
- 文字起こしの内容を正確に反映し、推測で情報を追加しないでください
- マークダウン記法（**太字**等）は使わないでください
- 箇条書きは「・」のみ使用"""

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 8192}
        }
        url = f"{self.endpoint}?key={self.api_key}"
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get('candidates'):
                    text = result['candidates'][0]['content']['parts'][0]['text']
                    print(f'  ✅ 議事録整理完了（{len(text)}文字）')
                    return text
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8')
            print(f'  ❌ Gemini APIエラー（{e.code}）: {body[:300]}')
        except Exception as e:
            print(f'  ❌ 議事録整理エラー: {e}')
        return None


class DriveManager:
    def __init__(self, service_account_file='service_account.json'):
        self._service = None
        self._sa_file = service_account_file

    @property
    def service(self):
        if self._service is None:
            try:
                from google.oauth2.service_account import Credentials
                from googleapiclient.discovery import build
                scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
                creds = Credentials.from_service_account_file(self._sa_file, scopes=scopes)
                self._service = build('drive', 'v3', credentials=creds)
            except ImportError:
                print('❌ google-api-python-client が必要です')
                print('   pip install google-api-python-client google-auth')
                sys.exit(1)
            except FileNotFoundError:
                print(f'❌ {self._sa_file} が見つかりません')
                sys.exit(1)
        return self._service

    def find_subfolder(self, parent_id, name):
        results = self.service.files().list(
            q=f"'{parent_id}' in parents and name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            spaces='drive', fields='files(id, name)'
        ).execute()
        files = results.get('files', [])
        return files[0]['id'] if files else None

    def create_folder(self, name, parent_id=None):
        metadata = {'name': name, 'mimeType': 'application/vnd.google-apps.folder'}
        if parent_id:
            metadata['parents'] = [parent_id]
        return self.service.files().create(body=metadata, fields='id').execute()['id']

    def list_audio_files(self, folder_id):
        results = self.service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            spaces='drive', fields='files(id, name, mimeType, createdTime)'
        ).execute()
        audio_exts = {'.m4a', '.mp3', '.wav', '.ogg', '.flac', '.webm', '.mp4'}
        return [f for f in results.get('files', []) if Path(f['name']).suffix.lower() in audio_exts]

    def download_file(self, file_id, local_path):
        from googleapiclient.http import MediaIoBaseDownload
        request = self.service.files().get_media(fileId=file_id)
        with open(local_path, 'wb') as f:
            downloader = MediaIoBaseDownload(f, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                if status:
                    print(f'     ダウンロード: {int(status.progress() * 100)}%', end='\r')
        print()

    def upload_as_doc(self, name, content, folder_id):
        """テキストファイルをDriveにアップロード（ストレージ節約のためtxt形式）"""
        from googleapiclient.http import MediaInMemoryUpload
        metadata = {
            'name': name + '.txt',
            'parents': [folder_id]
        }
        media = MediaInMemoryUpload(content.encode('utf-8'), mimetype='text/plain')
        file = self.service.files().create(
            body=metadata, media_body=media, fields='id,webViewLink'
        ).execute()

        # フォルダオーナーに編集権限を付与
        try:
            folder = self.service.files().get(fileId=folder_id, fields='owners').execute()
            owner_email = folder.get('owners', [{}])[0].get('emailAddress', '')
            if owner_email:
                self.service.permissions().create(
                    fileId=file['id'],
                    body={'type': 'user', 'role': 'writer', 'emailAddress': owner_email},
                    sendNotificationEmail=False
                ).execute()
        except Exception as e:
            print(f'  (権限付与スキップ: {e})')

        return file

    def move_file(self, file_id, new_folder_id):
        file = self.service.files().get(fileId=file_id, fields='parents').execute()
        old_parents = ','.join(file.get('parents', []))
        self.service.files().update(fileId=file_id, addParents=new_folder_id, removeParents=old_parents, fields='id').execute()


def main():
    config = load_config()
    print('=' * 55)
    print('  📝 議事録自動パイプライン')
    print('     faster-whisper (large-v3) + Gemini 2.5 Flash')
    print('=' * 55)

    transcriber = WhisperTranscriber(
        model_name=config.get('whisper_model', 'large-v3'),
        device=config.get('whisper_device', 'auto'),
        compute_type=config.get('whisper_compute_type', 'auto')
    )
    formatter = MinutesFormatter(config['gemini_api_key'], config.get('gemini_model', 'gemini-2.5-flash'))
    drive = DriveManager(config.get('service_account_file', 'service_account.json'))

    parent_id = config['parent_folder_id']
    rec_name = config.get('subfolder_recording', '録音')
    done_name = config.get('subfolder_done', '処理済み')
    txt_name = config.get('subfolder_transcript', '文字起こし')
    out_name = config.get('subfolder_output', '出力')

    rec_id = drive.find_subfolder(parent_id, rec_name)
    done_id = drive.find_subfolder(parent_id, done_name)
    txt_id = drive.find_subfolder(parent_id, txt_name)
    out_id = drive.find_subfolder(parent_id, out_name)

    if not rec_id:
        rec_id = drive.create_folder(rec_name, parent_id)
        print(f'  📁 「{rec_name}」フォルダを作成しました')
    if not done_id:
        done_id = drive.create_folder(done_name, parent_id)
        print(f'  📁 「{done_name}」フォルダを作成しました')
    if not txt_id:
        txt_id = drive.create_folder(txt_name, parent_id)
        print(f'  📁 「{txt_name}」フォルダを作成しました')
    if not out_id:
        out_id = drive.create_folder(out_name, parent_id)
        print(f'  📁 「{out_name}」フォルダを作成しました')

    audio_files = drive.list_audio_files(rec_id)
    if not audio_files:
        print(f'\n📁 「{rec_name}」に録音ファイルがありません。')
        print('   録音ファイル（m4a/mp3/wav等）をフォルダに入れてから再実行。')
        return

    print(f'\n📂 {len(audio_files)}件の録音ファイルを検出\n')
    tmp_dir = Path('./tmp_audio')
    tmp_dir.mkdir(exist_ok=True)
    results = []

    for i, audio_file in enumerate(audio_files):
        print('=' * 55)
        print(f' [{i + 1}/{len(audio_files)}] {audio_file["name"]}')
        print('=' * 55)
        client_name = input('  クライアント名（Enterでスキップ）>> ').strip()
        meeting_date = input('  日付（例: 2026年5月14日, Enterで今日）>> ').strip()
        if not meeting_date:
            meeting_date = datetime.now().strftime('%Y年%m月%d日')

        local_path = str(tmp_dir / audio_file['name'])
        print('  ⬇️ ダウンロード中...')
        drive.download_file(audio_file['id'], local_path)

        transcript = transcriber.transcribe(local_path)
        if not transcript:
            print('  ⚠️ 文字起こし失敗。スキップ。')
            continue

        doc_prefix = meeting_date
        if client_name:
            doc_prefix = f'{meeting_date}_{client_name}'

        drive.upload_as_doc(f'{doc_prefix}_文字起こし', transcript, txt_id)
        print(f'  💾 文字起こし保存')

        minutes = formatter.format_minutes(transcript, client_name, meeting_date)
        if not minutes:
            print('  ⚠️ 議事録整理失敗。文字起こしのみ保存。')
            continue

        result = drive.upload_as_doc(f'{doc_prefix}_議事録', minutes, out_id)
        url = result.get('webViewLink', '')
        print(f'  ✅ 議事録保存: {doc_prefix}_議事録')
        print(f'     URL: {url}')
        results.append({'name': f'{doc_prefix}_議事録', 'url': url})

        drive.move_file(audio_file['id'], done_id)
        print('  📦 録音を処理済みに移動')

        try: os.remove(local_path)
        except: pass

    try: tmp_dir.rmdir()
    except: pass

    print('\n' + '=' * 55)
    print(f'  ✅ 全{len(audio_files)}件完了！')
    for r in results:
        print(f'     ・{r["name"]}')
    print('=' * 55)


if __name__ == '__main__':
    main()
