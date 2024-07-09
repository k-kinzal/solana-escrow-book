# 4. エスクロープログラム

本章では、Rustでエスクロープログラムをどのように実装するかを解説します。

Solanaブロックチェーン上でのプログラムの書き方にはいくつかのパターンがありますが、本書ではSPL（Solana Program Library）で採用されている書き方を使用します。
SPLの書き方は手続き型で読みやすく、SPLのコードを読めるようになれば、Solana Labsが提供するほとんどのコードが理解できるようになるからです。

ただし、SPLのコードは書いた人や時期によって書き方にばらつきがあるので注意が必要です。
そのため、本書では筆者が判断したSPLの中で最も書きやすく読みやすいと思われるスタイルを採用していることをご了承ください。

それでは、前章で作成したプロジェクトの`solana-escrow/program`ディレクトリを変更していきましょう。

## 4.1. エントリーポイントの作成

前章でエントリーポイントは作成済みですが、クレートとして再利用しやすいようにエントリーポイントを移動させます。

まず、`src/entrypoint.rs`を作成し、`src/lib.rs`の内容をそちらに移動します。

**src/entrypoint.rs**
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

次に`src/lib.rs`を変更し、`feature`が指定された場合に`entrypoint`モジュールを読み込まないようにします。

**src/lib.rs**
```rust
-use solana_program::account_info::AccountInfo;
-use solana_program::entrypoint;
-use solana_program::entrypoint::ProgramResult;
-use solana_program::pubkey::Pubkey;
-
-entrypoint!(process_instruction);
-
-fn process_instruction(
-    program_id: &Pubkey,
-    accounts: &[AccountInfo],
-    instruction_data: &[u8],
-) -> ProgramResult {
-    Ok(())
-}
+#[cfg(not(feature = "no-entrypoint"))]
+mod entrypoint;
```

こうすることで、クレートを利用する際にエントリーポイントが不要な場合に、最終的なバイナリサイズを削減できます。

エントリーポイントの仕組みを簡単に解説すると、`entrypoint!`マクロに`&Pubkey`、`&[AccountInfo]`、`&[u8]`を引数に取る関数を登録することで、Solanaブロックチェーン上でプログラムが呼び出された際に、登録した関数が実行されるようになります。

`entrypoint!`マクロを展開すると、以下のようなコードになります。

```rust
# Safety 
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    let (program_id, accounts, instruction_data) =
        unsafe { ::solana_program::entrypoint::deserialize(input) };
    match process_instruction(&program_id, &accounts, &instruction_data) {
        Ok(()) => ::solana_program::entrypoint::SUCCESS,
        Err(error) => error.into(),
    }
}
```

これは、FFI（Foreign Function Interface）での呼び出しの典型的なパターンで、バイト列のポインタを受け取り、そこを書き換えて成功/失敗を返すことがわかります。

本書では、FFIやSolanaがプログラムをどのように呼び出すかについては詳しく解説しませんが、興味のある方はぜひ調べてみてください。きっと面白い発見があるはずです。

## 4.2. インストラクションの作成

次に、クライアントから受け取るインストラクションを実装します。

`src/instruction.rs`を作成し、`src/lib.rs`にモジュールを追加します。

```diff
+mod instruction;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;
...
```

`src/lib.rs`に追加できたら、次は`src/instruction.rs`にインストラクションを定義しましょう。

```rust
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, BorshSchema)]
pub enum Instruction {
    Initialize(u64),
    Exchange(u64),
}
```

Solanaブロックチェーンのアカウントモデルの特性上、1つのプログラムで複数のインストラクションを処理するために、`enum`で定義するのが一般的です。

`Initialize`は取引の初期化を行い、取引可能な状態にします。
このとき渡される数値は、売り手が買い手に送信してほしいトークンの量を表します。

`Exchange`は、取引可能な状態になった取引を実際に成立させます。
このとき渡される数値は、買い手が売り手に期待するトークンの量であり、この量が売り手が設定した量と一致しなければ取引は成立しません。
取引が成立すると、エスクローアカウントは削除されます。

今回は簡単のため、シリアライズ/デシリアライズにはBorshという軽量なフォーマットを使用しています。

より標準的な書き方をしたい場合は、以下のように`unpack`と`pack`メソッドを実装してください。
メソッド名やシグネチャは特に決まりはありませんが、SPLではよく見かける形式です。

