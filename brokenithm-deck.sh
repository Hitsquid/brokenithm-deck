#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-39868}"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
RUNTIME_DIR="${BROKENITHM_DECK_RUNTIME_DIR:-$PWD/.runtime}"

download_file() {
  local url="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fL "$url" -o "$output"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
    return
  fi

  echo "Brokenithm Deck needs curl or wget to download Node.js." >&2
  exit 1
}

install_node() {
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Unsupported CPU architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac

  local archive="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${archive}"
  local archive_path="${RUNTIME_DIR}/${archive}"
  local extract_dir="${RUNTIME_DIR}/node-v${NODE_VERSION}-linux-${arch}"

  mkdir -p "$RUNTIME_DIR"
  echo "Node.js was not found. Downloading portable Node.js v${NODE_VERSION}..." >&2
  download_file "$url" "$archive_path"

  rm -rf "$extract_dir" "${RUNTIME_DIR}/node"
  tar -xJf "$archive_path" -C "$RUNTIME_DIR"
  ln -s "$extract_dir" "${RUNTIME_DIR}/node"
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  if [ ! -x "${RUNTIME_DIR}/node/bin/node" ]; then
    install_node
  fi

  echo "${RUNTIME_DIR}/node/bin/node"
}

launch_chromium_kiosk() {
  mkdir -p "${RUNTIME_DIR}/browser-profile"
  "$@" \
    --user-data-dir="${RUNTIME_DIR}/browser-profile" \
    --no-first-run \
    --noerrdialogs \
    --disable-infobars \
    --disable-notifications \
    --disable-session-crashed-bubble \
    --disable-features=Translate,TranslateUI,MediaRouter \
    --overscroll-history-navigation=0 \
    --start-fullscreen \
    --kiosk \
    "$url" >/dev/null 2>&1 &
}

open_browser() {
  if command -v flatpak >/dev/null 2>&1; then
    if flatpak info com.google.Chrome >/dev/null 2>&1; then
      launch_chromium_kiosk flatpak run com.google.Chrome
      return
    fi

    if flatpak info org.chromium.Chromium >/dev/null 2>&1; then
      launch_chromium_kiosk flatpak run org.chromium.Chromium
      return
    fi

    if flatpak info org.mozilla.firefox >/dev/null 2>&1; then
      flatpak run org.mozilla.firefox --kiosk "$url" >/dev/null 2>&1 &
      return
    fi
  fi

  for browser in google-chrome chrome chromium chromium-browser; do
    if command -v "$browser" >/dev/null 2>&1; then
      launch_chromium_kiosk "$browser"
      return
    fi
  done

  if command -v firefox >/dev/null 2>&1; then
    firefox --kiosk "$url" >/dev/null 2>&1 &
    return
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

NODE_BIN="$(find_node)"
url="http://${HOST}:${PORT}"

"$NODE_BIN" src/server.js &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 80); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Brokenithm Deck server exited before the web UI started." >&2
    wait "$server_pid"
  fi

  if "$NODE_BIN" -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "${url}/api/config" >/dev/null 2>&1; then
    break
  fi

  sleep 0.1
done

open_browser

wait "$server_pid"
