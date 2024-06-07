# 7. エスクロープログラムの実行

本章ではここまで作成したエスクロープログラムを実際に実行します。

今回は動作のさせやすい検証環境であるDevnetを利用します。
もし、TestnetやMainnet-Betaを利用する場合は、そちらに合わせて設定を変更してください。

## 7.1. Solana CLIの設定

まず、RPCのエンドポイントをDevnetに変更します。

**~/.config/solana/cli/config.yml**

```yaml
---
json_rpc_url: https://api.devnet.solana.com
websocket_url: ''
keypair_path: /Users/[your name]/.config/solana/id.json
address_labels:
  '11111111111111111111111111111111': System Program
commitment: confirmed
```

上記のように`json_rpc_url`に`https://api.devnet.solana.com`を設定してください。

## 7.2. Solanaトークンの入手

この後プログラムを実行していくにあたりSolanaトークンを入手する必要があります。

Devnet、TestnetではAirdropを実行することでSolanaトークンを入手することができます。

```bash
$ solana airdrop 1
```

もし、Mainnet-BetaでSolanaトークンを利用したい場合は、別途取引所や個人間取引で手に入れてください。

## 7.3. エスクロープログラムのデプロイ

Solana CLIの準備ができたのでエスクロープログラムをデプロイします。

```bash
$ cargo build-sbf
$ solana program deploy --program-id target/deploy/escrow_program-keypair.json target/deploy/escrow_program.so
```

ビルドさえできていれば初回のデプロイで失敗することはほぼありませんが、プログラムを変更したさいにエラーが出て再デプロイできなくなることはよくあります。

```bash
$ solana program deploy --program-id target/deploy/escrow_program-keypair.json target/deploy/escrow_program.so

=================================================================================
Recover the intermediate account's ephemeral keypair file with
`solana-keygen recover` and the following 12-word seed phrase:
=================================================================================
alert vendor upper wide empower stomach skin regular note window language useless
=================================================================================
To resume a deploy, pass the recovered keypair as the
[BUFFER_SIGNER] to `solana program deploy` or `solana program write-buffer'.
Or to recover the account's lamports, pass it as the
[BUFFER_ACCOUNT_ADDRESS] argument to `solana program close`.
=================================================================================
Error: 10 write transactions failed
```

これはエラーの原因次第ということはありますが、よくあるケースは`.so`ファイルのサイズが変更前より大きくなったさいによく出ます。
そういったさいには`extend`サブコマンドを利用してサイズを拡張することで解決できます。

```bash
$ solana program extend $(solana address -k target/deploy/escrow_program-keypair.json) 1024
```

このコマンドでは`1024`バイトほど元のサイズから拡張しています。
実際にどのくらい拡張するかは`solana program show [program id]`の`Data Length`で表示されるサイズと、実際の`.so`ファイルのサイズを比較して必要な分を拡張してください。

ここまで出来たらエスクロープログラムが利用可能になるため、実際にエスクローを行うための準備をしていきます。

## 7.4. ミントトークンの作成

エスクロープログラムでは2つのミントトークンと関連トークンアカウントが必要になるため作成していきます。

**トークンA**
```bash
$ spl-token create-token

Creating token 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF under program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

Address:  5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
Decimals:  9

Signature: 64Ac9HNizYtkDvajAyXtW82ZknkefonVyJ7qoKY8nq3AXvWqxcTgjT1rbo1NVWkk9PtVqcNSacaHkzkxUG3oGYgb

$ spl-token create-account 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
Creating account BS4byiXE6uLWSQUBZB6PxBjjwz9yHwLktx68gkUjsp6N

Signature: 4u1jkQsisYDMH6aj2PQXMFS936pevbtXPuPJXSSNSCbvHxHyxbY1ZgqbdJR4pz7rCchmDLbHt79CPxdU5QS2oBNz

$ spl-token mint 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF 100                       
5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
Minting 100 tokens
  Token: 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
  Recipient: BS4byiXE6uLWSQUBZB6PxBjjwz9yHwLktx68gkUjsp6N

Signature: 62MgknAJN2uLQwGi6ABZkMM9ZhFTMPh5tyFJa3rb1LV7VrSQB6D64J9nfKdXWo34RMGGYxw7Ny5822o62fCS1b4U
```

**トークンB**
```bash
$ spl-token create-token                                                                

