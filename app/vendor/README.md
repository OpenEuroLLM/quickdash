# Bundled YAML parser

`js-yaml.js` is the unmodified MIT-licensed browser/CommonJS distribution of
[js-yaml 4.1.1](https://github.com/nodeca/js-yaml/tree/4.1.1).
Its license is retained in `js-yaml.LICENSE`.

Source: https://raw.githubusercontent.com/nodeca/js-yaml/4.1.1/dist/js-yaml.js

SHA-256: `283c7386b83e9155de96c51519a4b318bad3b5aaf2ddf3d240d5938193b8187f`

The builder embeds this file in the standalone HTML. Python invokes Node through
`config_io.cjs` so command-line builds and browser imports use the same YAML parser
and config validation. No package installation or runtime network access is needed.
YAML uses the core schema, which allows ordinary data types and rejects executable
tags. Duplicate mapping keys are rejected. Exports preserve values, not comments.
