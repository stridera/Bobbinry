#!/usr/bin/env bash
# Run Jest under real Node.js instead of Bun's node shim.
# Bun's runtime has compatibility issues with Jest's module resolution.

# If NVM is available, use it to get the real node
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  exec node "$(dirname "$0")/../node_modules/.bin/jest" "$@"
fi

# Fallback: if real node is on PATH (e.g. CI with setup-node), use it directly
exec node "$(dirname "$0")/../node_modules/.bin/jest" "$@"
