# 4. エスクロープログラム

本章ではRustを用いてエスクロープログラムを実装する方法について解説します。

Solanaブロックチェーンでプログラムの書き方はいくつかありますが、本書ではSPLで使われる書き方を採用します。
これは手続き的に書かれるため読みやすいこと、SPLを読めるようになればSolana Labsが提供するコードのほとんどが読めるようになるためです。

ただし、SPLは書いた人や、書いた時期によって書き方にブレがあります。
そのため、本書では筆者の判断によりSPLの中で最も書きやすく、読みやすいであろうと思われる書き方を採用していることにご留意ください。

それでは前章で作成したプロジェクトの`solana-escrow/program`配下を変更していきましょう。

## 4.1 Entrypointの作成

前章の時点でエントリーポイントは作成していましたが、クレートとして再利用しやすいようにエントリポイントを移動します。

まず、`src/entrypoint.rs`を作成し、そちらに`src/lib.rs`の内容を移動します。

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

次に`src/lib.rs`を変更して、`feature`を指定した場合に`entrypoint`を読み込まないようにします。

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

これはクレートを利用するさいにはエントリーポイントは不要になるため、最終的なバイナリサイズを削減できます。

エントリーポイントの仕組みを簡単に説明すると、`entrypoint!`マクロに`&Pubkey`、`&[AccountInfo]`、`&[u8]`を取る関数を登録することで、Solanaブロックチェーン上でこのプログラムを呼び出したさいに登録された関数の呼び出しができるようになります。

この`entrypoint!`マクロを展開すると

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

というような形に展開されます。
これはFFI（Foreign Function Interface）での呼び出しの定型句でバイト列のポインタを受け取り、そこを書き換えて成功/失敗を戻すことがわかります。

本書ではFFIやSolanaがどのようにプログラムを呼び出すかについては解説しませんが、気になる方はこのあたり調べるととても楽しいかと思います。

## 4.2 Instructionの作成

次にクライアントから受け取るインストラクションを実装します。

`src/instruction.rs`を作成し、`src/lib.rs`にモジュールを追加します。

```diff
+mod instruction;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;
...
```

`src/lib.rs`に追加できたら、次に`src/instruction.rs`にインストラクションを定義しましょう。

```rust
use borsh::{BorshDeserialize, BorshSchema, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, BorshSchema)]
pub enum Instruction {
    Initialize(u64),
    Exchange(u64),
}
```

Solanaブロックチェーンのアカウントモデルの兼ね合いで、1つのプログラムで複数のインストラクションを処理するために`enum`で定義するのが定番です。

`Initialize`は取引の初期化を行い取引可能な状態にします。
このとき渡される数量は売り手が期待する買い手が送信するトークン数量です。

`Exchange`は取引可能な状態になった取引で取引を成立させます。
このとき渡される数量は買い手が期待する売り手の数量であり、この数量が売り手が設定した数量と一致しなければ取引は不成立となります。
取引が成立すると取引は削除されます。

今回は簡略化のためにシリアライズ/デシリアライズにはBorshという軽量なフォーマットを使用しています。

もし、よりネイティブな書き方をしたい場合は下記のように`unpack`、`pack`メソッドを実装してください。
特にこのメソッド名、シグネチャである必要はありませんが、SPLでよく見かける形になります。

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

今回は最低限成り立つように初期化と交換の2つのインストラクションをサポートします。
しかし、もしより実運用するプログラムを作る場合は、交換の成立前にキャンセルするようなインストラクションがあるとより望ましいです。

実装としてはこれで十分ですが、今の実装ではそれぞれのインストラクションで渡すアカウントがわかりにくいという問題があります。

