#!/bin/sh
# To require a PIN for saving:  CYB_PIN=1234 ./start-linux-mac.sh
cd "$(dirname "$0")"
exec python3 server.py "$@"
