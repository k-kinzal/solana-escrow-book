# 6. CLIアプリケーション

本章ではエスクロープログラムを呼び出すCLIアプリケーションを作成します。

今回はRustでCLIアプリケーションを作る際の定番クレートである`clap`を利用します。
しかし、`clap`でなければ作れないというわけではないため、もしご自身が利用したいクレートがあればそちらをご利用ください。

それでは`solana-escrow/cli/`配下を変更していきましょう。

## 6.1. Clapの設定

それではまず`clap`の設定を行って、CLIとして機能するようにします。

```
Usage: escrow-cli [OPTIONS] <COMMAND>

Commands:
  init      Initialize escrow agent
  exchange  Exchange tokens between parties
  help      Print this message or the help of the given subcommand(s)

Options:
  -c, --config <CONFIG>                        Path to the configuration file
      --escrow-program-id <ESCROW_PROGRAM_ID>  Escrow program ID
      --token-program-id <TOKEN_PROGRAM_ID>    Token program ID
  -h, --help                                   Print help
```

今回はこのように`init`、`exchange`というサブコマンドでエスクロープログラムを実行できるようにします。

```
Usage: escrow-cli init <SEND_MINT_TOKEN_ADDRESS> <SEND_AMOUNT> <RECEIVE_MINT_TOKEN_ADDRESS> <RECEIVE_EXPECTED_AMOUNT>

Arguments:
  <SEND_MINT_TOKEN_ADDRESS>     Address of mint token to be sent
  <SEND_AMOUNT>                 Amount of mint token to be sent
  <RECEIVE_MINT_TOKEN_ADDRESS>  Address of mint token to be received
  <RECEIVE_EXPECTED_AMOUNT>     Expected amount of mint token to be received

Options:
  -h, --help  Print help
```

`init`サブコマンドでは取引の対象になるミントトークンアカウントのアドレスとトークン数を指定してエスクローを初期化します。

```
Usage: escrow-cli exchange <ESCROW_ADDRESS>

Arguments:
  <ESCROW_ADDRESS>  Address of escrow account

Options:
  -h, --help  Print help
```

`exchange`サブコマンドでは`init`で作成したエスクローアカウントのアドレスを指定して取引を成立させます。

```diff
+#[derive(Parser)]
+struct Cli {
+    #[arg(short, long)]
+    config: Option<PathBuf>,
+    #[arg(long)]
+    escrow_program_id: Option<Pubkey>,
+    #[arg(long)]
+    token_program_id: Option<Pubkey>,
+    #[command(subcommand)]
+    command: Commands,
+}
+
+#[derive(Subcommand, PartialEq, Eq, Debug)]
+enum Commands {
+    #[clap(about = "Initialize escrow agent")]
+    #[clap(arg_required_else_help = true)]
+    Init {
+        #[clap(help = "Address of mint token to be sent")]
+        send_mint_token_address: Pubkey,
+        #[clap(help = "Amount of mint token to be sent")]
+        send_amount: u64,
+        #[clap(help = "Address of mint token to be received")]
+        receive_mint_token_address: Pubkey,
+        #[clap(help = "Expected amount of mint token to be received")]
+        receive_expected_amount: u64,
+    },
+    #[clap(about = "Exchange tokens between parties")]
+    #[clap(arg_required_else_help = true)]
+    Exchange {
+        #[clap(help = "Address of escrow account")]
+        escrow_address: Pubkey,
+    },
+}
+
-fn main() {}
+#[tokio::main]
+async fn main() -> anyhow::Result<()> {
+    let args = Cli::parse();
+
+    Ok(())
+}
```

`clap`ではいくつか方法ありますが、今回では`derive`方式を採用します。
この方式の場合、CLIでどのようなコマンド、引数、オプションを定義し、`parse()`メソッドを呼び出すことでCLIアプリケーションとして動作させることができます。

## 6.2. Solana CLIの設定ファイル読み込み

それでは次にSolana CLIの設定ファイルを読み込みます。
エスクローのCLIアプリケーションとして必要な情報は下記の3つだけです。

- RPCエンドポイント
- コミットメント
- 実行者の鍵

そのため、これらをオプションとして取得でも構いません。

ただ、Solanaを使うCLIアプリケーションではSolana CLIと連動することで、`solana`、`spl-token`といったコマンドと設定を共有して扱いやすいということがあります。
そこで本書ではSolana CLIの設定ファイルを読み込んで連動するようにします。

```diff
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Cli::parse();
    
+    let path = args
+    .config
+    .or_else(|| {
+        env::var("HOME").ok().map(|v| {
+            Path::new(&v)
+                .join(".config")
+                .join("solana")
+                .join("cli")
+                .join("config.yml")
+        })
+    })
+    .unwrap();
+    let path = path
+        .to_str()
+        .ok_or_else(|| anyhow!("config path is invalid"))?;
+    let config = Config::load(path)?;
+
    Ok(())
}
```

ここでは、グローバルオプションの`--config`に指定された値、もしくは指定がない場合はデフォルト値として`$HOME/.config/solana/cli/config.yml`を元にSolana CLIの設定ファイルを読み込みます。

## 6.3. エスクロークライアントの作成

次に先ほど読み込んだ設定ファイルを元にエスクロークライアントを作成します。

```rust
```diff
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    ...
    let config = Config::load(path)?;
    
