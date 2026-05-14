# speaK Instagram運用管理 + 議事録パイプライン

## 構成

```
├── meeting_minutes.py          # 議事録パイプライン（faster-whisper + Gemini）
├── ig_auto_collect.py          # IG自動データ取得（ADB + Gemini Vision）
├── config_minutes.json.example # 議事録設定テンプレ
├── config.json.example         # IG設定テンプレ
├── requirements.txt
└── README.md
```

## セットアップ

```bash
git clone https://github.com/SakuLife/Instagram-Consulting.git
cd Instagram-Consulting
pip install -r requirements.txt
cp config_minutes.json.example config_minutes.json
# config_minutes.json にGemini APIキーとDriveフォルダIDを設定
# service_account.json をGoogle Cloud Consoleから取得して配置
```

## 議事録パイプライン

```bash
python meeting_minutes.py
```

Driveフォルダ構成（自動作成）:
```
議事録/
├── 録音/          ← ここに録音ファイルを入れる
├── 処理済み/      ← 処理後の録音が自動移動
├── 文字起こし/    ← Whisper生テキスト（バックアップ）
└── 出力/          ← 完成した議事録（Google Docs）
```

## IG自動データ取得

```bash
cp config.json.example config.json
# config.json にAPIキー・スプシID設定
python ig_auto_collect.py
```
