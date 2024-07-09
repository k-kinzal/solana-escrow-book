# 5. エスクロークライアント

本章では、Rustでエスクロープログラムを呼び出すクライアントの作り方を解説します。

クライアントはRPC（Remote Procedure Call）を通してトランザクションを送信します。
そのため、特定のプログラミング言語に依存せず、どの言語でも作ることができます。しかし、Rustで作る場合、プログラムで作成したコードを流用しやすいため、比較的簡単に作ることができます。

他の言語でクライアントを作る場合も、基本的な流れは同じです。まずはRustでクライアントを作り、どのような実装になるのかを学んでみましょう。

## 5.1. インストラクションを生成する関数の追加

まず、前章で作成したエスクロープログラムに、インストラクションを生成する関数を追加しましょう。
この関数を作ることで、クライアントからの呼び出しが簡単になるだけでなく、CPI（Cross-Program Invocation）で他のプログラムから呼び出すこともしやすくなります。

`program/src/instruction.rs`に関数を追加します。

最初に、エスクローを初期化するインストラクションを生成する関数を作ります。

```diff
+use crate::id;
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};
+use solana_program::instruction::AccountMeta;
+use solana_program::pubkey::Pubkey;
+use solana_program::rent::Rent;
+use solana_program::sysvar::SysvarId;

...

+pub fn init(
+    seller_account_pubkey: Pubkey,
+    seller_token_account_pubkey: Pubkey,
+    temp_token_account_pubkey: Pubkey,
+    escrow_account_pubkey: Pubkey,
+    rent_pubkey: Pubkey,
+    token_program_pubkey: Pubkey,
+    amount: u64,
+) -> solana_program::instruction::Instruction {
+    solana_program::instruction::Instruction::new_with_borsh(
+        crate::id(),
+        &Instruction::Initialize(amount),
+        vec![
+            AccountMeta::new(seller_account_pubkey, true),
+            AccountMeta::new_readonly(seller_token_account_pubkey, false),
+            AccountMeta::new(temp_token_account_pubkey, false),
+            AccountMeta::new(escrow_account_pubkey, false),
+            AccountMeta::new_readonly(rent_pubkey, false),
+            AccountMeta::new_readonly(token_program_pubkey, false),
+        ],
+    )
+}
```

ここでは、SolanaのプログラムやクライアントからESの呼び出しを想定しているため、`solana_program::instruction::Instruction`を返すようにします。

この`solana_program::instruction::Instruction`には、`new_with_borsh`メソッドがあり、Borshでシリアライズできる型をそのまま渡すことができます。

`new_with_borsh`の第3引数には、`Instruction`のコメントで示した期待するアカウントに合わせて設定します。
Rustでは少しわかりにくいですが、`AccountMeta::new`は`writable` = `true`、`AccountMeta::new_readonly`が`writable` = `false`に対応します。

次に、エスクローの交換をするインストラクションを生成する関数を作ります。

```diff
+pub fn exchange(
+    buyer_account_pubkey: Pubkey,
+    buyer_send_token_account_pubkey: Pubkey,
+    buyer_receive_token_account_pubkey: Pubkey,
+    temp_token_account_pubkey: Pubkey,
+    seller_account_pubkey: Pubkey,
+    seller_token_account_pubkey: Pubkey,
+    escrow_account_pubkey: Pubkey,
+    token_program_pubkey: Pubkey,
+    pda_account_pubkey: Pubkey,
+    amount: u64,
+) -> solana_program::instruction::Instruction {
+    solana_program::instruction::Instruction::new_with_borsh(
+        id(),
+        &Instruction::Exchange(amount),
+        vec![
+            AccountMeta::new(buyer_account_pubkey, true),
+            AccountMeta::new(buyer_send_token_account_pubkey, false),
+            AccountMeta::new(buyer_receive_token_account_pubkey, false),
+            AccountMeta::new(temp_token_account_pubkey, false),
+            AccountMeta::new(seller_account_pubkey, false),
+            AccountMeta::new(seller_token_account_pubkey, false),
+            AccountMeta::new(escrow_account_pubkey, false),
+            AccountMeta::new_readonly(token_program_pubkey, false),
+            AccountMeta::new_readonly(pda_account_pubkey, false),
+        ],
+    )
+}
```

これも`init`関数と同様に、コメントに合わせて設定します。

