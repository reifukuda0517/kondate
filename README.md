# 献立共有アプリ (Kondate Sharing App)

夫婦で夕飯の献立を共有するPWAアプリです。

## 機能

- 週間カレンダーで献立を一覧表示
- 日ごとに献立を登録・編集（未確定も可能）
- 過去の献立履歴を閲覧
- 食材を独立または献立に紐付けて管理
- 毎夕18:00に妻へ今夜の献立をプッシュ通知
- リアルタイム同期（WebSocket）

## セットアップ

### 必要環境

- Python 3.9以上
- 対応ブラウザ（Chrome, Firefox, Safari, Edge）

### 起動方法（Windows）

```batch
start.bat
```

### 手動起動

```bash
# パッケージインストール
pip install -r backend/requirements.txt

# VAPIDキー生成
python setup_vapid.py

# サーバー起動
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### アクセス

- アプリ: http://localhost:8000
- API ドキュメント: http://localhost:8000/docs

## ディレクトリ構成

```
kondate/
├── backend/
│   ├── main.py          # FastAPI アプリケーション
│   ├── models.py        # SQLAlchemy モデル
│   ├── database.py      # DB初期化・セッション管理
│   ├── push_service.py  # プッシュ通知送信
│   ├── scheduler.py     # 18:00定期通知
│   └── requirements.txt
├── frontend/
│   ├── index.html       # メインHTML
│   ├── manifest.json    # PWAマニフェスト
│   ├── sw.js            # サービスワーカー
│   ├── css/
│   │   └── style.css    # スタイルシート
│   └── js/
│       ├── app.js       # アプリ本体・ユーザー管理・WebSocket
│       ├── api.js       # APIクライアント
│       ├── calendar.js  # カレンダービュー
│       ├── ingredients.js # 食材管理
│       └── push.js      # プッシュ通知設定
├── setup_vapid.py       # VAPIDキー生成スクリプト
├── start.bat            # Windows起動スクリプト
└── README.md
```

## 使い方

### 初回起動

1. `start.bat` を実行
2. ブラウザで http://localhost:8000 を開く
3. 夫・妻のどちらかを選択

### 献立の登録

1. カレンダー画面で登録したい日のセルをタップ
2. 料理名を入力し「保存」
3. 「確定済み」チェックで確定マークが付く
4. 未確定の場合はオレンジ色で表示

### 食材の管理

1. 下のナビから「食材」を選択
2. 「＋ 追加」から食材を登録
3. チェックマークで購入済みを記録
4. 献立に紐付けることも可能

### プッシュ通知

1. 下のナビから「通知設定」を選択
2. 「通知を有効にする」をタップ
3. ブラウザの通知許可を承認
4. 毎日18:00に今夜の献立が届く

## 技術スタック

- **バックエンド**: FastAPI + SQLite (SQLAlchemy)
- **フロントエンド**: バニラJS PWA
- **リアルタイム**: WebSocket
- **プッシュ通知**: Web Push API (VAPID)
- **スケジューラー**: APScheduler (18:00 JST)

## スマートフォンでの利用

1. スマートフォンのブラウザで http://[PCのIPアドレス]:8000 にアクセス
2. 「ホーム画面に追加」でアプリとしてインストール可能
3. 同じWi-Fi内での利用推奨

## 注意事項

- データはローカルのSQLiteファイル（`backend/kondate.db`）に保存されます
- ユーザー認証は不要（2人用のシンプルな作りです）
- プッシュ通知はHTTPSまたはlocalhost環境が必要です