```rust
pub enum Instruction {
    Initialize(u64),
    Exchange(u64),
}

impl Instruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        todo!()
    }
    
    pub fn pack(&self) -> Vec<u8> {
        todo!()
    }
}
```

今回は最低限の機能として、初期化と交換の2つのインストラクションをサポートします。
ただし、実際のアプリケーションでは、交換の成立前にキャンセルできるインストラクションがあると、より使いやすくなるでしょう。

現状の実装では、それぞれのインストラクションでどのようなアカウントを渡すのかがわかりにくいという問題があります。

```diff
...
pub enum Instruction {
+    /// Initialize escrow agent and enable the transaction.
+    ///
+    ///
+    /// Accounts expected:
+    ///
+    ///   0. `[signer]` The account of the person initializing the escrow
+    ///   1. `[]` The initializer's token account for the token they will receive should the trade go through
+    ///   2. `[writable]` Temporary token account that should be created prior to this instruction and owned by the initializer
+    ///   3. `[writable]` The escrow account, it will hold all necessary info about the trade.
+    ///   4. `[]` The rent sysvar
+    ///   5. `[]` The token program
    Initialize(u64),
+    /// Accepts a trade
+    ///
+    ///
+    /// Accounts expected:
+    ///
+    ///   0. `[signer]` The account of the person taking the trade
+    ///   1. `[writable]` The taker's token account for the token they send
+    ///   2. `[writable]` The taker's token account for the token they will receive should the trade go through
+    ///   3. `[writable]` The PDA's temp token account to get tokens from and eventually close
+    ///   4. `[writable]` The initializer's main account to send their rent fees to
+    ///   5. `[writable]` The initializer's token account that will receive tokens
+    ///   6. `[writable]` The escrow account holding the escrow info
+    ///   7. `[]` The token program
+    ///   8. `[]` The PDA account
    Exchange(u64),
}
```

そこで、SPLの慣例に倣って、このようにコメントでどのようなアカウントを渡すことを期待しているのかを明記します。
ただし、コメントで書くと制約を強制できませんし、何より多様な言語からクライアントを生成する際にコメントの解析が必要になってしまいます。
もしこの辺りをうまく管理したい場合は、SPLの書き方からは外れますが、`metaplex-foundation/shank`を使ったり、フレームワークの`coral-xyz/anchor`を使ってIDL（Interface Definition Language）を生成することを検討してください。

## 4.3. エスクローの状態の定義

エスクローアカウントのデータを表す状態を定義します。

`src/state.rs`を作成し、`src/lib.rs`にモジュールを追加します。

```diff
mod instruction;
+mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;
...
```

`src/lib.rs`に追加できたら、次に`src/state.rs`に状態を定義しましょう。

```rust
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};
use solana_program::program_pack::IsInitialized;
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, BorshSchema)]
pub struct Escrow {
    pub is_initialized: bool,
    pub seller_pubkey: Pubkey,
    pub seller_token_account_pubkey: Pubkey,
    pub temp_token_account_pubkey: Pubkey,
    pub amount: u64,
}

impl IsInitialized for Escrow {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
```

各フィールドは、アカウントのベストプラクティスに従って固定長になるように定義します。
これにより、アカウントの維持コストである家賃（rent）を一定に保ち、RPCの`getProgramAccounts`などでバイトオフセットを指定してアカウントを取得できるようになります。

`is_initialized`フィールドは、この`Escrow`が初期化済みかどうか、つまり交換可能な状態になっているかを判別します。
`IsInitialized`の実装では、全てのフィールドが`0`値であるかで判別することも可能ですが、アカウントの家賃とCU（Compute Unit）の使用量のトレードオフを考慮する必要があります。
筆者が他のプログラムを見た限りでは、初期化済みかどうかや状態を示すフィールドを持つケースが多いようです。

`seller_pupkey`には、売り手のアカウントのアドレスが格納されます。
エスクロープログラムで取引が成立した際、一時的に作成された各種アカウントの家賃は、このアカウントに返金されます。

`seller_token_account_pubkey`には、売り手が交換成立時にトークンを受け取るための関連トークンアカウント（Associated Token Account, ATA）のアドレスが格納されます。
関連トークンアカウントには、どのトークンに関連付けられているかを示すミントアカウントの情報が含まれています。