この2つの関数を使って、クライアントを作成していきます。

## 5.2. クライアントの作成

本来はクライアントを別のクレートに分けるべきですが、今回は`escrow-program` クレート内にクライアントを作ることにします。

`src/client.rs`を作成し、`src/lib.rs`にモジュールを追加します。

```diff
use solana_program::entrypoint;

+ mod client;
mod instruction;
mod processor;
mod spl_token;
mod state;

entrypoint!(process_instruction);
...
```

`src/lib.rs`に追加できたら、次に`src/client.rs`にクライアントを定義しましょう。

```rust
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_program::example_mocks::solana_sdk::signature::{Signature, Signer};
use solana_program::pubkey::Pubkey;
use solana_program::system_program;
use solana_rpc_client_api::client_error::Result as ClientResult;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("{0}")]
    RpcError(#[from] solana_rpc_client_api::client_error::Error),
    #[error("{0}")]
    ProgramError(#[from] solana_sdk::program_error::ProgramError),
    #[error("error")]
    SerializeSizeError(borsh::schema::SchemaMaxSerializedSizeError),
    #[error("error")]
    IoError(#[from] std::io::Error),
}

impl From<borsh::schema::SchemaMaxSerializedSizeError> for ClientError {
    fn from(err: borsh::schema::SchemaMaxSerializedSizeError) -> Self {
        ClientError::SerializeSizeError(err)
    }
}

pub type Result<T> = std::result::Result<T, ClientError>;

pub struct Client {
    client: Arc<RpcClient>,
    payer: Keypair,
    escrow_program_id: Pubkey,
    token_program_id: Pubkey,
}

impl Client {
    pub fn builder(client: Arc<Client>, payer: Keypair) -> ClientBuilder {
        ClientBuilder::new(client, payer)
    }

    pub async fn init(&self) -> ClientResult<Signature> {
        todo!()
    }

    pub async fn exchange(&self) -> ClientResult<Signature> {
        todo!()
    }
}

struct ClientBuilder {
    client: Arc<Client>,
    payer: Keypair,
    escrow_program_id: Option<Pubkey>,
    system_program_id: Option<Pubkey>,
    token_program_id: Option<Pubkey>,
}

impl ClientBuilder {
    pub fn new(client: Arc<Client>, payer: Keypair) -> Self {
        Self {
            client,
            payer
            escrow_program_id: None,
            system_program_id: None,
            token_program_id: None,
        }
    }

    pub fn with_escrow_program_id(mut self, escrow_program_id: Pubkey) -> Self {
        self.escrow_program_id = Some(escrow_program_id);
        self
    }

    pub fn with_token_program_id(mut self, token_program_id: Pubkey) -> Self {
        self.token_program_id = Some(token_program_id);
        self
    }

    pub fn build(self) -> Client {
        Client {
            client: self.client,
            payer: self.payer
            escrow_program_id: self.escrow_program_id.unwrap_or_else(crate::id),
            token_program_id: self.token_program_id.unwrap_or_else(spl_token::id),
        }
    }
}
```

特に強い意図はありませんが、ビルダーパターンを使って、RPCクライアントをラップしたクライアントを作成します。
これにより、以下のようにプログラムのIDを設定して呼び出すことができるようになります。

```rust
let client = Client::builder(rpc_client, payer)
    .with_escrow_program_id(other_escrow_program_id)
    .with_token_program_id(other_token_program_id)
    .build()
```

例えば、トークンプログラムとして呼び出すプログラムをトークンプログラム2022に変更するのに使用します。
逆に、旧トークンプログラムを呼び出したい場合は、`with_token_program_id`を呼び出さないことで、旧トークンプログラムを使用できます。

このように、設定を変更しつつ、クライアントの振る舞いとして初期化時にのみ設定したいという場合に、ビルダーパターンを使うと便利なので、筆者はよく活用しています。
ただし、あくまでも好みの範囲なので、ビルダーパターンを使わなくても構いません。

それでは、この`Client`の`pub async fn init(&self) -> ClientResult<Signature>`と`pub async fn exchange(&self) -> ClientResult<Signature>`を実装していきましょう。

クライアント側の処理は、どれも以下のような流れになります。

1. インストラクションに必要な情報を集める
2. インストラクションを作成する
3. インストラクションをまとめてトランザクションを作成する
4. RPCにトランザクションを送信する

