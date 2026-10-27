#!/bin/bash
# После правки src/lib/* запускает тесты формул (npm test). Ошибка возвращается Claude.
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  */turo-fleet-archive/src/lib/*.ts) ;;
  *) exit 0 ;;
esac
export PATH="$HOME/.local/bin:$PATH"
cd "$CLAUDE_PROJECT_DIR/turo-fleet-archive" || exit 0
if ! out=$(npm test --silent 2>&1); then
  echo "Тесты формул упали после правки $(basename "$file"):" >&2
  echo "$out" | tail -40 >&2
  exit 2
fi
exit 0
