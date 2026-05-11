# SPRINT POKER

タイパ志向のショートデッキ・ホールデム飲みゲーム。判断/フォールドなし、即ショウダウン。

## 仕様

- **デッキ**: 28枚 (8・9・10・J・Q・K・A × 4スート)
- **役強度**: 標準ホールデム順 (Royal F > SF > 4K > FH > F > S > 3K > 2P > P > HC)
- **ストレート**: 8-9-10-J-Q / 9-10-J-Q-K / 10-J-Q-K-A の **3種類のみ** (A は high のみ、A-8 は繋がない)
- **ハンド**: 自分2枚 + 場5枚、ベスト5枚
- **公開順**: FLOP (3枚) → TURN (1枚) → RIVER (1枚) → SHOWDOWN を自動進行 (約1.5秒間隔)
- **負け**: 最弱役の1人 (1杯)
- **決勝戦**: 最弱役が2人以上タイなら、そのプレイヤーだけで再配り。決まるまで繰り返す (安全網6ラウンド)
- **進行**: 各自スマホで同じルームコードに JOIN → ホストが START
- **最大人数**: 8人 (物理上限は (28-5)/2 = 11人だが UX で 8 人に絞る)

## 構成

- **Cloudflare Workers** + **Durable Objects** + **WebSocket**
- ルームコードで部屋を作って各自のスマホから接続

## 飲み杯数

- 最弱役のプレイヤー: 1杯
- それ以外: 0杯

## 開発

```bash
npm install
npm run dev      # ローカル wrangler dev
npm run deploy   # Cloudflare Workers にデプロイ
```

## デプロイ後 URL

`https://sprint-poker.tom3281.workers.dev/`