この流れに沿って、それぞれのメソッドを実装しましょう。

### initの実装

それでは、先ほどのクライアントで`init`関数を実装しましょう。

```diff
-    pub async fn init(&self) -> ClientResult<Signature> {
+    pub async fn init(
+        &self,
+        send_mint_token_account_pubkey: Pubkey,
+        send_amount: u64,
+        receive_mint_token_account_pubkey: Pubkey,
+        receive_expected_amount: u64,
+    ) -> Result<(Signature, Pubkey)> 
-        todo!()
+    Ok(())
    }
```

まず、インターフェースを変更します。
インターフェースの設計はケースバイケースで一概には言えませんが、エスクローの場合は登場するアカウントが多く、これを全て含めるとわかりにくくなるため、最小限の入力で動作するようにします。

エスクローの初期化では、売り手がどのような取引を望むのかがわかる最小限の引数として、以下の4つを扱います。

1. 売り手が送信するミントトークンのアドレス
2. 売り手が送信するトークンの量
3. 売り手が期待する受け取るミントトークンのアドレス
4. 売り手が期待する受け取るトークンの量

これらの引数を元に、エスクローを初期化します。

この`init`は、 2. エスクローとは で解説した Aトランザクション に相当します。
どのような指示が必要になるのか思い出してみましょう。

> 1. System Program (CreateAccount): 空のアカウントを作成 (関連トークンアカウント用)
> 2. Token Program (InitializeAccount): 1で作成した空のアカウントを関連トークンアカウントとして初期化
> 3. Token Program (Transfer): Aが所有しているアカウントから2で初期化した関連トークンアカウントにトークンを送信
> 4. System Program (Create Account): 空のアカウントを作成（エスクロー状態アカウント用）
> 5. Escrow Program (Initialize):
     >     1. エスクロー状態アカウントを初期化
     >     2. PDAでプログラムで利用できるアドレスを生成
>     3. Token Program (Set Authority): 2で作成した関連トークンアカウントの所有者をPDAのアドレスに変更

必要なのは、この5つの指示をまとめたトランザクションです。

それでは、1つずつ見ていきましょう。

まず、システムプログラムの`CreateAccount`指示です。
これは`solana_sdk::system_instruction::create_account`から作成できます。

```
fn create_account(
    from_pubkey: &Pubkey,
    to_pubkey: &Pubkey,
    lamports: u64,
    space: u64,
    owner: &Pubkey
) -> Instruction
```

というようなシグネチャになります。
これを使って、エスクローが保持する一時的な関連トークンアカウントのアカウントを作成します。

Solanaでは、アカウントを作成するさいに`CreateAccount`指示を呼び出します。

```rust
let temp_token_account = Keypair::new();
let temp_token_account_len = spl_token::state::Account::LEN;
let temp_token_account_lamports = self
    .client
    .get_minimum_balance_for_rent_exemption(temp_token_account_len)
    .await?;

system_instruction::create_account(
    &self.payer.pubkey(),
    &temp_token_account.pubkey(),
    temp_token_account_lamports,
    temp_token_account_len as u64,
    &self.token_program_id,
)
```

このように、`temp_token_account`のキーペアを作成し、必要な情報を`create_account`に渡します。

このとき、`lamports`に一定量の`lamport`を設定しないと、家賃（rent）を免除できず、一定期間後にアカウントが削除されてしまいます。
それを防ぐために、RPCに対して`get_minimum_balance_for_rent_exemption`を呼び出し、今回作成するアカウントのデータサイズから、家賃免除に必要な`lamport`の量を取得します。

アカウントのデータサイズの算出方法は、プログラムの実装方法によって異なる点に注意してください。
対象のSPLトークンでは、`Pack`トレイトを使った実装をしており、このケースでは`const`で`LEN`が定義されるため、これを参照することでデータサイズを取得します。

次に、1で作成したアカウントを関連トークンアカウントとして初期化するために、トークンプログラムの`InitializeAccount`指示を作成します。
これは`spl_token::instruction::initialize_account`から作成できます。

```rust
pub fn initialize_account(
    token_program_id: &Pubkey,
    account_pubkey: &Pubkey,
    mint_pubkey: &Pubkey,
    owner_pubkey: &Pubkey,
) -> Result<Instruction, ProgramError>
```

