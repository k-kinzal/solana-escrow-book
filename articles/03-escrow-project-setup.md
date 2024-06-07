# 3. エスクロープロジェクトのセットアップ

本章では、エスクローを開発するためのプロジェクトのセットアップを行います。

前提として、Rustの開発ができるようにセットアップができていると見なして進めます。
もし、まだセットアップができていない場合は、Rust公式の Install Rust (https://www.rust-lang.org/tools/install) を参照してセットアップを行ってください。

エスクローの実装例としてコードを公開しています。もし、上手くいかないときはこちらを参考にしてください。

- https://github.com/k-kinzal/solana-escrow

注意点として、上記のリポジトリは随時更新されるため、本書の記載内容と異なる可能性があります。
その際には、コミットログやプルリクエストなどを見て変更理由を確認するようにしてください。

## 3.1. Solana CLIのインストール

Solana CLIはプロジェクトのデプロイで必要になります。
本書では`1.18.17`を利用してエスクローの開発をしますので、同バージョンのSolana CLIをインストールしましょう。

もし、他のバージョンを利用する場合は、公式ドキュメントの Install the Solana CLI (https://docs.solanalabs.com/cli/install) を参照してください。

**MacOs/Linux**
```bash
$ sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
```

**Windows**
```bash
$ cmd /c "curl https://release.solana.com/v1.18.17/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install-tmp\solana-install-init.exe --create-dirs"
```

下記のようにコマンドを実行してバージョンが表示できれば成功です。

```bash
$ solana --version
solana --version
solana-cli 1.18.17 (src:b685182a; feat:4215500110, client:SolanaLabs)
```

## 3.2. Rustプロジェクトのセットアップ

本書ではCargoのワークスペースを利用した複数のクレートを扱うRustプロジェクトで開発します。

1. program (プログラム本体)
2. client (プログラムを呼び出すクライアントライブラリ)
3. cli (コマンドからプログラムを呼び出すCLIアプリケーション)

プログラムだけではなく、クライアントやCLIアプリケーションを作ることで、よりユーザーがそのプログラムを扱いやすくすることができます。
本来であればブラウザ向けのJSライブラリを作成するとより良いのですが、作る内容としてはクライアントとほぼ同じものになるため、本書では割愛します。

それでは、Rustプロジェクトのセットアップをしていきましょう。

まず、任意のディレクトリの下記のようなディレクトリ、ファイルを作成しましょう。
ファイルは順次、中を書いていくため一旦は空で構いません。

```
solana-escrow
├── Cargo.toml
├── cli
│   ├── Cargo.toml
│   └── src
│       └── main.rs
├── client
│   ├── Cargo.toml
│   └── src
│       └── lib.rs
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

次に、各ディレクトリの`Cargo.toml`を設定していきましょう。

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

`solana-program`クレートはプログラムを作成するときに利用するSDKです。
本書では`solana-`接頭辞のクレートはすべて`1.18.17`をベースに開発を行います。

`spl-token`クレートはSPLのトークンプログラムの型などを扱うクレートであり、バージョンは`4.0.0`が`solana-program`の`1.18.17`と整合性のあるバージョンになります。

`borsh`クレートはBorshフォーマットでシリアライズ/デシリアライズを提供するクレートで、バージョンは`1.2.1`が`solana-program`の`1.18.17`と整合性のあるバージョンになります。

Solanaのアプリケーション開発ではクレートのバージョンの整合性が取れなくなることがあります。
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

クライアントでは専用のエラー型を利用するため、エラー定義の定番の`thiserror`クレートを利用します。
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

CLIではCLI作成の定番の`clap`、設定ファイルの読み書きで利用する`serde`、RPCと通信する際に非同期に行うための`tokio`の利用を行います。
また、エラーは他と違い分ける必要がないため`anyhow`を利用します。

最後にビルドできるように最低限のコードを追加します。

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

プログラムの`lib.rs`にはプログラムとして呼び出せるようにエントリーポイントの設定をします。
処理はあとで実装するため、一旦は`Ok(())`を返すだけで何も行わないプログラムとなります。

**solana-escrow/cli/src/main.rs**

```rust
fn main() {}
```

CLIの`main.rs`にはバイナリの実行時に実行される`main`関数を定義します。
こちらも同様にあとで実装を行うため、特に処理は記載しません。

### 3.3. Solanaプログラムのビルド

それでは、まずプログラムのビルドを行ってみましょう。

```bash
$ cargo build-sbf
```

ビルドに成功すると下記のように`target`ディレクトリ以下に鍵の`.json`とライブラリの`.so`ファイルが生成されます。

```
target
└── deploy
    ├── escrow_program-keypair.json
    └── escrow_program.so
```

ここで生成された`escrow_program-keypair.json`はプログラムをデプロイするために必要になるため、大切に保管してください。
よく一時ファイルを削除するために`target`以下を全て削除して鍵を紛失するというのはよくあるため、本当に気をつけてください。

### 3.4. CLIアプリケーションの実行

次にCLIの実行をしてみましょう。

```bash
$ cargo run --bin escrow-cli 
```

もしくは

```bash
$ cargo build --release 
$ target/release/escrow-cli
```

で実行してください。特に処理は行っていないため、何も出力されなければ成功です。

### 3.5. 章のまとめ

この章では、エスクローを実装するための前準備を行いました。
具体的には、Solana CLIのインストール、Rustプロジェクトのセットアップ、Solanaプログラムのビルド、そしてCLIアプリケーションの実行を行いました。

Rustプロジェクトでは、Cargoのワークスペースを利用して、プログラム本体、クライアントライブラリ、CLIアプリケーションの3つのクレートを扱う構成を作成しました。
各クレートの依存関係の設定や、必要な最低限のコードを追加することで、プロジェクトの基盤が整いました。

Solanaプログラムのビルドでは、`cargo build-sbf`コマンドを使用し、プログラムの鍵と共有ライブラリを生成しました。
生成された鍵は、プログラムをデプロイする際に必要となるため、大切に保管することが重要です。

CLIアプリケーションの実行では、`cargo run --bin escrow-cliまたはtarget/release/escrow-cli`コマンドを使用し、正常に実行できることを確認しました。

ここで作成したRustプロジェクトを元に、次章からエスクローの実装を進めていきましょう。

<hr style="break-before: page; visibility: hidden; margin: 0px; padding: 0px; height: 1px;" />