`temp_token_account_pubkey`には、売り手から一時的にトークンを受け取る関連トークンアカウントのアドレスが格納されます。
この関連トークンアカウントの所有者は、エスクロープログラムのPDA（Program Derived Address）になり、取引成立時に買い手にトークンを送信する元となります。
交換成立後、この関連トークンアカウントは削除され、家賃は`seller_pubkey`のアカウントに返金されます。

`amount`には、取引時に売り手が買い手に送信してほしいトークンの量が格納されます。
買い手の関連トークンアカウントにこのトークン量がない場合、取引は成立しません。

`Escrow`構造体も`Instruction`と同様に、Borshフォーマットで扱います。
より標準的な書き方をしたい場合は、Borshの代わりに`Sealed`と`Pack`トレイトを実装してください。

```rust
impl Sealed for Escrow {}

impl Pack for Escrow {
    const LEN: usize = 105;
    
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        todo!()
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
        todo!()
    }
}
```

`Pack`トレイトの`LEN`定数では、実際に作成するバイト列の長さを指定します。
今回の`Escrow`構造体は、`1` + `32` + `32` + `32` + `8`の合計`105`バイトになります。

## 4.4. プロセッサの作成

エスクロープログラムで実際の処理を行うプロセッサを実装します。

`src/processor.rs`を作成し、`src/lib.rs`にモジュールを追加します。

```diff
mod instruction;
+mod processor;
mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;
...
```

`src/lib.rs`に追加できたら、次に`src/processor.rs`にプロセッサを定義しましょう。

```rust
use solana_program::account_info::AccountInfo;
use solana_program::entrypoint::ProgramResult;
use solana_program::pubkey::Pubkey;

struct Processor;
impl Processor {
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
        Ok(())
    }
}
```

これはSPLでよく見られる定型のコードです。
個人的には、構造体ではなく関数だけで十分だと思いますが、SPLではこのように書くことが多いので、今回はこの書き方に従います。

また、`src/entrypoint.rs`で`Processor::process`を呼び出すように変更しましょう。

```diff
+use crate::processor::Processor;
use solana_program::entrypoint;

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
-    Ok(())
+    Processor::process(program_id, accounts, instruction_data)
}
```

それでは、このプロセッサを使ってインストラクションをデシリアライズし、処理を分岐させましょう。

```diff
+use crate::instruction::Instruction;
+use borsh::BorshDeserialize;
use solana_program::account_info::AccountInfo;
use solana_program::entrypoint::ProgramResult;
use solana_program::pubkey::Pubkey;

struct Processor;
impl Processor {
+    fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
+        todo!()
+    }
+
+    fn process_exchange(
+        program_id: &Pubkey,
+        accounts: &[AccountInfo],
+        amount: u64,
+    ) -> ProgramResult {
+        todo!()
+    }
+
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
-        Ok(())
+        let instruction = Instruction::deserialize(&mut &input[..])?;
+        match instruction {
+            Instruction::Initialize(amount) => Self::process_init(program_id, accounts, amount),
+            Instruction::Exchange(amount) => Self::process_exchange(program_id, accounts, amount),
+        }
    }
}
```

Borshを使うと、`fn deserialize(buf: &mut &[u8]) -> Result<Self>`というデシリアライズ用の関数が提供されます。
これを利用して`&[u8]`のバイト列から`Instruction`列挙型にデシリアライズし、どのインストラクションなのかに応じて処理を切り替えます。

ここでは、インストラクションに対応する`fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult`と`fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult`という、プログラムのアドレス、渡されたアカウントの配列、インストラクションに含まれた値を受け取る関数を用意しています。

それぞれのインストラクションの処理を実装する前に、処理の流れを簡単に解説しましょう。

1. `&[AccountInfo]`から必要なアカウントを順に取り出す
2. アカウントとインストラクションから適切な入力かどうかをバリデーション
3. アカウントの状態を変更
   - プログラムが所有するアカウントの状態を直接変更
   - CPI（Cross-Program Invocation）で別のプログラムを呼び出し、アカウントの状態を変更

SPLのプログラムによっては、この順序が異なることもありますが、基本的にはこれらの処理が行われます。

バリデーションについては、少し注意が必要です。
プログラムの実装では、CU（Compute Unit）の使用量を最小限に抑えることが望ましいため、不要な処理や重複した処理は避けるべきです。

例えば、渡されたアカウントが書き込み可能かどうかを確認するために、以下のようなバリデーションを考えることができます。