というようなシグネチャになります。
これを使って、エスクローが保持する一時的な関連トークンアカウントのアカウントを初期化します。

```rust
spl_token::instruction::initialize_account(
    &self.token_program_id,
    &temp_token_account.pubkey(),
    &send_mint_token_account_pubkey,
    &self.payer.pubkey(),
)?,
```

これは、既に必要な情報が集まっているため、`initialize_account`を呼び出すだけで済みます。

注意点として、この時点ではオーナーは売り手である`payer`を指定します。
最終的にはエスクロープログラムがオーナーになりますが、オーナーのアドレスはPDAにする必要があり、PDAで署名するにはプログラム上でしかできないためです。

次に、トークンプログラムの`Transfer`指示です。
これは`spl_token::instruction::transfer`から作成できます。

```rust
fn transfer(
    token_program_id: &Pubkey,
    source_pubkey: &Pubkey,
    destination_pubkey: &Pubkey,
    authority_pubkey: &Pubkey,
    signer_pubkeys: &[&Pubkey],
    amount: u64,
) -> Result<Instruction, ProgramError>
```

というようなシグネチャになります。
これを使って、売り手の関連トークンアカウントから、エスクローが保持する一時的な関連トークンアカウントにトークンを転送して預け入れます。

```rust
let send_seller_token_account_pubkey =
    spl_associated_token_account::get_associated_token_address_with_program_id(
        &self.payer.pubkey(),
        &send_mint_token_account_pubkey,
        &self.token_program_id,
    );

spl_token::instruction::transfer(
    &self.token_program_id,
    &send_seller_token_account_pubkey,
    &temp_token_account.pubkey(),
    &self.payer.pubkey(),
    &[&self.payer.pubkey()],
    send_amount,
)?,
```

この処理では、売り手の関連トークンアカウントのアドレスを特定する必要があります。

`spl-token`というCLIツールからアカウントを作成した場合、関連トークンアカウントはPDAになります。
具体的には、 `ウォレットのアドレス` + `トークンプログラムのアドレス` + `ミントトークンのアドレス` から導出できる一意のアドレスとなります。

大抵のユーザーが作成する関連トークンアカウントはPDAで作られるため、本書ではPDAから導出可能と見なし、`spl_associated_token_account::get_associated_token_address_with_program_id`を使ってアドレスを解決します。

もし、この動きが気になる方は、`init`で受け取る引数に売り手のミントトークンに関連した関連トークンアカウントを受け取ったり、RPCに対してアカウントの存在チェックを行い、存在しなければ関連トークンアカウントを別途作るように変更してみてください。
アプリケーションとしてユーザーにわかりやすい体験をさせるという意味では、こういった動きをさせるのが望ましいです。

次に、一時関連トークンアカウントの作成と同様に、システムプログラムの`CreateAccount`を利用し、エスクローアカウントのアカウントを作成します。

```rust
let escrow_account = Keypair::new();
let escrow_account_len = borsh::max_serialized_size::<escrow_program::state::Escrow>()?;
let escrow_account_lamports = self
    .client
    .get_minimum_balance_for_rent_exemption(escrow_account_len)
    .await?;

system_instruction::create_account(
    &self.payer.pubkey(),
    &escrow_account.pubkey(),
    escrow_account_lamports,
    escrow_account_len as u64,
    &self.escrow_program_id,
),
```

先ほどは関連トークンアカウント用でしたが、今度はエスクローアカウント用に`CreateAccount`指示を作成します。

エスクローアカウントはBorshフォーマットを利用しており、`borsh`では`borsh::max_serialized_size::<T>()`を使用することでサイズを算出できます。
ただし、関数名の通り最大サイズを取得するため、構造体が固定サイズでない場合は、家賃免除にかかる賃料が想定より大きくなる可能性があります。
エスクローでは固定サイズなので、気にする必要はありません。

最後は、エスクロープログラムの`Initialize`指示です。
これは、最初に作成した関数を呼び出して作成します。

```rust
let receive_seller_token_account_pubkey =
    spl_associated_token_account::get_associated_token_address_with_program_id(
        &self.payer.pubkey(),
        &receive_mint_token_account_pubkey,
        &self.token_program_id,
    );

escrow_program::instruction::init(
    self.escrow_program_id,
    self.payer.pubkey(),
    receive_seller_token_account_pubkey,
    temp_token_account.pubkey(),
    escrow_account.pubkey(),
    Rent::id(),
    self.token_program_id,
    receive_expected_amount,
),
```

