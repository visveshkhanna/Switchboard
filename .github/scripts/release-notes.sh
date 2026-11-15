#!/usr/bin/env bash
# Prints the release notes for a version: its section of CHANGELOG.md,
# followed by install instructions. Fails if the section is missing, so a
# tag is never released without notes.
#
#   .github/scripts/release-notes.sh v0.1.0 > notes.md
set -euo pipefail
tag=${1:?usage: release-notes.sh TAG}
version=${tag#v}
repo=${GITHUB_REPOSITORY:-visveshkhanna/Switchboard}

notes=$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found && /^\[[^]]+\]: / { next }
  found { print }
' CHANGELOG.md)
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no section for $version" >&2
  exit 1
fi

printf '%s\n' "$notes" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
cat <<NOTES

## Install

\`\`\`bash
npx mcp-switchboard@$version up
\`\`\`

or install it globally with \`npm install -g mcp-switchboard@$version\` and run \`switchboard up\`. Requires Node 24 or later.

Or run it hosted, with Docker:

\`\`\`bash
docker run -d -p 7690:7690 -v switchboard:/data \\
  -e SWITCHBOARD_ADMIN_PASSWORD=... -e SWITCHBOARD_PUBLIC_URL=https://your.domain \\
  ghcr.io/visveshkhanna/switchboard:$version
\`\`\`

The npm package is published with [provenance](https://docs.npmjs.com/generating-provenance-statements). The attached tarball's build provenance can be checked with \`gh attestation verify mcp-switchboard-$version.tgz --repo $repo\`.

Docs: https://switchboard.visvesh.dev/docs
NOTES