Creating token GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8 under program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

Address:  GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
Decimals:  9

Signature: 2REUcrp1ALo2dvFVSruBbEkBit9dijpLjQXFFssNDaEYrgiSLkWmHtJ6f2j18VyuVBSjqh9VwM6ETSzribGoKSBj

$ spl-token create-account GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
Creating account 75nRJfhNPzF3QTmSi468QxV3bf37ujNB7EkkR9ZW8QB2

Signature: 5ykLfjDWCzvdtPMBEFxyVd9MGh82ZzesQ5YDDibBZLrJhofyTPaiiW9kNcxAgQ4xZy3ono8YYGG8HkUuxKVPvRss

$ spl-token mint GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8 100
GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
Minting 100 tokens
  Token: GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
  Recipient: 75nRJfhNPzF3QTmSi468QxV3bf37ujNB7EkkR9ZW8QB2

Signature: 2SMxJMRZyV66sBfaUqS8Jx4nKFgNkCHpMHgWBvCPLg96Z5vQkqWDHg1mUKD8pZ8rPFV8TcAgAid2dMwjeaKfMLbn
```

ここで作成した`5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF`と`GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8`のミントトークンのアドレスを利用してエスクロープログラムを呼び出します。

## 7.5. エスクローアカウントの初期化

それでは実際にエスクローアカウントを作成してみましょう。

```bash
$ cargo run --bin escrow-cli -- init 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF 1000000000 GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8 1000000000
Create Account: 6ssvVksvy3CWwjBbXLzs6yM6BzLgA3izy573po2rcBju

Signature: 4gqLmZM3WQLXX6FpnpgY5ZKomo5aUM9zszMda2r12gS1eSfPTbaggUr8nTkNpXvpoUuDEJrcCtGiF64Mk8iFGkT3
```

作成したアカウントを確認すると下記のように設定がされていることがわかります。

- Seller: BdWx4rjtN23d4GcWzpKfxmnmVzN5jSdmETmgwwfCCf8m
- Seller Token Account: 75nRJfhNPzF3QTmSi468QxV3bf37ujNB7EkkR9ZW8QB2
- Escrow Token Account: 2XjRUmCTU6Y8LdBsNdP83d89QypykFr5jxJuPXPL4MgQ
- Expected amount: 1000000000

実際にトークン数を確認してみましょう。

```bash
$ spl-token balance 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
99

$ spl-token balance GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8           
GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
100
```

実際に送信した側のトークン数が1減っていることがわかります。

## 7.5. エスクローの実行

次に交換を行い、エスクローの取引を成立させます。
今回は同一のアカウントを使って取引を行うため、最終的に保持するトークン数はどちらも100になることを期待しています。

```bash
$ cargo run --bin escrow-cli -- exchange 6ssvVksvy3CWwjBbXLzs6yM6BzLgA3izy573po2rcBju                         
Signature: tujBGACNy7gEXPmpcVkbw4vsLHqJauM3UJ8TCWLsxh33p94Bwkhv2ST7ycmUkKXEAg9GTXioKXRahq2HBCDuX3T
```

実際にトークン数を確認してみましょう。

```bash
$ spl-token balance 5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
5dXDdzZ6BQNxFszbX5uoYhx7n9K26DucfQ3yjWL453xF
100

$ spl-token balance GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8           
GxRiESaLqhGBbersF73m56dCa4oKUQ64joZyWxPPJsS8
100
```

同一アカウントでの交換 = 元の状態になるということでどちらのトークン数も`100`になりました。

交換が行われておらず、実際にはトークンAの送信だけが行われているのでは？と疑いを持つ場合は、コマンド実行結果のシグネチャをSolana Explorerなどで参照してトランザクションを確認することをおすすめします。
もしくは今回は手間だったので行いませんでしたが、2つアカウントを用意して実際に交換を実現してみてください。

## 7.6. 章のまとめ

この章では、Devnetを用いて実際にエスクロープログラムの動作を確認しました。

もし、DevnetではなくTestnetやMainnet-Betaを利用する場合はRPCのエンドポイントを切り替える、Solanaトークンの入手方法を変えるぐらいで大枠の実行方法は変わりません。
Devnetでの動作確認ができたら、TestnetやMainnet-Betaでもプログラムをぜひ公開してみてください。