この指示の作成では、売り手が受け取りに使用する関連トークンアカウントが必要になるため、`Transfer`指示のときと同様に、関連トークンアカウントのアドレスを特定します。

これらの指示をまとめてトランザクションにして送信するコードは、以下のようになります。

```rust
let blockhash = self.client.get_latest_blockhash().await?;

let tx = Transaction::new_signed_with_payer(
    &[
      // ここにinstructionsを含める
    ],
    Some(&self.payer.pubkey()),
    &[&self.payer, &temp_token_account, &escrow_account],
    blockhash,
);

let signature = self.client.send_transaction(&tx).await?;
```

トランザクションを作成する際に、ブロックハッシュが必要になるため、RPCに対して`get_latest_blockhash`を呼び出してブロックハッシュを取得します。
ブロックハッシュは、トランザクションが送信されると、そのトランザクションに含まれるブロックハッシュを使用して、そのトランザクションが最新のブロックに基づいているかどうかを検証します。
これにより、古いブロックハッシュに基づいたトランザクションが無効となり、二重支出やリプレイアタックを防ぐことができます。

トランザクションを作成する際に、指示、手数料の支払い者、署名のためのキーペア、ブロックハッシュを渡します。

署名のためのキーペアで何を渡す必要があるかを判断するには、それぞれの指示の実装を見ていただくのが早いです。

```rust
AccountMeta::new(pubkey, true)
AccountMeta::new_readonly(pubkey, true)
```

指示の作成関数の中で`AccountMeta`を作成しており、この`new`または`new_readonly`の第2引数が`true`になっているものが署名の対象です。
その公開鍵に対応する秘密鍵、つまりキーペアをトランザクションに渡す必要があります。

ここで作成したトランザクションをRPCの`SendTransaction`で送信することで、それぞれの指示が動作し、エスクローアカウントを作成できます。

これまでの実装を合わせると、以下のようなコードになります。

```rust
    pub async fn init(
        &self,
        send_mint_token_account_pubkey: Pubkey,
        send_amount: u64,
        receive_mint_token_account_pubkey: Pubkey,
        receive_expected_amount: u64,
    ) -> Result<(Signature, Pubkey)> {
        let send_seller_token_account_pubkey =
            spl_associated_token_account::get_associated_token_address_with_program_id(
                &self.payer.pubkey(),
                &send_mint_token_account_pubkey,
                &self.token_program_id,
            );
        let receive_seller_token_account_pubkey =
            spl_associated_token_account::get_associated_token_address_with_program_id(
                &self.payer.pubkey(),
                &receive_mint_token_account_pubkey,
                &self.token_program_id,
            );

        let temp_token_account = Keypair::new();
        let temp_token_account_len = spl_token::state::Account::LEN;
        let temp_token_account_lamports = self
            .client
            .get_minimum_balance_for_rent_exemption(temp_token_account_len)
            .await?;

        let escrow_account = Keypair::new();
        let escrow_account_len = borsh::max_serialized_size::<Escrow>()?;
        let escrow_account_lamports = self
            .client
            .get_minimum_balance_for_rent_exemption(escrow_account_len)
            .await?;

        let blockhash = self.client.get_latest_blockhash().await?;

        let tx = Transaction::new_signed_with_payer(
            &[
                system_instruction::create_account(
                    &self.payer.pubkey(),
                    &temp_token_account.pubkey(),
                    temp_token_account_lamports,
                    temp_token_account_len as u64,
                    &self.token_program_id,
                ),
                spl_token::instruction::initialize_account(
                    &self.token_program_id,
                    &temp_token_account.pubkey(),
                    &send_mint_token_account_pubkey,
                    &self.payer.pubkey(),
                )?,
                spl_token::instruction::transfer(
                    &self.token_program_id,
                    &send_seller_token_account_pubkey,
                    &temp_token_account.pubkey(),
                    &self.payer.pubkey(),
                    &[&self.payer.pubkey()],
                    send_amount,
                )?,
                system_instruction::create_account(
                    &self.payer.pubkey(),
                    &escrow_account.pubkey(),
                    escrow_account_lamports,
                    escrow_account_len as u64,
                    &self.escrow_program_id,
                ),
                escrow_program::instruction::init(
                    self.escrow_program_id,
                    self.payer.pubkey(),
                    receive_seller_token_account_pubkey,
                    temp_token_account.pubkey(),
                    escrow_account.pubkey(),
                    Rent::id(),
                    self.token_program_id,
                    receive_expected_amount,
                ),
            ],
            Some(&self.payer.pubkey()),
            &[&self.payer, &temp_token_account, &escrow_account],
            blockhash,
        );

        let signature = self.client.send_transaction(&tx).await?;

        Ok((signature, escrow_account.pubkey()))
    }
```

