#!/bin/bash
# Не даёт Claude менять ключи (.env*) и точные версии библиотек (package-lock.json).
file=$(jq -r '.tool_input.file_path // empty')
case "$(basename "$file")" in
  .env*|package-lock.json)
    echo "Файл $(basename "$file") защищён: менять его может только владелец. Библиотеки ставить через npm install." >&2
    exit 2 ;;
esac
exit 0