```rust
if account.owner != program_id {
    return Err(ProgramError::IncorrectProgramId)
}
if !account.is_writable {
    return Err(ProgramError::InvalidAccountData)
}
```

このコードは、プログラムが対象のアカウントを所有しているか、また書き込み可能なアカウントとしてプログラムに渡されているかを確認しています。
しかし、このバリデーションが本当に必要でしょうか。変更できないアカウントを変更しようとした場合、エラーが発生するため、このバリデーションは不要です。

また、CPIで他のプログラムを呼び出す際、呼び出し先のプログラムでバリデーションが行われている場合、呼び出し元でのバリデーションは冗長になります。

さらに、プログラムの柔軟性を考慮して、アカウントを厳密に制限しないこともあります。
例えば、アカウントの所有者のプログラムIDを制限してしまうと、そのプログラムが新しいバージョンとして新しいプログラムがデプロイされた場合に対応できなくなります。
その場合、プログラムを再デプロイしない限り、新しいバージョンのプログラムに対応できません。
（これはSPLのトークンプログラムで実際にありました）

ただし、自分でプログラムを書く際に、これらのバリデーションを省略すべきかどうかは、慎重に判断する必要があります。
バリデーションが不十分だと、不正なインストラクションやアカウントが処理されてしまい、脆弱性につながる可能性があります。
また、バリデーションを追加することによるCUの増加は、多くの場合、ごくわずかです。
そのため、堅牢なプログラムを書くという観点では、必要なバリデーションは全て行うべきだと言えます。

もちろん、ユニットテストなどで、不正なインストラクションやアカウントが失敗することを確認することも重要です。
CU、堅牢性、実装コストのバランスを考えて、適切なバリデーションを行うようにしましょう。

### process_initの実装

それでは、エスクローの初期化処理を実装していきましょう。

この処理で必要なのは、以下の2つです。

1. エスクローアカウントの初期化
2. 渡された関連トークンアカウントの所有者をPDAに変更

まずは、インストラクションのコメントに書かれている通りに、必要なアカウントを取り出します。

```diff
use crate::instruction::Instruction;
use borsh::BorshDeserialize;
-use solana_program::account_info::AccountInfo;
+use solana_program::account_info::{next_account_info, AccountInfo};
use solana_program::entrypoint::ProgramResult;
use solana_program::pubkey::Pubkey;
+use solana_program::rent::Rent;
+use solana_program::sysvar::Sysvar;

...

    fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
+        let account_iter = &mut accounts.iter();
+        let seller_account = next_account_info(account_iter)?;
+        let seller_token_account = next_account_info(account_iter)?;
+        let temp_token_account = next_account_info(account_iter)?;
+        let escrow_account = next_account_info(account_iter)?;
+        let rent = Rent::from_account_info(next_account_info(account_iter)?)?;
+        let token_program = next_account_info(account_iter)?;
+
        todo!()
    }

...
```

`next_account_info(account_iter)?`を使って順番にアカウントを取り出していきます。
6つの必要なアカウントが取り出せない場合は、エラーが返ります。

次に、インストラクションとアカウントのバリデーションを追加します。

```diff
use crate::instruction::Instruction;
use borsh::BorshDeserialize;
use solana_program::account_info::{next_account_info, AccountInfo};
use solana_program::entrypoint::ProgramResult;
+use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;
use solana_program::rent::Rent;
use solana_program::sysvar::Sysvar;

...

    fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let rent = Rent::from_account_info(next_account_info(account_iter)?)?;
        let token_program = next_account_info(account_iter)?;
        
+        if seller_token_account.owner != token_program.key {
+            return Err(ProgramError::IncorrectProgramId);
+        }
+        if !rent.is_exempt(escrow_account.lamports(), escrow_account.data_len()) {
+            return Err(ProgramError::AccountNotRentExempt);
+        }
+
        todo!()
    }

...
```

ここでは2つのバリデーションを追加しました。

1つ目は、`seller_token_account.owner != token_program.key`で、トークンプログラムによって作成されたアカウントであることを確認しています。
ただし、この検証だけでは、ミントアカウントなのか関連トークンアカウントなのかを判別できません。本来であれば、どちらのアカウントなのかまで検証すべきですが、判別にはデシリアライズが必要であり、デシリアライズはCUを大幅に増加させるため、必要最小限にとどめるべきです。
ミントアカウントが渡された場合、後続の処理の`process_exchange`で失敗するため、不正な状態にはなりますが、不正な操作はできないと考えられるので、ここではこれ以上のバリデーションは行いません。