+     let keypair = Keypair::read_from_file(config.keypair_path)
+        .map_err(|e| anyhow::Error::msg(e.to_string()))?;
+
+    let json_rpc_url = config.json_rpc_url.to_string();
+    let commitment_config = CommitmentConfig::from_str(&config.commitment)?;
+    let rpc_client = Arc::new(RpcClient::new_with_commitment(
+        json_rpc_url,
+        commitment_config,
+    ));
+    let mut builder = Client::builder(rpc_client.clone(), keypair);
+    if let Some(token_program_id) = args.token_program_id {
+        builder = builder.with_token_program_id(token_program_id);
+    }
+    if let Some(escrow_program_id) = args.escrow_program_id {
+        builder = builder.with_escrow_program_id(escrow_program_id);
+    }
+    let escrow = builder.build();
+
    Ok(())
}
```

まず、設定ファイルに含まれる実行者の鍵を読み込みます。
その後にRPCクライアントを作成し、エスクロークライアントビルダーを利用して設定ファイル、CLIの引数を渡してクライアントを生成します。

## 6.4. クライアントの実行

最後に実行されたサブコマンドに合わせて、エスクロークライアントを実行します。

```rust
```diff
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    ...
    let escrow = builder.build();

+    match args.command {
+        Commands::Init {
+            send_mint_token_address,
+            send_amount,
+            receive_mint_token_address,
+            receive_expected_amount,
+        } => {
+            let (signature, escrow_account_pubkey) = escrow
+                .init(
+                    send_mint_token_address,
+                    send_amount,
+                    receive_mint_token_address,
+                    receive_expected_amount,
+                )
+                .await?;
+
+            println!("Create Account: {:?}\n", escrow_account_pubkey);
+            println!("Signature: {:?}", signature);
+        }
+        Commands::Exchange { escrow_address } => {
+            let signature = escrow.exchange(escrow_address).await?;
+            println!("Signature: {:?}", signature);
+        }
+    }
+
    Ok(())
}
```

コマンド実行の出力として、`init`では作成したエスクローアカウントのアドレスとシグネチャを、`exchange`ではシグネチャを表示しています。

これでエスクロープログラムを実行するCLIアプリケーションの作成ができました。

最後にここまで書いたコードをまとめると下記のようになります。

```rust
use anyhow::anyhow;
use clap::{Parser, Subcommand};
use escrow_client::Client;
use solana_cli_config::Config;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{EncodableKey, Keypair};
use std::env;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

/// Cli is a struct that represents the command line arguments.
#[derive(Parser)]
struct Cli {
    /// Path to the configuration file.
    #[arg(short, long)]
    config: Option<PathBuf>,

    /// Escrow program ID.
    #[arg(long)]
    escrow_program_id: Option<Pubkey>,

    /// Token program ID.
    #[arg(long)]
    token_program_id: Option<Pubkey>,

    /// Subcommands for the CLI.
    #[command(subcommand)]
    command: Commands,
}

/// Commands is an enum that represents the subcommands for the CLI.
#[derive(Subcommand, PartialEq, Eq, Debug)]
enum Commands {
    #[clap(about = "Initialize escrow agent")]
    #[clap(arg_required_else_help = true)]
    Init {
        #[clap(help = "Address of mint token to be sent")]
        send_mint_token_address: Pubkey,
        #[clap(help = "Amount of mint token to be sent")]
        send_amount: u64,
        #[clap(help = "Address of mint token to be received")]
        receive_mint_token_address: Pubkey,
        #[clap(help = "Expected amount of mint token to be received")]
        receive_expected_amount: u64,
    },
    #[clap(about = "Exchange tokens between parties")]
    #[clap(arg_required_else_help = true)]
    Exchange {
        #[clap(help = "Address of escrow account")]
        escrow_address: Pubkey,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Cli::parse();

    let path = args
        .config
        .or_else(|| {
            env::var("HOME").ok().map(|v| {
                Path::new(&v)
                    .join(".config")
                    .join("solana")
                    .join("cli")
                    .join("config.yml")
            })
        })
        .unwrap();
    let path = path
        .to_str()
        .ok_or_else(|| anyhow!("config path is invalid"))?;
    let config = Config::load(path)?;
    let keypair = Keypair::read_from_file(config.keypair_path)
        .map_err(|e| anyhow::Error::msg(e.to_string()))?;

    let json_rpc_url = config.json_rpc_url.to_string();
    let commitment_config = CommitmentConfig::from_str(&config.commitment)?;
    let rpc_client = Arc::new(RpcClient::new_with_commitment(
        json_rpc_url,
        commitment_config,
    ));
    let mut builder = Client::builder(rpc_client.clone(), keypair);
    if let Some(token_program_id) = args.token_program_id {
        builder = builder.with_token_program_id(token_program_id);
    }
    if let Some(escrow_program_id) = args.escrow_program_id {
        builder = builder.with_escrow_program_id(escrow_program_id);
    }
    let escrow = builder.build();

    match args.command {
        Commands::Init {
            send_mint_token_address,
            send_amount,
            receive_mint_token_address,
            receive_expected_amount,
        } => {
            let (signature, escrow_account_pubkey) = escrow
                .init(
                    send_mint_token_address,
                    send_amount,
                    receive_mint_token_address,
                    receive_expected_amount,
                )
                .await?;

            println!("Create Account: {:?}\n", escrow_account_pubkey);
            println!("Signature: {:?}", signature);
        }
        Commands::Exchange { escrow_address } => {
            let signature = escrow.exchange(escrow_address).await?;
            println!("Signature: {:?}", signature);
        }
    }

    Ok(())
}
```

## 6.4. 章のまとめ

この章ではエスクロープログラムのCLIアプリケーションを作成しました。

今回のコードを見てわかる通りCLIアプリケーションは簡単に作ることができます。
また、CLIアプリケーションを作ることで、ユーザー目線での動作確認もしやすくなります。

それでは次章では実際にプログラムをデプロイし、CLIアプリケーションで動作の確認をしてみましょう。