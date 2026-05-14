"""
議事録処理（GitHub Actions用・CLI引数版）
GASから workflow_dispatch で呼ばれる
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from datetime import datetime

# meeting_minutes.py から共通クラスをインポート
from meeting_minutes import WhisperTranscriber, MinutesFormatter, DriveManager


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file-id', required=True)
    parser.add_argument('--file-name', required=True)
    parser.add_argument('--client-name', default='')
    parser.add_argument('--meeting-date', default='')
    args = parser.parse_args()

    if not args.meeting_date:
        args.meeting_date = datetime.now().strftime('%Y年%m月%d日')

    # 設定読み込み
    with open('config_minutes.json', 'r', encoding='utf-8') as f:
        config = json.load(f)

    print('=' * 55)
    print('  📝 議事録処理（GitHub Actions）')
    print(f'  ファイル: {args.file_name}')
    print(f'  クライアント: {args.client_name or "未指定"}')
    print(f'  日付: {args.meeting_date}')
    print('=' * 55)

    transcriber = WhisperTranscriber(
        model_name=config.get('whisper_model', 'large-v3'),
        device='cpu', compute_type='int8'
    )
    formatter = MinutesFormatter(config['gemini_api_key'], config.get('gemini_model', 'gemini-2.5-flash'))
    drive = DriveManager(config.get('service_account_file', 'service_account.json'))

    parent_id = config['parent_folder_id']
    done_id = drive.find_subfolder(parent_id, config.get('subfolder_done', '処理済み'))
    txt_id = drive.find_subfolder(parent_id, config.get('subfolder_transcript', '文字起こし'))
    out_id = drive.find_subfolder(parent_id, config.get('subfolder_output', '出力'))

    # なければ作成
    if not done_id: done_id = drive.create_folder(config.get('subfolder_done', '処理済み'), parent_id)
    if not txt_id: txt_id = drive.create_folder(config.get('subfolder_transcript', '文字起こし'), parent_id)
    if not out_id: out_id = drive.create_folder(config.get('subfolder_output', '出力'), parent_id)

    # ダウンロード
    tmp_dir = Path('./tmp_audio')
    tmp_dir.mkdir(exist_ok=True)
    local_path = str(tmp_dir / args.file_name)
    print('  ⬇️ ダウンロード中...')
    drive.download_file(args.file_id, local_path)

    # 文字起こし
    transcript = transcriber.transcribe(local_path)
    if not transcript:
        print('❌ 文字起こし失敗')
        sys.exit(1)

    # ファイル名プレフィックス
    doc_prefix = args.meeting_date
    if args.client_name:
        doc_prefix = f'{args.meeting_date}_{args.client_name}'

    # 文字起こし保存
    drive.upload_as_doc(f'{doc_prefix}_文字起こし', transcript, txt_id)
    print(f'  💾 文字起こし保存')

    # 議事録整理
    minutes = formatter.format_minutes(transcript, args.client_name, args.meeting_date)
    if not minutes:
        print('⚠️ 議事録整理失敗。文字起こしのみ保存。')
        sys.exit(0)

    # 議事録保存
    result = drive.upload_as_doc(f'{doc_prefix}_議事録', minutes, out_id)
    print(f'  ✅ 議事録保存: {doc_prefix}_議事録')
    print(f'     URL: {result.get("webViewLink", "")}')

    # 録音を処理済みに移動
    drive.move_file(args.file_id, done_id)
    print('  📦 録音を処理済みに移動')

    # クリーンアップ
    try: os.remove(local_path)
    except: pass
    try: tmp_dir.rmdir()
    except: pass

    print('\n✅ 完了！')


if __name__ == '__main__':
    main()