2つ目は、`!rent.is_exempt(escrow_account.lamports(), escrow_account.data_len())`で、エスクローアカウントの家賃（rent）が免除されるのに十分な`lamports`が設定されているかを確認しています。
これは、後続の処理の`process_exchange`が実行されるまでにアカウントが削除されないようにするためです。

この他にも、以下のようなバリデーションを考えることができますが、他の部分で検証されるため、今回のコードでは省略しています。

- `seller_account`に署名があること：この後の関連トークンアカウントの所有者変更処理で署名の検証が行われるため不要
- `temp_token_account`が関連トークンアカウントであること：この後の関連トークンアカウントの所有者変更処理で検証が行われるため不要
- `temp_token_account`が書き込み可能であること：書き込みできない場合はエラーになるため不要
- `temp_token_account`に0より大きいトークンの残高があること：不正な状態になりますが、後続の`process_exchange`で不正な処理は行えないため不要
- `escrow_account`の所有者がエスクロープログラムであること：所有者でない場合は書き込みできずエラーになるため不要
- `escrow_account`が書き込み可能であること：書き込みできない場合はエラーになるため不要
- `token_program`がトークンプログラムのアカウントであること：この後の関連トークンアカウントの所有者変更処理が実行できなくなるため不要（Token Extensionのように後方互換性のある別のプログラムに切り替わる可能性もあるため、厳密な検証はできません）

逆に言えば、これらのアカウントが渡された場合にエラーになることを、ユニットテストなどで確認することを検討すべきです。

次に、エスクローアカウントの状態をデシリアライズし、初期化されていないことを確認してから、初期化を行います。

```diff
use crate::instruction::Instruction;
+use crate::state::Escrow;
-use borsh::BorshDeserialize;
+use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::account_info::{next_account_info, AccountInfo};
use solana_program::entrypoint::ProgramResult;
+use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;
use solana_program::rent::Rent;
use solana_program::sysvar::Sysvar;
+use solana_program::program_pack::IsInitialized;

...

    fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let rent = Rent::from_account_info(next_account_info(account_iter)?)?;
        let token_program = next_account_info(account_iter)?;

        if seller_token_account.owner != token_program.key {
            return Err(ProgramError::IncorrectProgramId);
        }
        if !rent.is_exempt(escrow_account.lamports(), escrow_account.data_len()) {
            return Err(ProgramError::AccountNotRentExempt);
        }

+        let data = &mut escrow_account.data.borrow_mut();
+        let mut state = Escrow::try_from_slice(data)?;
+        if state.is_initialized() {
+            return Err(ProgramError::AccountAlreadyInitialized);
+        }
+        state.is_initialized = true;
+        state.seller_pubkey = seller_account.key.clone();
+        state.seller_token_account_pubkey = seller_token_account.key.clone();
+        state.temp_token_account_pubkey = temp_token_account.key.clone();
+        state.amount = amount;
+        data.copy_from_slice(state.try_to_vec()?.as_slice());
+
        todo!()
    }

...

```

アカウントはプログラム上では参照として扱われるため、書き換えるためにミュータブルな（可変な）借用を行います。
借用した状態を`Escrow`にデシリアライズし、初期化済みの場合はエラー、未初期化の場合は各種値を設定して初期化し、借用した状態に書き戻します。

最後に、関連トークンアカウントの所有者をPDAのアドレスに変更します。

