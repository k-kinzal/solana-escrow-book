# 3. エスクロープロジェクトのセットアップ

本章では、エスクローを開発するためのプロジェクトのセットアップします。

前提として、Rustの開発環境がセットアップ済みであるものとして進めていきます。
もし、まだセットアップが完了していない場合は、Rust公式のインストールガイド (https://www.rust-lang.org/tools/install) を参照して、セットアップを行ってください。

また、エスクローの開発例としてコードを公開しています。
もし、上手くいかないときは、こちらを参考にしてみてください。

- https://github.com/k-kinzal/solana-escrow

ただし、上記のリポジトリは随時更新される可能性があるため、本書の内容と異なる場合があります。
その際には、コミットログやプルリクエストなどを見て、変更理由を確認してください。

## 3.1. Solana CLIのインストール

Solana CLIは、プロジェクトのデプロイで必要になります。
本書では`1.18.17`を利用してエスクローの開発を進めるため、同バージョンのSolana CLIをインストールしましょう。

もし、他のバージョンを利用する場合は、公式ドキュメントのインストールガイド (https://docs.solanalabs.com/cli/install) を参照してください。

**MacOS/Linux**
```bash
$ sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
```

**Windows**
```bash
$ cmd /c "curl https://release.solana.com/v1.18.17/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install-tmp\solana-install-init.exe --create-dirs"
```

以下のようにコマンドを実行して、バージョンが表示されれば、インストールは成功です。

```bash
$ solana --version
solana-cli 1.18.17 (src:b685182a; feat:4215500110, client:SolanaLabs)
```

## 3.2. Rustプロジェクトのセットアップ

本書では、Cargoのワークスペースを利用して、複数のクレートを扱うRustプロジェクトで開発を進めます。

1. program (プログラム本体)
2. client (プログラムを呼び出すクライアントライブラリ)
3. cli (コマンドからプログラムを呼び出すCLIアプリケーション)

プログラムだけでなく、クライアントやCLIアプリケーションを作ることで、ユーザーがそのプログラムを扱いやすくなります。
本来であれば、ブラウザ向けのJavaScriptライブラリを作成するとより良いのですが、クライアントとほぼ同じ内容になるため、本書では割愛します。

それでは、Rustプロジェクトのセットアップを始めましょう。

まず、任意のディレクトリに以下のようなディレクトリ構成とファイルを作成します。
ファイルの中身は、順次書いていくため、一旦は空で構いません。

```
solana-escrow
├── Cargo.toml
├── cli
│   ├── Cargo.toml
│   └── src
│       └── main.rs
├── client
│   ├── Cargo.toml
│   └── src
│       └── lib.rs
└── program
    ├── Cargo.toml
    └── src
        └── lib.rs
```

それでは、ファイルを設定していきましょう。
まず、`solana-escrow/Cargo.toml`にワークスペースの設定を追加します。

**solana-escrow/Cargo.toml**

```toml
[workspace]
resolver = "2"
members = [
    "cli",
    "client",
    "program"
]
```

次に、各ディレクトリの`Cargo.toml`を設定します。

**solana-escrow/program/Cargo.toml**

```toml
[package]
name = "escrow-program"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
no-entrypoint = []

[dependencies]
borsh = "1.2.1"
solana-program = "1.18.17"
spl-token = { version = "=4.0.0", features = ["no-entrypoint"] }

[dev-dependencies]
```

プログラムを作る際の定型句として、`[lib]`に`cdylib`と`lib`を設定します。
`cdylib`はプログラムとして利用するためにダイナミックシステムライブラリとしてビルドするように指定し、`lib`はこのプログラムで定義した型を他のコードから利用できるようにライブラリとしてビルドできるように指定します。

`solana-program`クレートは、プログラムを作成するときに利用するSDKです。
本書では`solana-`接頭辞のクレートはすべて`1.18.17`をベースに開発します。

`spl-token`クレートは、SPLのトークンプログラムの型などを扱うクレートであり、バージョンは`4.0.0`が`solana-program`の`1.18.17`と整合性のあるバージョンになります。

`borsh`クレートは、Borshフォーマットでシリアライズ/デシリアライズを提供するクレートで、バージョンは`1.2.1`が`solana-program`の`1.18.17`と整合性のあるバージョンになります。

Solanaのアプリケーション開発では、クレートのバージョン整合性が取れなくなることがあります。
そういった際には、バージョンを1つずつ確認したり、クレートのリポジトリを確認して利用クレートのバージョンをチェックして、ビルドできるバージョンを探しましょう。

**solana-escrow/client/Cargo.toml**

```toml
[package]
name = "escrow-client"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["lib"]

[dependencies]
borsh = "1.2.1"
escrow-program = { path = "../program", features = ["no-entrypoint"] }
solana-client = "1.18.17"
solana-rpc-client-api = "1.18.17"
solana-sdk = "1.18.17"
spl-token = { version = "=4.0.0", features = ["no-entrypoint"] }
spl-associated-token-account = "3.0.2"
thiserror = "1.0.61"

[dev-dependencies]
```

クライアントでは`solana-program`ではなく、`solana-sdk`を利用します。
また、RPCと通信するために`solana-client`、`solana-rpc-client-api`を利用し、これらのバージョンは合わせて`1.18.17`にしてください。

クライアントでは専用のエラー型を利用するため、エラー定義の定番である`thiserror`クレートを利用します。
手を抜いて作成するなら`anyhow`を利用して専用のエラー型を作らないということもできます。

**solana-escrow/cli/Cargo.toml**

```toml
[package]
name = "escrow-cli"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1.0.75"
clap = { version = "4.5.8", features = ["derive"] }
escrow-client = { path = "../client" }
escrow-program = { path = "../program", features = ["no-entrypoint"] }
serde = '1.0.188'
serde_json = "1.0.107"
serde_yaml = "0.9.25"
solana-cli-config = "1.18.17"
solana-client = "1.18.17"
solana-sdk = "1.18.17"
tokio = { version = "1.38.0", features = ["full"] }

[dev-dependencies]
```

CLIでは、CLI作成の定番である`clap`、設定ファイルの読み書きで利用する`serde`、RPCと非同期な通信をするための`tokio`を利用します。
また、エラーは他と違い分ける必要がないため`anyhow`を利用します。

最後に、ビルドできるように最低限のコードを追加します。

**solana-escrow/program/src/lib.rs**

```rust
use solana_program::account_info::AccountInfo;
use solana_program::entrypoint;
use solana_program::entrypoint::ProgramResult;
use solana_program::pubkey::Pubkey;

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    Ok(())
}
```

プログラムの`lib.rs`には、プログラムとして呼び出せるようにエントリーポイントの設定をします。
処理はあとで開発するため、一旦は`Ok(())`を返すだけで何も行わないプログラムとなります。

**solana-escrow/cli/src/main.rs**

```rust
fn main() {}
```

CLIの`main.rs`には、バイナリの実行時に実行される`main`関数を定義します。
こちらも同様に、あとで開発するため、特に処理は記載しません。

## 3.3. Solanaプログラムのビルド

それでは、まずプログラムのビルドを行ってみましょう。

```bash
$ cargo build-sbf
```

ビルドに成功すると、以下のように`target`ディレクトリ以下に鍵の`.json`とライブラリの`.so`ファイルが生成されます。

```
target
└── deploy
    ├── escrow_program-keypair.json
    └── escrow_program.so
```

ここで生成された`escrow_program-keypair.json`は、プログラムをデプロイするために必要になるため、大切に保管してください。
よくあるミスとして、一時ファイルを削除するために`target`以下を全て削除して鍵を紛失するということがあるので、本当に気をつけてください。

## 3.4. CLIアプリケーションの実行

次に、CLIの実行をしてみましょう。

```bash
$ cargo run --bin escrow-cli 
```

もしくは

```bash
$ cargo build --release 
$ target/release/escrow-cli
```

で実行してください。
特に処理は行っていないため、何も出力されなければ成功です。

## 3.5. 章のまとめ

この章では、エスクローを開発するための前準備をしました。
開発に必要なツールをインストールし、プロジェクトの雛形を作り、動作する状態になっています。

今回は、解説の兼ね合いではじめに全ての依存クレートの設定しました。
しかし、実際に開発するさいには必要だと感じたときに設定するので構いません。

ここで準備したことをもとに、次章からエスクローの開発を進めていきましょう。