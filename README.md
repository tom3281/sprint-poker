# SPRINT POKER

タイパ志向のテキサスホールデム飲みゲーム。判断/フォールドなし、即ショウダウン。

## 仕様

- **デッキ**: 標準52枚
- **ハンド**: 自分2枚 + 場5枚 (共通)、ベスト5枚
- **役強度**: 標準ホールデム (Royal F > SF > 4K > FH > F > S > 3K > 2P > P > HC)
- **負け**: 最弱役の1人 (1杯)
- **決勝戦**: 最弱役が2人以上タイなら、そのプレイヤーだけで再配り。決まるまで繰り返す
- **進行**: 各自スマホで同じルームコードに JOIN → ホストが START

## 構成

- **Cloudflare Workers** + **Durable Objects** + **WebSocket**
- ルームコードで部屋を作って各自のスマホから接続

## 飲み杯数

- 最弱役のプレイヤー: 1杯
- それ以外: 0杯
- (決勝戦が安全網 6 ラウンドで決まらなければ全タイ者 1杯)

## 開発

```bash
npm install
npm run dev      # ローカル wrangler dev
npm run deploy   # Cloudflare Workers にデプロイ
```

## デプロイ後 URL

`https://sprint-poker.tom3281.workers.dev/`