```diff
use crate::instruction::Instruction;
use crate::state::Escrow;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::account_info::{next_account_info, AccountInfo};
use solana_program::entrypoint::ProgramResult;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;
use solana_program::rent::Rent;
use solana_program::sysvar::Sysvar;
use solana_program::program_pack::IsInitialized;
+use spl_token::instruction::AuthorityType;

...

    fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let rent = Rent::from_account_info(next_account_info(account_iter)?)?;
        let token_program = next_account_info(account_iter)?;

        if seller_token_account.owner != token_program.key {
            return Err(ProgramError::IncorrectProgramId);
        }
        if !rent.is_exempt(escrow_account.lamports(), escrow_account.data_len()) {
            return Err(ProgramError::AccountNotRentExempt);
        }

        let data = &mut escrow_account.data.borrow_mut();
        let mut state = Escrow::try_from_slice(data)?;
        if state.is_initialized() {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        state.is_initialized = true;
        state.seller_pubkey = seller_account.key.clone();
        state.seller_token_account_pubkey = seller_token_account.key.clone();
        state.temp_token_account_pubkey = temp_token_account.key.clone();
        state.amount = amount;
        data.copy_from_slice(state.try_to_vec()?.as_slice());

+        let (pda, _) = Pubkey::find_program_address(&[b"escrow"], program_id);
+        let ix = spl_token::instruction::set_authority(
+            token_program.key,
+            temp_token_account.key,
+            Some(&pda),
+            AuthorityType::AccountOwner,
+            seller_account.key,
+            &[&seller_account.key],
+        )?;
+        invoke(
+            &ix,
+            &[
+                temp_token_account.clone(),
+                seller_token_account.clone(),
+                token_program.clone(),
+            ],
+        )?;
+
+        Ok(())
    }

...

```

`Pubkey::find_program_address`を使ってPDAを生成します。
今回は常に一意なアドレスを生成したいので、第一引数の`seeds`には固定のバイト列を渡しています。

その後、CPI（Cross-Program Invocation）を使ってトークンプログラムの`SetAuthority`インストラクションを呼び出し、関連トークンアカウントの所有者を変更します。

これで、エスクローの初期化処理が実装できました。

### process_exchangeの実装

次に、エスクローの交換処理を実装していきます。

この処理で必要なのは、以下の4つです。

1. 買い手から売り手へのトークン送信
2. エスクロープログラムから買い手へのトークン送信
3. エスクロープログラムが所有する一時的な関連トークンアカウントの削除
4. エスクローアカウントの削除

まずは、`process_init`と同様に、インストラクションのコメントに書かれている通りに、必要なアカウントを取り出します。

```diff

...

    fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
+        let account_iter = &mut accounts.iter();
+        let buyer_account = next_account_info(account_iter)?;
+        let buyer_send_token_account = next_account_info(account_iter)?;
+        let buyer_receive_token_account = next_account_info(account_iter)?;
+        let temp_token_account = next_account_info(account_iter)?;
+        let seller_account = next_account_info(account_iter)?;
+        let seller_token_account = next_account_info(account_iter)?;
+        let escrow_account = next_account_info(account_iter)?;
+        let token_program = next_account_info(account_iter)?;
+        let pda_account = next_account_info(account_iter)?;
+        
        todo!()
    }

...

```

次に、インストラクションとアカウントのバリデーションを追加します。

```diff
-use solana_program::program_pack::IsInitialized;
+use solana_program::program_pack::{IsInitialized, Pack};

...

    fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let buyer_account = next_account_info(account_iter)?;
        let buyer_send_token_account = next_account_info(account_iter)?;
        let buyer_receive_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let token_program = next_account_info(account_iter)?;
        let pda_account = next_account_info(account_iter)?;
        
+        let temp_token_account_state =
+            spl_token::state::Account::unpack(&temp_token_account.try_borrow_data()?)?;
+        if amount != temp_token_account_state.amount {
+            return Err(ProgramError::InvalidAccountData);
+        }
+        
+        let data = &escrow_account.data.borrow();
+        let state = Escrow::try_from_slice(data)?;
+        if !state.is_initialized() {
+            return Err(ProgramError::InvalidAccountData);
+        }
+        if state.temp_token_account_pubkey != *temp_token_account.key {
+            return Err(ProgramError::InvalidAccountData);
+        }
+        if state.seller_pubkey != *seller_account.key {
+            return Err(ProgramError::InvalidAccountData);
+        }
+        if state.seller_token_account_pubkey != *seller_token_account.key {
+            return Err(ProgramError::InvalidAccountData);
+        }
+
        todo!()
    }

...

```

ここでは、エスクロープログラムが所有する一時的な関連トークンアカウントとエスクローアカウントのバリデーションを行います。

一時的な関連トークンアカウントのバリデーションでは、含まれるトークンの量が買い手の期待する量と一致するかを確認します。

エスクローアカウントのバリデーションでは、渡されたアカウントとフィールドに保持されているアドレスが一致するかを確認しています。

`process_init`と同様に、他のバリデーションは不要なため省略しています。

では、エスクローの交換処理を1つずつ実装していきましょう。

