#!/bin/bash

get_shared_dir_mode() {
  if [ "${SENTINEL_LEGACY_PERMISSIONS:-}" = "true" ]; then
    printf '%s\n' "0777"
    return 0
  fi

  printf '%s\n' "0770"
}

ensure_shared_dir() {
  local dir="$1"
  local mode

  if [ -z "$dir" ]; then
    echo "ensure_shared_dir requires a directory path" >&2
    return 1
  fi

  mode="$(get_shared_dir_mode)"
  mkdir -p "$dir"
  chmod "$mode" "$dir"
}
