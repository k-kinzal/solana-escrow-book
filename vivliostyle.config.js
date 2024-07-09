module.exports = {
  title: 'Solana Escrow入門',
  author: 'Kouta Ozaki',
  size: 'A5',
  theme: '@vivliostyle/theme-techbook@^1.0.1',
  entry: [
    '00-index.md',
    '01-introduction.md',
    '02-what-is-escrow.md',
    '03-escrow-project-setup.md',
    '04-escrow-program.md',
    '05-escrow-client.md',
    '06-escrow-cli.md',
    '07-run-escrow.md',
    '08-conclusion.md',
    '99-colophon.md',
  ],
  entryContext: './articles',
  output: [
    {
      path: '.dist/webpub',
      format: 'webpub',
    },
    {
      path: '.dist/solana-escrow-book.pdf',
      format: 'pdf',
    },
  ]
}