```diff

...

    fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let buyer_account = next_account_info(account_iter)?;
        let buyer_send_token_account = next_account_info(account_iter)?;
        let buyer_receive_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let token_program = next_account_info(account_iter)?;
        let pda_account = next_account_info(account_iter)?;
        
        let temp_token_account_state =
            spl_token::state::Account::unpack(&temp_token_account.try_borrow_data()?)?;
        if amount != temp_token_account_state.amount {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data = &escrow_account.data.borrow();
        let state = Escrow::try_from_slice(data)?;
        if !state.is_initialized() {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.temp_token_account_pubkey != *temp_token_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.seller_pubkey != *seller_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.seller_token_account_pubkey != *seller_token_account.key {
            return Err(ProgramError::InvalidAccountData);
        }

+        let ix = spl_token::instruction::transfer(
+            token_program.key,
+            buyer_send_token_account.key,
+            seller_token_account.key,
+            buyer_account.key,
+            &[&buyer_account.key],
+            state.amount,
+        )?;
+        invoke(
+            &ix,
+            &[
+                buyer_send_token_account.clone(),
+                seller_token_account.clone(),
+                buyer_account.clone(),
+                token_program.clone(),
+            ],
+        )?;
+
        todo!()
    }

...

```

まず、買い手から売り手へのトークン送信を行います。
このとき、送信するトークンの量はエスクローアカウントに設定された売り手の期待する量になります。

```diff

...

    fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let buyer_account = next_account_info(account_iter)?;
        let buyer_send_token_account = next_account_info(account_iter)?;
        let buyer_receive_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let token_program = next_account_info(account_iter)?;
        let pda_account = next_account_info(account_iter)?;
        
        let temp_token_account_state =
            spl_token::state::Account::unpack(&temp_token_account.try_borrow_data()?)?;
        if amount != temp_token_account_state.amount {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data = &escrow_account.data.borrow();
        let state = Escrow::try_from_slice(data)?;
        if !state.is_initialized() {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.temp_token_account_pubkey != *temp_token_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.seller_pubkey != *seller_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.seller_token_account_pubkey != *seller_token_account.key {
            return Err(ProgramError::InvalidAccountData);
        }

        let ix = spl_token::instruction::transfer(
            token_program.key,
            buyer_send_token_account.key,
            seller_token_account.key,
            buyer_account.key,
            &[&buyer_account.key],
            state.amount,
        )?;
        invoke(
            &ix,
            &[
                buyer_send_token_account.clone(),
                seller_token_account.clone(),
                buyer_account.clone(),
                token_program.clone(),
            ],
        )?;

+        let (pda, nonce) = Pubkey::find_program_address(&[b"escrow"], program_id);
+        let ix = spl_token::instruction::transfer(
+            token_program.key,
+            temp_token_account.key,
+            buyer_receive_token_account.key,
+            &pda,
+            &[&pda],
+            temp_token_account_state.amount,
+        )?;
+        invoke_signed(
+            &ix,
+            &[
+                temp_token_account.clone(),
+                buyer_receive_token_account.clone(),
+                pda_account.clone(),
+                token_program.clone(),
+            ],
+            &[&[&b"escrow"[..], &[nonce]]],
+        )?;
+
        todo!()
    }

...

```

次に、エスクロープログラムが所有する一時的な関連トークンアカウントから買い手へのトークン送信を行います。

エスクロープログラムからの送信では署名が必要になるため、PDAと`invoke_signed`を用いてCPI（Cross-Program Invocation）を実行します。

