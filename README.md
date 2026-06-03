# Brokenithm Deck

Steam Deck-oriented port of the Brokenithm-Android client protocol.

This app keeps the PC side the same: run `tindy2013/Brokenithm-Android-Server` exactly as you do for the Android client, then enter the PC address on the Deck as `host` or `host:port`. The default protocol port is `52468`.

## What It Supports

- UDP mode with the same `CON`, `INP`, `IPT`, `FNC`, `PIN/PON`, `CRD`, and `DIS` packets used by the Android server.
- TCP mode for a direct Deck-to-PC TCP connection when the server is started with `-T`.
- Touchscreen slider and AIR input mapped to the server's 32 slider sensors and 6 AIR blocks.
- LED feedback from the server.
- Coin, card, test, and service buttons.
- Optional virtual card packet output.
- Local settings saved to `config.json`.

## Run On Steam Deck

In Desktop Mode, run:

```bash
git clone https://github.com/Hitsquid/brokenithm-deck.git
cd brokenithm-deck
chmod +x brokenithm-deck.sh
./brokenithm-deck.sh
```

The launcher starts the local Deck app at `http://127.0.0.1:39868`. If Node.js is not installed, the first launch downloads a portable Node.js runtime into `.runtime/` inside this folder.

To add it to Steam, add `brokenithm-deck.sh` as a Non-Steam Game. In Gaming Mode, set the controller layout to allow touch screen and gamepad input.

## PC Server Compatibility

No server files need to change.

- Standard UDP server: choose `UDP` in the Deck app and enter the PC IP, for example `192.168.1.20`.
- Custom server port: enter `192.168.1.20:PORT`.
- TCP server: start the PC server with `-T`, choose `TCP` in the Deck app, and enter the PC IP or `host:port`.

For UDP, the Deck app listens on local UDP port `52468` by default and advertises that port in the `CON` packet, matching the Android configuration style. If your PC server uses a custom `-p` port, only the address field in the Deck app needs the matching `:PORT`.

## Deck Controls

- Touch the lower slider area for slider input.
- Touch the upper AIR area for AIR input.
- View button sends coin.
- Menu button sends card.
- L1 holds test.
- R1 holds service.
- D-pad up or L2 triggers AIR.
- D-pad down or R2 clears AIR.

Keyboard helpers for desktop testing:

- `1` coin, `2` card.
- `T` test, `Y` service.
- `A S D F J K L ;` map to sample slider lanes.

## Notes

This is a source port/prototype, not a packaged SteamOS binary. It has no npm package dependencies; the only runtime dependency is Node.js.

NFC hardware passthrough is not implemented. Use the virtual card fields if you need to emit `CRD` packets.