### exchangeの実装

それでは次に、クライアントの`exchange`関数を実装しましょう。

```diff
-    pub async fn exchange(&self) -> ClientResult<Signature> {
+    pub async fn exchange(&self, escrow_account_pubkey: Pubkey) -> Result<Signature> {
-        todo!()
+        Ok(())
    }
```

`exchange`では、`init`で作成したエスクローアカウントを元に取引を実現させます。

この`exchange`は、 2. エスクローとは で解説した Bトランザクション に相当します。
どのような指示が必要になるのか思い出してみましょう。

> 1. Escrow Program (Exchange)
>     1. 取引の妥当性を検証
>     2. Token Program (Transfer): BからAにトークンを送信
>     3. Token Program (Transfer): エスクロープログラムからBにトークンを送信
>     4. Token Program (CloseAccount): エスクロープログラムが所有する関連トークンアカウントを削除
>     5. エスクロー状態アカウントを削除

`init`とは違い、`exchange`で必要になる指示は、エスクロープログラムの`Exchange`だけになります。
その代わりに、買い手のアカウントとエスクローアカウントから10個のアカウントを特定する必要があります。

まず、受け取ったエスクローアカウントのアドレスから、RPCに問い合わせてエスクローアカウント本体を取得します。

```rust
let escrow_account = self.client.get_account(&escrow_account_pubkey).await?;
```

ここで取得したアカウントのデータ部をデシリアライズして、エスクローアカウントの状態を参照できるようにします。

```rust
let escrow_state = Escrow::try_from_slice(&escrow_account.data)?;
```

このエスクローアカウントの状態から、取引の対象になっているミントアカウントのアドレスを特定します。

```rust
let seller_token_account = self
    .client
    .get_account(&escrow_state.seller_token_account_pubkey)
    .await?;
let seller_token_account_state =
    spl_token::state::Account::unpack(&seller_token_account.data)?;

let temp_token_account = self
    .client
    .get_account(&escrow_state.temp_token_account_pubkey)
    .await?;
let temp_token_account_state = spl_token::state::Account::unpack(&temp_token_account.data)?;
```

`seller_token_account_pubkey`からアカウントを解決し、売り手が受け取りたい = 買い手が送信するミントアカウントのアドレスを特定します。
アカウントのデータ部を`unpack`すると、`seller_token_account_state.mint`という形でミントアカウントのアドレスを取得できます。

`temp_token_account_pubkey`からアカウントを解決し、売り手が送信した = 買い手が受け取るミントアカウントのアドレスを特定します。
こちらも同様に、アカウントのデータ部を`unpack`すると、`temp_token_account.mint`という形でミントアカウントのアドレスを取得できます。

取引に必要なミントアカウントのアドレスが特定できたので、次に買い手が取引で利用する関連トークンアカウントを特定します。

```rust
let buyer_send_token_account_pubkey =
    spl_associated_token_account::get_associated_token_address_with_program_id(
        &self.payer.pubkey(),
        &seller_token_account_state.mint,
        &self.token_program_id,
    );

let buyer_receive_token_account_pubkey =
    spl_associated_token_account::get_associated_token_address_with_program_id(
        &self.payer.pubkey(),
        &temp_token_account_state.mint,
        &self.token_program_id,
    );
```

これも`init`のときと同様に、関連トークンアカウントでPDAが利用されている前提で作成します。
もし、PDAが利用されていない場合の関連トークンアカウントを利用したい場合は、アドレスを引数で受け取るようにしてください。

最後に、PDAに対応したアカウントを渡すために、対応するPDAを生成します。

```rust
let (pda_account_pubkey, _) =
    Pubkey::find_program_address(&[b"escrow"], &self.escrow_program_id);
```