```diff
...
pub enum Instruction {
+    /// Initialize the escrow agent and enable the transaction.
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

そこで、このようにコメントでどのようなアカウントを渡すことを期待するのがSPLの定番です。
ただ、コメントで書いてしまうと制約としづらいですし、何より多様なプログラミング言語から呼び出すためのクライアントを生成するのにコメントの解析が必要になってしまいます。
もしこのあたりを上手くやりたい場合はSPLの書き方からは外れてしまいますが、`metaplex-foundation/shank`を使ったり、フレームワークの`coral-xyz/anchor`を使用してIDLを生成するを検討してください。

## 4.3. Escrowの作成

エスクローアカウントのデータ部を表す状態を実装します。

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

それぞれのフィールドはアカウントのプラクティスに則り、固定長になるように定義します。
これはアカウントの維持にかかる家賃を一定にする、アカウントを取得するさいにRPCの`getProgramAccounts`などでバイト位置を絞り込みしてアカウントを取得するためです。

フィールドの`is_initialized`はこの`Escrow`が初期化済みかどうか。
つまり、交換可能な状態になっているかを判別します。
`IsInitialized`の実装で全てのフィールドが`0`値であるかで判別も可能ですが、このあたりはアカウントの家賃を取るか、CU（Compute Unit）を取るかのトレードオフです。
筆者が他のプログラムを見ている限り初期化済みかどうかや、状態を示すフィールドを持つケースが多いです。

`seller_pupkey`には売り手のアカウントのアドレスが入ります。
エスクロープログラムで取引が成立したさいに、一時的に作られた各種アカウントの家賃の返却先です。

`seller_token_account_pubkey`には売り手が交換成立時にトークンを受け取るための関連トークンアカウントのアドレスが入ります。
関連トークンアカウントであるため、このアカウント自体にどのトークンなのかミントトークンアカウントが含まれています。

`temp_token_account_pubkey`には売り手から一時的にトークンを受け取った関連トークンアカウントのアドレスが入ります。
この関連トークンアカウントアドレスの所有者はエスクロープログラムのPDAになり、取引成立時に買い手にトークンを送信する元になります。
交換成立後にこの関連トークンアカウントは削除され、家賃は`seller_pubkey`のアカウントに返却されます。

`amount`には取引時に売り手が期待する買い手が送信するトークン数が入ります。
このトークン数が買い手の関連トークンアカウントになければ取引は不成立になります。

`Escrow`も`Instruction`と同様にBorshフォーマットで扱います。
よりネイティブな書き方をしたい場合はBorshの代わりに`Sealed`、`Pack`トレイトを追加するようにしてください。

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

`Pack`トレイトの`LEN`では実際に作成するバイト列の長さを指定するようにしてください。
今回は `1` + `32` + `32` + `32` + `8` のフィールドなので合計 `105` バイトとなります。

## 4.3. Processorの作成

エスクロープログラムで実際に処理を行うプロセッサーのを実装します。

`src/processor.rs`を作成し、`src/lib.rs`にモジュールを追加します。

```diff
mod instruction;
+mod processor;
mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;
...
```

`src/lib.rs`に追加できたら、次に`src/processor.rs`にプロセッサーを定義しましょう。

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

これはSPLの定型句になります。
個人的には構造体ではなく、関数で十分だと思いますが、SPLではよくこのように書くため今回はこの書き方で進めます。

あわせて`src/entrypoint.rs`で`Processor::process`を呼び出すように変更しましょう。

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


ではこのプロセッサを元にまずインストラクションをデシリアライズして処理を分岐させます。

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

Borshを使うと`fn deserialize(buf: &mut &[u8]) -> Result<Self>`というデシリアライズ用の関数が提供されます。
こちらを利用して`&[u8]`のバイト列から`Instruction`列挙型にデシリアライズし、どのインストラクションなのかに合わせて処理を切り替えます。

ここではインストラクションに対応した`fn process_init(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult`と`fn process_exchange(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult`というプログラムのアドレス、渡されたアカウントの配列、インストラクションに含まれた値を受け取る関数を扱います。

それぞれのインストラクションの処理を実装する前に、処理で何が行われるのか簡単に紹介します。

1. `&[AccountInfo]`から必要なアカウントを順次取り出し
2. アカウントとインストラクションから適切な入力かバリデーション
3. アカウントの状態の変更
    - プログラムが所有しているアカウントの状態を変更
    - CPIで別のプログラムを呼び出してアカウントの状態を変更

SPLのプログラムによっては順序が違ったりしますが、行われる処理はおおよそこれらになります。

この中でバリデーションは少し難しさがあります。
プログラムの実装ではCUを最小化することが望ましく、不要な処理、重複処理は書くべきではありません。

例えば、渡されたアカウントが書き込み可能かを見るために下記のようなバリデーションが想定できます。

```rust
if account.owner != program_id {
    return Err(ProgramError::IncorrectProgramId)
}
if !account.is_writable {
    return Err(ProgramError::InvalidAccountData)
}
```

これはプログラムが対象のアカウントを所有しているのか、書き込み可能なアカウントとしてプログラムに渡されているのかバリデーションを行っています。
しかし、このバリデーションが必要かというと、変更できないアカウントを変更してもエラーになるためこのバリデーションは不要です。

また、CPIで他プログラムを呼び出すさいに、他プログラムでバリデーションが行われている場合にはそのバリデーションは不要です。

他にはプログラム自体の柔軟性を考慮して対象のアカウントを厳密に制限しないということも考えられます。
例えばアカウントの所有者のプログラムのアドレスを制限してしまうと、そのプログラムが新しくなったさいに追従できないということも起こりえます。
そうなるとプログラムを再デプロイしない限り新しいプログラムに追従できなくなってしまいます。

ただし、これを自身がプログラムを書くさいにそうするべきかは少し難しいです。
特にバリデーションが漏れるということは不正なインストラクション、アカウントが成功してしまうということで脆弱性に繋がります。
また、これによって上昇するCUは微々たるものでありバリデーションやって何かが大きく変わることはありません
そのため、堅牢なプログラミングをするという観点では省略せずに必要なバリデーションは全て行うべきだと考えることもできます。

もちろんユニットテストなどで不正なインストラクションやアカウントが失敗することを保証することも可能です。
このあたりはCU、堅牢さ、実装コストのバランスをどうするか考えてみるとよいでしょう。

### process_init

エスクローの初期化処理を実装していきます。

この処理で必要なことは下記の2つです。

1. エスクローアカウントの初期化
2. 渡された関連トークンアカウントの所有者をPDAに変更

まずはインストラクションのコメントに書いた通りに指定されたアカウントを取り出します。

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

`next_account_info(account_iter)?`で順次取り出しを行い、もし6つの必要なアカウントが取り出しできなければエラーが戻ります。

次にインストラクション、アカウントのバリデーションを追加しましょう。

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

まず`seller_token_account.owner != token_program.key`でトークンプログラムによって作成されたアカウントであることを検証します。
この検証だけではミントトークンアカウントか関連トークンアカウントか判別できないため、本来であればどちらのアカウントかまで検証すべきです。
しかし、そこを判別するにはデシリアライズが必要であり、デシリアライズはCUを大幅に上昇させるため、必要最小限に留めるべきです。
仮にミントトークンアカウントであれば後続の処理の`process_exchange`で失敗するため、不正な状態にはなるが不正な操作はできないと考えそこまでのバリデーションは行いません。

次に`!rent.is_exempt(escrow_account.lamports(), escrow_account.data_len())`でエスクローアカウントの家賃が免除されるだけの`lamports`が設定されているのか検証します。
これは後続の処理の`process_exchange`までにアカウントが消えないようにするためです。

他に下記のバリデーションなども考えることはできますが、他で検証されるため今回のコードでは除外しています。

- `seller_account`が署名されていること: この後に追加される関連トークンアカウントの所有者の変更処理で署名の検証がされるため不要
- `temp_token_account`が関連トークンアカウントであること: この後に追加される関連トークンアカウントの所有者の変更処理で検証がされるため不要
- `temp_token_account`が書き込み可能であること: 書き込みできないケースではエラーになるため不要
- `temp_token_account`に0より大きいトークンの数量が割り当てられていること: 不正な状態になるが後続の処理の`process_exchange`で不正な処理は行えないので不要
- `escrow_account`の所有者がエスクロープログラムであること: 所有者でない場合は書き込みできずエラーになるため不要
- `escrow_account`が書き込み可能であること: 書き込みできないケースではエラーになるため不要
- `token_program`がトークンプログラムのアカウントであること: この後に追加される関連トークンアカウントの所有者の変更処理が実行できなくなるため不要（Token Extensionのように別の後方互換を持ったプログラムに切り替わる可能性もあるため厳密な検証はできない）

逆に言えばこういったアカウントを渡すとエラーになることをユニットテストなどで保証することを検討しましょう。

次にエスクローアカウントの状態をデシリアライズし、未初期化であることを検証してから、初期化を行います。

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
+        if !state.is_initialized() {
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

アカウントはプログラム上では参照として扱われるため、書き換えるためにミュータブルな借用を行います。
そこで借用した状態を`Escrow`にデシリアライズし、初期化済みであればエラー、未初期化であれば初期化として各種値を設定し、借用した状態に書き戻します。

最後に関連トークンアカウントの所有者をPDAのアドレスに変更します。

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
        if !state.is_initialized() {
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

`Pubkey::find_program_address`でPDAを生成します。
今回は常に一意なアドレスを生成したいため、第一引数の`seeds`では固定のバイト列を渡しています。

その後にCPIでトークンプログラムのSetAuthorityインストラクションを呼び出し、関連トークンアカウントの所有者を変更します。

これでエスクローの初期化処理が実装できました。

### process_exchange

エスクローの交換処理を実装していきます。

この処理で必要なことは下記の4つです。

1. 買い手から売り手にトークンを送信
2. エスクロープログラムから買い手にトークンを送信
3. エスクロープログラムが所有する一時的な関連トークンアカウントを削除
4. エスクローアカウントを削除

まずは`process_init`と同様にインストラクションのコメントに書いた通りに指定されたアカウントを取り出します。

```diff

....

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

次にインストラクション、アカウントのバリデーションを追加しましょう。

```diff
-use solana_program::program_pack::IsInitialized;
+use solana_program::program_pack::{IsInitialized, Pack};

....

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
+        if state.is_initialized() {
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

ここではバリデーションとしてエスクロープログラムが所有する一時的な関連トークンアカウントと、エスクローアカウントのバリデーションを行います。

エスクロープログラムが所有する一時的な関連トークンアカウントのバリデーションでは含まれるトークン数が、買い手が期待する数量であることをバリデーションします。

エスクローアカウントのバリデーションでは渡されたアカウントとフィールドで保持しているアドレスと一致するかをバリデーションしています。

`process_init`と同様に他のバリデーションは不要になため除外しています。

次にエスクローの交換を1つずつ実装します。

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
        if state.is_initialized() {
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

まず、買い手から売り手にトークンを送信します。
このとき送るトークンの数量はエスクローアカウントに設定された売り手の期待したトークンの数量になります。

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
        if state.is_initialized() {
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

次にエスクロープログラムが所有する一時的な関連トークンアカウントから買い手にトークンを送信します。

エスクロープログラムからの送信で署名が必要になるため、PDAと`invoke_signed`を用いてCPIを実行します。

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
        if state.is_initialized() {
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

処理の最後としてエスクローで作成したアカウントの削除を行います。

エスクロープログラムが所有する一時的な関連アカウントトークンはトークンプログラムからのみ削除できるため、CPIでCloseAccountインストラクションを呼び出します。

エスクローアカウントはエスクロープログラムで削除できるため、`lamports`をエスクローアカウントを作成した売り手に返し、状態を空にすることでアカウントを削除します。
ここはかなり読みづらい形になっていますが、アカウントの`lamports`と`data`が`Rc<RefCell<T>`という共有所有と内部のデータの変更を可能にするためわかりづらい書き方になっています。

## 4.4. プログラムIDの設定

最後にこのプログラムを他から呼び出しやすいようにプログラムのIDを登録します。

前章で作成した`escrow_program-keypair.json`を元にプログラムIDの文字列を作ります。

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

`[your program id]`のところにコマンドで表示されたプログラムIDを設定してください。

こちらを設定することで、他のクレートから`escrow_program::id()`でプログラムのIDを取得できるようになります。

## 4.5. 章のまとめ

この章ではエスクロープログラムをRustで実装する方法を解説しました。

SPLのプログラムの書き方はよくも悪くも手続き的な書き方です。
今回はそこを見せるためにそのまま実装しましたが、例えばCPIの呼び出しは別途関数を切り出したり、アカウントの削除のような定型処理を切り出すことでよりシンプルで読みやすく、再利用生のある実装にできるかと思います。

次章では実際にこのプログラムを呼び出すためのクライアントをRustで実装します。
クライアントを作成することで動作確認やテストをしやすくなったり、クライアントの視点に立つことでよりエスクローの理解を深めることができます。
ぜひ作成してみましょう。