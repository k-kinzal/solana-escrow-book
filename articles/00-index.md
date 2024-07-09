<hr style="break-before: page; visibility: hidden; margin: 0px; padding: 0px; height: 1px;" />

<nav id="toc" role="doc-toc">

# 目次

- [1. はじめに](01-introduction.html)
- [2. エスクローとは](02-what-is-escrow.html)
    - [2.1. 安全な交換アルゴリズム](02-what-is-escrow.html#21-安全な交換アルゴリズム)
    - [2.2. トークンプログラムを使ったエスクロー](02-what-is-escrow.html#22-トークンプログラムを使ったエスクロー)
    - [2.3. プログラムを使ったエスクロー](02-what-is-escrow.html#23-プログラムを使ったエスクロー)
    - [2.4. Program Derived Addressの利用](02-what-is-escrow.html#24-program-derived-addressの利用)
    - [2.5. より具体的なトランザクションとインストラクション](02-what-is-escrow.html#25-より具体的なトランザクションとインストラクション)
    - [2.6. 章のまとめ](02-what-is-escrow.html#26-章のまとめ)
- [3. エスクロープロジェクトのセットアップ](03-escrow-project-setup.html)
  - [3.1. Solana CLIのインストール](03-escrow-project-setup.html#31-solana-cliのインストール)
  - [3.2. Rustプロジェクトのセットアップ](03-escrow-project-setup.html#32-rustプロジェクトのセットアップ)
  - [3.3. Solanaプログラムのビルド](03-escrow-project-setup.html#33-solanaプログラムのビルド)
  - [3.4. CLIアプリケーションの実行](03-escrow-project-setup.html#34-cliアプリケーションの実行)
  - [3.5. 章のまとめ](03-escrow-project-setup.html#35-章のまとめ)
- [4. エスクロープログラム](04-escrow-program.html)
  - [4.1. エントリーポイントの作成](04-escrow-program.html#41-エントリーポイントの作成)
  - [4.2. インストラクションの作成](04-escrow-program.html#42-インストラクションの作成)
  - [4.3. エスクローの状態の定義](04-escrow-program.html#43-エスクローの状態の定義)
  - [4.4. プロセッサの作成](04-escrow-program.html#44-プロセッサの作成)
  - [4.5. プログラムIDの設定](04-escrow-program.html#45-プログラムidの設定)
  - [4.6. 章のまとめ](04-escrow-program.html#46-章のまとめ)
- [5. エスクロークライアント](05-escrow-client.html)
  - [5.1. インストラクションを生成する関数の追加](05-escrow-client.html#51-インストラクションを生成する関数の追加)
  - [5.2. クライアントの作成](05-escrow-client.html#52-クライアントの作成)
  - [5.3. クライアントの公開](05-escrow-client.html#53-クライアントの公開)
  - [5.4. 章のまとめ](05-escrow-client.html#54-章のまとめ)
- [6. CLIアプリケーション](06-escrow-cli.html)
  - [6.1. Clapの設定](06-escrow-cli.html#61-clapの設定)
  - [6.2. Solana CLIの設定ファイルの読み込み](06-escrow-cli.html#62-solana-cliの設定ファイルの読み込み)
  - [6.3. エスクロークライアントの作成](06-escrow-cli.html#63-エスクロークライアントの作成)
  - [6.4. クライアントの実行](06-escrow-cli.html#64-クライアントの実行)
  - [6.5. 章のまとめ](06-escrow-cli.html#65-章のまとめ)
- [7. エスクロープログラムの実行](07-run-escrow.html)
  - [7.1. Solana CLIの設定](07-run-escrow.html#71-solana-cliの設定)
  - [7.2. Solanaトークンの入手](07-run-escrow.html#72-solanaトークンの入手)
  - [7.3. エスクロープログラムのデプロイ](07-run-escrow.html#73-エスクロープログラムのデプロイ)
  - [7.4. ミントトークンの作成](07-run-escrow.html#74-ミントトークンの作成)
  - [7.5. エスクローアカウントの初期化](07-run-escrow.html#75-エスクローアカウントの初期化)
  - [7.6. エスクローの実行](07-run-escrow.html#76-エスクローの実行)
  - [7.7. 章のまとめ](07-run-escrow.html#77-章のまとめ)
- [8. おわりに](08-conclusion.html)

</nav>

<hr style="break-before: page; visibility: hidden; margin: 0px; padding: 0px; height: 1px;" />
<hr style="break-before: page; visibility: hidden; margin: 0px; padding: 0px; height: 1px;" />