```diff

...

    fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
        let account_iter = &mut accounts.iter();
        let buyer_account = next_account_info(account_iter)?;
        let buyer_send_token_account = next_account_info(account_iter)?;
        let buyer_receive_token_account = next_account_info(account_iter)?;
        let temp_token_account = next_account_info(account_iter)?;
        let seller_account = next_account_info(account_iter)?;
        let seller_token_account = next_account_info(account_iter)?;
        let escrow_account = next_account_info(account_iter)?;
        let token_program = next_account_info(account_iter)?;
        let pda_account = next_account_info(account_iter)?;
        
        let temp_token_account_state =
            spl_token::state::Account::unpack(&temp_token_account.try_borrow_data()?)?;
        if amount != temp_token_account_state.amount {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data = &escrow_account.data.borrow();
        let state = Escrow::try_from_slice(data)?;
        if !state.is_initialized() {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.temp_token_account_pubkey != *temp_token_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.seller_pubkey != *seller_account.key {
            return Err(ProgramError::InvalidAccountData);
        }
        if state.seller_token_account_pubkey != *seller_token_account.key {
            return Err(ProgramError::InvalidAccountData);
        }

        let ix = spl_token::instruction::transfer(
            token_program.key,
            buyer_send_token_account.key,
            seller_token_account.key,
            buyer_account.key,
            &[&buyer_account.key],
            state.amount,
        )?;
        invoke(
            &ix,
            &[
                buyer_send_token_account.clone(),
                seller_token_account.clone(),
                buyer_account.clone(),
                token_program.clone(),
            ],
        )?;

        let (pda, nonce) = Pubkey::find_program_address(&[b"escrow"], program_id);
        let ix = spl_token::instruction::transfer(
            token_program.key,
            temp_token_account.key,
            buyer_receive_token_account.key,
            &pda,
            &[&pda],
            temp_token_account_state.amount,
        )?;
        invoke_signed(
            &ix,
            &[
                temp_token_account.clone(),
                buyer_receive_token_account.clone(),
                pda_account.clone(),
                token_program.clone(),
            ],
            &[&[&b"escrow"[..], &[nonce]]],
        )?;

+        let ix = spl_token::instruction::close_account(
+            token_program.key,
+            temp_token_account.key,
+            seller_account.key,
+            &pda,
+            &[&pda],
+        )?;
+        invoke_signed(
+            &ix,
+            &[
+                temp_token_account.clone(),
+                seller_account.clone(),
+                pda_account.clone(),
+                token_program.clone(),
+            ],
+            &[&[&b"escrow"[..], &[nonce]]],
+        )?;
+
+        let mut seller_account_lamports = seller_account.lamports.borrow_mut();
+        **seller_account_lamports = seller_account_lamports
+            .checked_add(escrow_account.lamports())
+            .ok_or(ProgramError::ArithmeticOverflow)?;
+        let mut escrow_account_lamports = escrow_account.lamports.borrow_mut();
+        **escrow_account_lamports = 0u64;
+        let mut escrow_account_data = escrow_account.data.borrow_mut();
+        *escrow_account_data = &mut [];
+
        Ok(())
-        todo!()
    }

...

```

最後に、エスクローで作成したアカウントの削除を行います。

エスクロープログラムが所有する一時的な関連トークンアカウントは、トークンプログラムからのみ削除できるため、CPIで`CloseAccount`インストラクションを呼び出します。

エスクローアカウントはエスクロープログラムで削除できるため、`lamports`をエスクローアカウントを作成した売り手に返金し、状態を空にすることでアカウントを削除します。
ここはかなり読みづらいコードになっていますが、アカウントの`lamports`と`data`が`Rc<RefCell<T>>`という共有所有権と内部データの可変性を実現するためのラッパーを使用しているためです。

## 4.5. プログラムIDの設定

最後に、このプログラムを他のプログラムから呼び出しやすいように、プログラムのIDを登録します。

前章で作成した`escrow_program-keypair.json`を元に、プログラムIDの文字列を生成します。

```bash
$ solana address -k target/deploy/escrow_program-keypair.json

[your program id]
```

ここで表示されたプログラムIDを`src/lib.rs`に追加します。

```diff
+use solana_program::declare_id;

mod instruction;
mod processor;
mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

declare_id!("[your program id]");
```

`[your program id]`の部分には、コマンドで表示されたプログラムIDを設定してください。

これで、他のクレートから`escrow_program::id()`でプログラムのIDを取得できるようになります。

## 4.6. 章のまとめ

この章では、Rustでエスクロープログラムをどのように実装するかを解説しました。

SPLのプログラムの書き方は、よくも悪くも手続き型です。
今回はそれを明示的に示すために、そのままの形で実装しましたが、例えばCPIの呼び出しを別の関数に切り出したり、アカウントの削除のような定型処理を切り出すことで、よりシンプルで読みやすく、再利用性の高い実装にできるはずです。

次の章では、実際にこのプログラムを呼び出すためのクライアントをRustで実装します。
クライアントを作成することで、動作確認やテストがしやすくなるだけでなく、クライアントの視点に立つことでエスクローの理解がより深まるはずです。
ぜひ、実装に挑戦してみてください。