これは、エスクロープログラムでPDAを生成したときと同様の`seeds`を渡すようにしてください。
`get_associated_token_address_with_program_id`のように、エスクロープログラム側に対応する関数を作るのも良い考えです。

ここまでできたら、指示とトランザクションを作成し、送信できます。

```rust
let blockhash = self.client.get_latest_blockhash().await?;

let tx = Transaction::new_signed_with_payer(
    &[escrow_program::instruction::exchange(
        self.escrow_program_id,
        self.payer.pubkey(),
        buyer_send_token_account_pubkey,
        buyer_receive_token_account_pubkey,
        escrow_state.temp_token_account_pubkey,
        escrow_state.seller_pubkey,
        escrow_state.seller_token_account_pubkey,
        escrow_account_pubkey,
        self.token_program_id,
        pda_account_pubkey,
        temp_token_account_state.amount,
    )],
    Some(&self.payer.pubkey()),
    &[&self.payer],
    blockhash,
);

let signature = self.client.send_transaction(&tx).await?;
```

`init`関数のときと同様に、必要な指示、署名者のキーペアを渡し、トランザクションを作成して送信しましょう。

これまでの実装を合わせると、以下のようなコードになります。

```rust
    pub async fn exchange(&self, escrow_account_pubkey: Pubkey) -> Result<Signature> {
        let escrow_account = self.client.get_account(&escrow_account_pubkey).await?;
        let escrow_state = Escrow::try_from_slice(&escrow_account.data)?;

        let seller_token_account = self
            .client
            .get_account(&escrow_state.seller_token_account_pubkey)
            .await?;
        let seller_token_account_state =
            spl_token::state::Account::unpack(&seller_token_account.data)?;

        let temp_token_account = self
            .client
            .get_account(&escrow_state.temp_token_account_pubkey)
            .await?;
        let temp_token_account_state = spl_token::state::Account::unpack(&temp_token_account.data)?;

        let buyer_send_token_account_pubkey =
            spl_associated_token_account::get_associated_token_address_with_program_id(
                &self.payer.pubkey(),
                &seller_token_account_state.mint,
                &self.token_program_id,
            );

        let buyer_receive_token_account_pubkey =
            spl_associated_token_account::get_associated_token_address_with_program_id(
                &self.payer.pubkey(),
                &temp_token_account_state.mint,
                &self.token_program_id,
            );

        let (pda_account_pubkey, _) =
            Pubkey::find_program_address(&[b"escrow"], &self.escrow_program_id);

        let blockhash = self.client.get_latest_blockhash().await?;

        let tx = Transaction::new_signed_with_payer(
            &[escrow_program::instruction::exchange(
                self.escrow_program_id,
                self.payer.pubkey(),
                buyer_send_token_account_pubkey,
                buyer_receive_token_account_pubkey,
                escrow_state.temp_token_account_pubkey,
                escrow_state.seller_pubkey,
                escrow_state.seller_token_account_pubkey,
                escrow_account_pubkey,
                self.token_program_id,
                pda_account_pubkey,
                temp_token_account_state.amount,
            )],
            Some(&self.payer.pubkey()),
            &[&self.payer],
            blockhash,
        );

        let signature = self.client.send_transaction(&tx).await?;
        Ok(signature)
    }
```

## 5.3. クライアントの公開

最後に、`src/lib.rs`を変更して、クライアントを他のクレートから呼び出せるように公開しましょう。

```rust
mod client;

pub use crate::client::{Client, ClientBuilder, ClientError, Result};
```

公開する際に、`pub mod client`や`pub use crate::client::*`というようにしても構いません。
筆者の場合は、何をどのように公開するのかにこだわるため、1つずつ指定しますが、趣味の領域のためアクセスできればどの方法を使っても問題ありません。

## 5.4. 章のまとめ

この章では、エスクロープログラムを呼び出すクライアントの実装しました。

クライアントの実装に特に正解というものはありません。
例えば、SPLのトークンプログラムでは構造が違い、`Token`というミントアカウントを表す構造体にクライアントを持たせるような実装になっていたりします。

そのため、クライアントの実装は主にユーザーにどのように使ってほしいか、どのようにすればユーザーが簡単に使えるかを意識することが重要です。

次の章では、このクライアントを利用して、コマンドラインからエスクロープログラムを呼び出せるCLIアプリケーションを作成してみましょう。
