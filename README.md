# 絵文字カオス理論 〜おじさん構文版〜

絵文字だけでお題を伝えるオンラインパーティーゲーム。  
指示役はWikipediaからランダムなお題を取得し、5択の絵文字でヒントを送信。  
回答者はメール画面に届く「おじさん構文」スタイルの絵文字を見てお題を当てる。

---

## 🗂 ファイル構成

```
emoji-chaos/
├── server.js          # Node.js + Socket.io サーバー
├── package.json       # 依存関係
├── public/
│   └── index.html     # フロントエンド（全部入り）
└── README.md
```

---

## 🚀 ローカルで動かす

```bash
# 1. 依存パッケージをインストール
npm install

# 2. サーバー起動
npm start

# 3. ブラウザで開く
# http://localhost:3000
```

開発中は `npm run dev`（nodemon でホットリロード）も使えます。

---

## 📦 GitHub にプッシュする

```bash
# リポジトリ初期化（まだの場合）
git init
git add .
git commit -m "first commit"

# GitHub にリポジトリを作ってからpush
git remote add origin https://github.com/あなたのユーザー名/emoji-chaos.git
git branch -M main
git push -u origin main
```

---

## ☁️ Render にデプロイする

1. [https://render.com](https://render.com) にアクセスしてサインイン
2. **New → Web Service** をクリック
3. GitHub リポジトリを接続して `emoji-chaos` を選択
4. 以下を設定：

| 項目 | 値 |
|------|-----|
| **Name** | emoji-chaos（任意） |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free |

5. **Create Web Service** をクリック → 数分でデプロイ完了
6. 発行された URL（例: `https://emoji-chaos.onrender.com`）で遊べる！

> ⚠️ **注意**: Render の無料プランはアイドル後スリープします。  
> 初回アクセス時に30秒ほど起動時間がかかる場合があります。

---

## 🎮 ゲームの遊び方

### ルーム作成（ホスト）
1. 名前を入力して **「ルームを作る」** をクリック
2. 表示されたルームコードを友達に共有
3. モードと制限時間を選んで **「ゲームスタート」**

### ルーム参加（ゲスト）
1. 名前とルームコードを入力して **「ルームに参加」**
2. ホストのスタートを待つ

### ゲームルール
- 最初のラウンドはホストが **指示役**（おじさん）
- 指示役はWikipediaのランダム単語をお題として取得（回答者には非公開）
- 指示役は **5択の絵文字** を選んで送信できる
- 絵文字を送るたびにタイマーがリセット（例: 30秒）
- タイマーが0になる前に次の絵文字を送らないとラウンド終了
- 最大 **100個** の絵文字を送れる
- 回答者はメール画面に届く絵文字を見てお題を入力
- 正解したら回答者と指示役の両方にポイント（早く・少ない絵文字ほど高得点）
- 1ラウンド終了後、指示役が次のプレイヤーに **ローテーション**

---

## ⚙️ 設定項目

| 設定 | 選択肢 |
|------|--------|
| モード | フルカオス（完全ランダム5択）/ タグシンクロ（同カテゴリ5択） |
| 制限時間 | 60秒（イージー）/ 30秒（ノーマル）/ 15秒（ハード） |
| 最大絵文字数 | 100個（固定） |
| 最大人数 | 8人 |

---

## 🔧 技術スタック

- **バックエンド**: Node.js + Express + Socket.io
- **フロントエンド**: Vanilla HTML/CSS/JavaScript（ビルド不要）
- **外部API**: Wikipedia API（お題取得）
- **デプロイ**: Render（無料プラン対応）
